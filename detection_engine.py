import cv2
import numpy as np
import time
import os
import json
import uuid
import threading
from collections import deque
from datetime import datetime
from database import get_db_connection

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "WorkingFiles", "storage")
CLIPS_DIR = os.path.join(STORAGE_DIR, "clips")
SNAPSHOTS_DIR = os.path.join(STORAGE_DIR, "snapshots")

os.makedirs(CLIPS_DIR, exist_ok=True)
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

class RealtimeCaptureReader:
    """Decoupled background grabber that continuously drains OpenCV/FFMPEG frame buffers to guarantee real-time (0ms lag) video."""
    def __init__(self, raw_cap):
        self.raw_cap = raw_cap
        self.lock = threading.Lock()
        self.read_lock = threading.Lock()
        self.latest_frame = None
        self.running = True
        self.last_frame_time = time.time()
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self):
        while self.running:
            try:
                with self.read_lock:
                    if not self.running or self.raw_cap is None:
                        break
                    ret, frame = self.raw_cap.read()
                
                if ret and frame is not None:
                    with self.lock:
                        self.latest_frame = frame
                        self.last_frame_time = time.time()
                else:
                    time.sleep(0.01)
            except Exception:
                time.sleep(0.02)

    def read(self):
        with self.lock:
            if self.latest_frame is None:
                # Check if stream is dead (timed out for > 6 seconds)
                if time.time() - self.last_frame_time > 6.0:
                    return False, None
                return None, None # Still connecting
            return True, self.latest_frame

    def isOpened(self):
        with self.read_lock:
            return self.raw_cap is not None and self.raw_cap.isOpened()

    def release(self):
        self.running = False
        try:
            if self.thread.is_alive() and threading.current_thread() != self.thread:
                self.thread.join(timeout=0.6)
        except Exception:
            pass
        with self.read_lock:
            if self.raw_cap is not None:
                try:
                    self.raw_cap.release()
                except Exception:
                    pass
                self.raw_cap = None

class HTTPSnapshotReader:
    """High performance background frame fetcher for Mobile Phone IP Webcam streams."""
    def __init__(self, base_url):
        if base_url.endswith("/video"):
            self.shot_url = base_url.replace("/video", "/shot.jpg")
        elif not base_url.endswith(".jpg"):
            self.shot_url = base_url.rstrip("/") + "/shot.jpg"
        else:
            self.shot_url = base_url
            
        self.lock = threading.Lock()
        self.latest_frame = None
        self.running = True
        self.last_frame_time = time.time()
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self):
        import urllib.request
        while self.running:
            try:
                req = urllib.request.Request(self.shot_url, headers={"User-Agent": "AegisVision-CCTV"})
                resp = urllib.request.urlopen(req, timeout=1.2)
                img_data = resp.read()
                if img_data:
                    nparr = np.frombuffer(img_data, np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if frame is not None:
                        frame = cv2.resize(frame, (640, 480))
                        with self.lock:
                            self.latest_frame = frame
                            self.last_frame_time = time.time()
                time.sleep(0.06) # ~16 FPS for background mobile IP preview
            except Exception:
                time.sleep(0.5)

    def read(self):
        with self.lock:
            if self.latest_frame is None:
                if time.time() - self.last_frame_time > 6.0:
                    return False, None
                return None, None
            return True, self.latest_frame

    def release(self):
        self.running = False

class MultiSourceStreamHub:
    """Manages concurrent background frame streams for all connected physical cameras (Webcam, RTSP, IP Cam)."""
    def __init__(self):
        self.readers = {}
        self.lock = threading.Lock()

    def get_frame(self, cam_id, source):
        src = str(source).strip()
        if src.lower() in ("demo", "-1"):
            return None # Fallback to synthetic demo generator
            
        with self.lock:
            if cam_id not in self.readers:
                self.readers[cam_id] = self._create_reader(src)
            reader = self.readers[cam_id]
            
        if reader is not None:
            ret, frame = reader.read()
            if ret and frame is not None:
                return frame
            elif ret is False:
                # Reconnect
                with self.lock:
                    if cam_id in self.readers:
                        try:
                            self.readers[cam_id].release()
                        except Exception:
                            pass
                        del self.readers[cam_id]
        return None

    def _create_reader(self, source):
        try:
            if source.isdigit():
                cap = cv2.VideoCapture(int(source), cv2.CAP_DSHOW)
                if not cap.isOpened():
                    cap = cv2.VideoCapture(int(source))
                if cap and cap.isOpened():
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    return RealtimeCaptureReader(cap)
            elif source.startswith("http://") or source.startswith("https://"):
                return HTTPSnapshotReader(source)
            else:
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|threads;1|fflags;nobuffer|flags;low_delay"
                cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
                if not cap.isOpened():
                    cap = cv2.VideoCapture(source)
                if cap and cap.isOpened():
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    return RealtimeCaptureReader(cap)
        except Exception as e:
            print(f"[MultiSourceStreamHub] Error creating reader for {source}: {e}")
        return None

stream_hub = MultiSourceStreamHub()

class TheftDetectionEngine:
    def __init__(self):
        self.running = False
        self.cap = None
        self.lock = threading.Lock()
        self.latest_jpeg = None
        self.current_source = "0"
        self.camera_name = "Laptop Webcam"
        self.camera_id = 1
        
        # Behavior parameters & State
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=25, detectShadows=True)
        self.frame_buffer = deque(maxlen=90) # ~3-4 seconds at 25fps
        self.recording_incident = False
        self.incident_frames = []
        self.post_incident_counter = 0
        self.current_incident_data = None
        
        # Tracking states
        self.shelf_touch_time = 0
        self.shelf_touch_active = False
        self.loiter_start_time = None
        self.last_alert_time = 0
        self.cooldown_seconds = 4.0 # Prevent alert spam
        
        # Visual stats
        self.fps = 0
        self.frame_count = 0
        self.latest_frame = None
        self.latest_clean_frame = None
        self.active_alerts = [] # Recent alerts for UI overlay
        
        # Heuristic / Sensitivity toggles
        self.sensitivity = 0.65
        self.detection_enabled = False # Starts in Standby/Preview mode to prevent accidental false alarms
        self.loitering_threshold = 8.0 # seconds
        self.concealment_timeout = 3.0 # customizable seconds (e.g. 1.0s to 15.0s)
        self.show_overlays = True
        self.camera_turned_off = False
        
        # Motion vector history for hand trajectory
        self.motion_history = deque(maxlen=30)
        
        # Demo simulation state
        self.demo_angle = 0
        self.demo_hand_y = 120
        self.demo_hand_direction = 1
        self.demo_state = "IDLE"
        
        # Load active camera config from DB
        self.load_camera_config()

    def release_camera(self):
        """Explicitly releases the camera device so the hardware LED turns off."""
        with self.lock:
            self.camera_turned_off = True
            if self.cap is not None:
                if hasattr(self.cap, 'release'):
                    self.cap.release()
                self.cap = None
            print("[DetectionEngine] Camera released. Hardware light OFF.")

    def enable_camera(self):
        """Re-enables the camera feed."""
        with self.lock:
            self.camera_turned_off = False
            if self.cap is not None and hasattr(self.cap, 'release'):
                self.cap.release()
            self.cap = None
            print("[DetectionEngine] Camera re-enabled.")
        
    def load_camera_config(self):
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM cameras WHERE is_active = 1 LIMIT 1")
            row = cursor.fetchone()
            if row:
                self.camera_id = row["id"]
                self.camera_name = row["name"]
                self.current_source = row["source"]
            conn.close()
        except Exception as e:
            print(f"Error loading camera config: {e}")

    def get_zones(self):
        zones = []
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM zones WHERE camera_id = ?", (self.camera_id,))
            rows = cursor.fetchall()
            for r in rows:
                try:
                    coords = json.loads(r["coords"])
                    zones.append({
                        "id": r["id"],
                        "name": r["name"],
                        "type": r["zone_type"],
                        "coords": coords,
                        "sensitivity": r["sensitivity"]
                    })
                except Exception:
                    pass
            conn.close()
        except Exception as e:
            print(f"Error fetching zones: {e}")
            
        # Default fallback zones if none in DB
        if not zones:
            zones = [
                {"id": 1, "name": "Supermarket Shelf Zone", "type": "shelf_zone", "coords": {"x": 60, "y": 60, "width": 520, "height": 180}, "sensitivity": 0.8},
                {"id": 2, "name": "Concealment / Pocket ROI", "type": "pocket_concealment_zone", "coords": {"x": 160, "y": 260, "width": 320, "height": 190}, "sensitivity": 0.75}
            ]
        return zones

    def set_source(self, source, camera_id=None, camera_name=None):
        with self.lock:
            if self.cap is not None:
                if hasattr(self.cap, "release"):
                    try:
                        self.cap.release()
                    except Exception:
                        pass
                self.cap = None
            self.current_source = str(source)
            if camera_id:
                self.camera_id = camera_id
            if camera_name:
                self.camera_name = camera_name
            self.frame_buffer.clear()
            self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=25, detectShadows=True)
            print(f"[DetectionEngine] Switched camera to: {self.camera_name} ({self.current_source})")

    def _open_capture(self):
        source = self.current_source.strip()
        if source.lower() == "demo" or source == "-1":
            return "demo"
        
        # Test if source is an integer (laptop webcam index)
        if source.isdigit():
            raw_cap = cv2.VideoCapture(int(source), cv2.CAP_DSHOW)
            if not raw_cap.isOpened():
                raw_cap = cv2.VideoCapture(int(source))
        else:
            # Low latency RTSP stream options (threads;1 prevents libavcodec async frame lock)
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|threads;1|fflags;nobuffer|flags;low_delay"
            raw_cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
            if not raw_cap.isOpened():
                raw_cap = cv2.VideoCapture(source)
            
        if raw_cap and raw_cap.isOpened():
            raw_cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            raw_cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            raw_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return RealtimeCaptureReader(raw_cap)
        return None

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._process_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.cap is not None:
            if hasattr(self.cap, "release"):
                try:
                    self.cap.release()
                except Exception:
                    pass
            self.cap = None

    def _generate_synthetic_demo_frame(self):
        """Generates a realistic supermarket aisle simulation when no physical camera is attached."""
        frame = np.full((480, 640, 3), 245, dtype=np.uint8)
        
        # Draw supermarket aisle background
        # Floor tiles
        cv2.rectangle(frame, (0, 340), (640, 480), (220, 220, 220), -1)
        for i in range(0, 640, 60):
            cv2.line(frame, (i, 340), (i + 40, 480), (200, 200, 200), 1)
            
        # Shelf rack structure
        cv2.rectangle(frame, (50, 40), (590, 240), (230, 235, 240), -1)
        cv2.rectangle(frame, (50, 40), (590, 240), (180, 190, 200), 2)
        cv2.line(frame, (50, 140), (590, 140), (160, 170, 180), 3) # Shelf 1
        cv2.line(frame, (50, 230), (590, 230), (160, 170, 180), 3) # Shelf 2
        
        # Items on shelves
        # Cosmetics / Bottles
        for idx, x in enumerate(range(80, 560, 45)):
            color = (60 + (idx * 25) % 180, 100 + (idx * 15) % 100, 200 - (idx * 15) % 100)
            cv2.rectangle(frame, (x, 70), (x + 28, 138), color, -1)
            cv2.circle(frame, (x + 14, 62), 6, (200, 180, 80), -1)
            
        # Electronics / Boxed Goods on lower shelf
        for idx, x in enumerate(range(90, 550, 65)):
            cv2.rectangle(frame, (x, 160), (x + 45, 228), (140, 100, 220 if idx % 2 == 0 else 80), -1)
            cv2.putText(frame, "ITEM", (x + 4, 195), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)

        # Draw simulated human customer
        # Head & Torso
        center_x = 320 + int(40 * np.sin(self.demo_angle * 0.5))
        cv2.circle(frame, (center_x, 260), 24, (180, 140, 120), -1) # Head
        cv2.ellipse(frame, (center_x, 370), (45, 80), 0, 0, 360, (70, 60, 50), -1) # Torso/Coat
        
        # Pocket area
        cv2.rectangle(frame, (center_x - 30, 340), (center_x + 30, 410), (40, 40, 30), -1)
        cv2.putText(frame, "POCKET / BAG", (center_x - 28, 380), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (200, 200, 200), 1)

        # Moving Arm / Hand simulating pick & conceal cycle
        self.demo_angle += 0.08
        hand_cycle = (np.sin(self.demo_angle) + 1) / 2 # 0.0 to 1.0
        
        hand_x = center_x - int(80 * (1 - hand_cycle))
        hand_y = 110 + int(240 * hand_cycle) # moves from shelf (110) to pocket (350)
        
        # Draw arm line
        cv2.line(frame, (center_x - 30, 310), (hand_x, hand_y), (180, 140, 120), 12)
        cv2.circle(frame, (hand_x, hand_y), 14, (160, 120, 100), -1)
        
        # If hand is taking an item down
        if hand_y < 240:
            self.demo_state = "GRABBING_SHELF_ITEM"
            cv2.rectangle(frame, (hand_x - 8, hand_y - 8), (hand_x + 8, hand_y + 8), (50, 180, 255), -1)
        elif hand_y >= 240 and hand_y < 330:
            self.demo_state = "MOVING_TO_CONCEAL"
            cv2.rectangle(frame, (hand_x - 8, hand_y - 8), (hand_x + 8, hand_y + 8), (50, 180, 255), -1)
        else:
            self.demo_state = "CONCEALMENT_TRIGGER"
            
        return frame

    def _trigger_theft_event(self, event_type, confidence, severity, zone_name, clean_frame):
        """Triggered when a suspicious behavior threshold is breached."""
        now = time.time()
        if now - self.last_alert_time < self.cooldown_seconds:
            return # Cooldown active
            
        self.last_alert_time = now
        event_uid = "THEFT-" + datetime.now().strftime("%Y%m%d%H%M%S-") + uuid.uuid4().hex[:4].upper()
        
        # Save snapshot
        snapshot_filename = f"{event_uid}.jpg"
        snapshot_path_full = os.path.join(SNAPSHOTS_DIR, snapshot_filename)
        cv2.imwrite(snapshot_path_full, clean_frame)
        
        # Start recording incident clip
        clip_filename = f"{event_uid}.mp4"
        self.recording_incident = True
        self.post_incident_counter = 45 # record 45 more frames (~1.5s)
        self.incident_frames = list(self.frame_buffer) # Prepend preceding frames from rolling buffer
        self.current_incident_data = {
            "uid": event_uid,
            "clip_filename": clip_filename,
            "snapshot_filename": snapshot_filename,
            "event_type": event_type,
            "confidence": confidence,
            "severity": severity,
            "zone_name": zone_name
        }
        
        # UI alert banner
        alert_info = {
            "uid": event_uid,
            "type": event_type,
            "time": datetime.now().strftime("%H:%M:%S"),
            "severity": severity,
            "zone": zone_name,
            "expire_time": now + 6.0
        }
        self.active_alerts.append(alert_info)
        
        # Log to Database
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO theft_events (
                event_uid, camera_id, camera_name, event_type, confidence, severity, zone_name, snapshot_path, clip_path, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event_uid,
                self.camera_id,
                self.camera_name,
                event_type,
                round(confidence, 2),
                severity,
                zone_name,
                f"/storage/snapshots/{snapshot_filename}",
                f"/storage/clips/{clip_filename}",
                "PENDING_REVIEW",
                f"Automated AI behavior trigger: {event_type} detected with {int(confidence*100)}% confidence."
            ))
            
            # Behavior audit log
            cursor.execute("""
            INSERT INTO behavior_logs (camera_id, event_type, description, details)
            VALUES (?, ?, ?, ?)
            """, (
                self.camera_id,
                event_type,
                f"Suspicious behavior detected in {zone_name}",
                json.dumps({"confidence": confidence, "severity": severity, "uid": event_uid})
            ))
            
            conn.commit()
            conn.close()
            print(f"[ALERT TRIGGERED] {event_type} | Confidence: {confidence*100:.1f}% | Clip: {clip_filename}")
        except Exception as e:
            print(f"Database error on alert trigger: {e}")

    def _save_completed_clip(self):
        """Asynchronously writes recorded incident frames to an MP4 video clip."""
        if not self.incident_frames or not self.current_incident_data:
            return
            
        frames_to_save = list(self.incident_frames)
        data = dict(self.current_incident_data)
        
        def _write():
            try:
                clip_path_full = os.path.join(CLIPS_DIR, data["clip_filename"])
                if len(frames_to_save) > 0:
                    h, w = frames_to_save[0].shape[:2]
                    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                    out = cv2.VideoWriter(clip_path_full, fourcc, 20.0, (w, h))
                    for f in frames_to_save:
                        out.write(f)
                    out.release()
                    print(f"[Video Clip Saved] {clip_path_full} ({len(frames_to_save)} frames)")
            except Exception as e:
                print(f"Error saving video clip: {e}")
                
        threading.Thread(target=_write, daemon=True).start()
        self.incident_frames = []
        self.current_incident_data = None

    def _process_loop(self):
        last_time = time.time()
        
        while self.running:
            try:
                if self.camera_turned_off:
                    # Camera is intentionally disabled by user
                    off_frame = np.full((480, 640, 3), 30, dtype=np.uint8)
                    cv2.putText(off_frame, "CAMERA FEED DISCONNECTED / STANDBY", (100, 240), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 2)
                    cv2.putText(off_frame, "Click 'Turn On Camera' in dashboard to resume.", (130, 270), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)
                    self.latest_frame = off_frame
                    time.sleep(0.1)
                    continue

                if self.cap is None:
                    src_clean = str(self.current_source).strip().lower()
                    if src_clean == "demo" or src_clean == "-1":
                        self.cap = "demo"
                    else:
                        cap_result = self._open_capture()
                        if cap_result is not None:
                            self.cap = cap_result
                        else:
                            # Display connecting feedback on HUD while retrying
                            connecting_frame = np.full((480, 640, 3), 25, dtype=np.uint8)
                            cv2.putText(connecting_frame, "CONNECTING TO CAMERA...", (140, 210),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 255), 2)
                            cv2.putText(connecting_frame, f"Target: {self.camera_name}", (140, 250),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
                            cv2.putText(connecting_frame, "Negotiating RTSP / TCP Stream Handshake...", (140, 280),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (120, 220, 120), 1)
                            self.latest_frame = connecting_frame
                            time.sleep(1.0)
                            continue

                if self.cap == "demo":
                    frame = self._generate_synthetic_demo_frame()
                    time.sleep(0.04) # ~25fps
                else:
                    ret, frame = self.cap.read()
                    if ret is None:
                        # Stream is currently connecting or buffering next frame
                        time.sleep(0.015)
                        continue
                    elif ret is False or frame is None:
                        # Stream failed or timed out
                        if self.cap is not None and hasattr(self.cap, "release"):
                            self.cap.release()
                        self.cap = None
                        time.sleep(0.5)
                        continue

                # Resize to standard processing resolution
                frame = cv2.resize(frame, (640, 480))
                clean_frame = frame.copy()
                self.latest_clean_frame = clean_frame
                
                # Append to rolling buffer
                self.frame_buffer.append(clean_frame)
                
                # If currently recording an incident clip
                if self.recording_incident:
                    self.incident_frames.append(clean_frame)
                    self.post_incident_counter -= 1
                    if self.post_incident_counter <= 0:
                        self.recording_incident = False
                        self._save_completed_clip()

                # Process AI Motion & Behavior Tracking
                processed_frame = self._analyze_behavior(frame, clean_frame)
                
                # Update FPS
                self.frame_count += 1
                now = time.time()
                if now - last_time >= 1.0:
                    self.fps = round(self.frame_count / (now - last_time), 1)
                    self.frame_count = 0
                    last_time = now

                # Clean expired UI alert banners
                self.active_alerts = [a for a in self.active_alerts if a["expire_time"] > now]

                self.latest_frame = processed_frame
                ret_jpg, jpeg_buf = cv2.imencode('.jpg', processed_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                if ret_jpg:
                    with self.lock:
                        self.latest_jpeg = jpeg_buf.tobytes()

            except Exception as e:
                print(f"[DetectionEngine Error] {e}")
                time.sleep(0.1)

    def _analyze_behavior(self, display_frame, clean_frame):
        now = time.time()
        zones = self.get_zones()
        
        # 1. Parse and Draw Zone Polygons & HUD
        shelf_polys = []
        pocket_polys = []
        checkout_polys = []
        
        for zone in zones:
            coords = zone["coords"]
            ztype = zone["type"]
            
            # Parse polygon points (supports 4-corner polygon or legacy rect)
            pts = []
            if isinstance(coords, dict) and "points" in coords and isinstance(coords["points"], list) and len(coords["points"]) >= 3:
                pts = [(int(p.get("x", 0)), int(p.get("y", 0))) for p in coords["points"]]
            elif isinstance(coords, dict) and "x" in coords:
                zx = int(coords.get("x", 0))
                zy = int(coords.get("y", 0))
                zw = int(coords.get("width", 100))
                zh = int(coords.get("height", 100))
                pts = [(zx, zy), (zx + zw, zy), (zx + zw, zy + zh), (zx, zy + zh)]
            
            if not pts:
                continue
                
            poly_np = np.array(pts, dtype=np.int32)
            
            if ztype == "shelf_zone":
                shelf_polys.append((poly_np, zone["name"]))
                color = (0, 180, 255) # Yellow/Orange
                label = f"SHELF: {zone['name']}"
            elif ztype == "pocket_concealment_zone":
                pocket_polys.append((poly_np, zone["name"]))
                color = (0, 0, 255) # Red
                label = f"CONCEALMENT ROI: {zone['name']}"
            elif ztype == "checkout_zone":
                checkout_polys.append((poly_np, zone["name"]))
                color = (0, 220, 220) # Cyan
                label = f"CHECKOUT: {zone['name']}"
            else:
                color = (200, 100, 200) # Purple
                label = zone["name"]

            if self.show_overlays:
                # Translucent polygon fill
                overlay = display_frame.copy()
                cv2.fillPoly(overlay, [poly_np], color)
                cv2.addWeighted(overlay, 0.16, display_frame, 0.84, 0, display_frame)
                
                # Polygon border
                cv2.polylines(display_frame, [poly_np], isClosed=True, color=color, thickness=2)
                
                # Draw Corner Anchor Handles
                for p_idx, pt in enumerate(poly_np):
                    cv2.circle(display_frame, (int(pt[0]), int(pt[1])), 4, (255, 255, 255), -1)
                    cv2.circle(display_frame, (int(pt[0]), int(pt[1])), 4, color, 1)
                
                # Label on top-leftmost vertex
                min_y_idx = int(np.argmin(poly_np[:, 1]))
                top_x, top_y = int(poly_np[min_y_idx][0]), int(poly_np[min_y_idx][1])
                cv2.rectangle(display_frame, (top_x, max(0, top_y - 20)), (top_x + len(label) * 9, max(20, top_y)), color, -1)
                cv2.putText(display_frame, label, (top_x + 4, max(15, top_y - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1)

        # 2. Background Subtraction & Motion Contours
        fg_mask = self.bg_subtractor.apply(clean_frame)
        _, thresh = cv2.threshold(fg_mask, 200, 255, cv2.THRESH_BINARY)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        thresh = cv2.dilate(thresh, kernel, iterations=2)
        
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        isolated_hand_in_shelf = False
        isolated_hand_in_pocket = False
        active_shelf_name = "Shelf Area"
        person_detected = False
        person_bbox = None
        motion_area_total = 0
        
        for c in contours:
            area = cv2.contourArea(c)
            if area < 500:
                continue
                
            x, y, w, h = cv2.boundingRect(c)
            cx, cy = float(x + w // 2), float(y + h // 2)
            
            # Check if this contour looks like a stationary person / torso
            if h > 140 and area > 4500:
                person_detected = True
                person_bbox = (x, y, w, h)
                if self.show_overlays:
                    cv2.rectangle(display_frame, (x, y), (x + w, y + h), (0, 255, 120), 2)
                    cv2.putText(display_frame, "CUSTOMER / BODY", (x, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 120), 1)
                continue # Skip body contour itself from triggering hand pocket concealment!

            motion_area_total += area

            # Check Polygon Intersection: Hand in Shelf Polygon (pointPolygonTest)
            for poly_np, sname in shelf_polys:
                if cv2.pointPolygonTest(poly_np, (cx, cy), False) >= 0:
                    isolated_hand_in_shelf = True
                    active_shelf_name = sname
                    if self.show_overlays:
                        cv2.circle(display_frame, (int(cx), int(cy)), 8, (0, 255, 255), -1)
                        cv2.putText(display_frame, "HAND IN SHELF", (int(cx) + 10, int(cy)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
                    break

            # Check Polygon Intersection: Hand in Pocket / Concealment Polygon
            for poly_np, pname in pocket_polys:
                if cv2.pointPolygonTest(poly_np, (cx, cy), False) >= 0:
                    isolated_hand_in_pocket = True
                    if self.show_overlays:
                        cv2.circle(display_frame, (int(cx), int(cy)), 8, (0, 0, 255), -1)
                        cv2.putText(display_frame, "HAND IN POCKET", (int(cx) + 10, int(cy)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1)
                    break

        # 3. Behavior Analysis Logic (Only runs when AI is explicitly armed)
        if self.detection_enabled:
            # Pattern A: Sequential Concealment Trajectory
            if isolated_hand_in_shelf and not isolated_hand_in_pocket:
                self.shelf_touch_time = now
                self.shelf_touch_active = True
                
            if self.shelf_touch_active:
                time_since_shelf = now - self.shelf_touch_time
                
                # Show HUD transfer timer when hand is in transit
                if self.show_overlays and time_since_shelf <= self.concealment_timeout:
                    timer_pct = max(0.0, min(1.0, 1.0 - (time_since_shelf / self.concealment_timeout)))
                    bar_w = int(120 * timer_pct)
                    cv2.rectangle(display_frame, (20, 435), (20 + 120, 447), (40, 40, 40), -1)
                    cv2.rectangle(display_frame, (20, 435), (20 + bar_w, 447), (0, 180, 255), -1)
                    cv2.putText(display_frame, f"TRANSFER: {time_since_shelf:.1f}s / {self.concealment_timeout:.1f}s", 
                                (20, 430), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 220, 255), 1)

                if isolated_hand_in_pocket:
                    if 0.30 <= time_since_shelf <= self.concealment_timeout: # Meaningful sequential transfer within user-configured window
                        self.shelf_touch_active = False
                        
                        # DYNAMIC MULTI-FACTOR CONFIDENCE SCORE
                        # Optimal transfer is between 0.4s and 40% of the timeout window
                        optimal_mid = min(1.4, max(0.8, self.concealment_timeout * 0.4))
                        if 0.4 <= time_since_shelf <= optimal_mid:
                            speed_score = 0.94
                        elif time_since_shelf < 0.4:
                            speed_score = 0.82
                        else:
                            decay_ratio = (time_since_shelf - optimal_mid) / max(0.5, (self.concealment_timeout - optimal_mid))
                            speed_score = max(0.65, 0.94 - decay_ratio * 0.25)
                            
                        # Factor 2: Motion area consistency
                        area_score = min(1.0, max(0.70, motion_area_total / 3000.0))
                        
                        # Factor 3: Sensitivity Weighting
                        sens_multiplier = 0.60 + (self.sensitivity * 0.40)
                        
                        dynamic_conf = round(min(0.98, max(0.68, (speed_score * 0.60 + area_score * 0.20) * sens_multiplier)), 2)
                        severity_lvl = "CRITICAL" if dynamic_conf >= 0.88 else "HIGH"
                        
                        self._trigger_theft_event(
                            event_type="CONCEALMENT_DETECTED",
                            confidence=dynamic_conf,
                            severity=severity_lvl,
                            zone_name=active_shelf_name,
                            clean_frame=clean_frame
                        )
                elif time_since_shelf > self.concealment_timeout:
                    self.shelf_touch_active = False
                
            # Demo mode trigger helper
            if self.cap == "demo" and self.demo_state == "CONCEALMENT_TRIGGER":
                self._trigger_theft_event(
                    event_type="CONCEALMENT_DETECTED",
                    confidence=0.92,
                    severity="CRITICAL",
                    zone_name="Cosmetics / High-Risk Shelf",
                    clean_frame=clean_frame
                )

            # Pattern B: Loitering / Suspicious Dwelling in Blind Spot
            if person_detected and not isolated_hand_in_shelf:
                if self.loiter_start_time is None:
                    self.loiter_start_time = now
                else:
                    dwell_duration = now - self.loiter_start_time
                    if dwell_duration > self.loitering_threshold:
                        self.loiter_start_time = now + 6.0 # reset with backoff
                        self._trigger_theft_event(
                            event_type="LOITERING_SUSPICIOUS",
                            confidence=0.85,
                            severity="HIGH",
                            zone_name=zones[0]["name"] if zones else "High Value Aisle",
                            clean_frame=clean_frame
                        )
                    elif self.show_overlays and person_bbox:
                        # Draw Dwell Timer
                        cv2.putText(display_frame, f"Dwell: {dwell_duration:.1f}s / {self.loitering_threshold}s", 
                                    (person_bbox[0], person_bbox[1] + person_bbox[3] + 18), 
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
            else:
                self.loiter_start_time = None

        # 4. Top Status Header & HUD
        if self.show_overlays:
            # Top dark translucent banner
            header_bar = display_frame[0:36, 0:640]
            dark_rect = np.zeros_like(header_bar)
            cv2.addWeighted(dark_rect, 0.7, header_bar, 0.3, 0, header_bar)
            
            # Status indicators
            ai_status_str = "ARMED" if self.detection_enabled else "STANDBY (PREVIEW)"
            ai_status_color = (0, 255, 120) if self.detection_enabled else (100, 200, 255)
            
            status_text = f"CAM: {self.camera_name} | AI: {ai_status_str} | FPS: {self.fps}"
            cv2.putText(display_frame, status_text, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)
            
            # Live REC Dot
            rec_color = (0, 0, 255) if (self.detection_enabled and int(now * 2) % 2 == 0) else (120, 120, 120)
            cv2.circle(display_frame, (615, 18), 6, rec_color, -1)
            cv2.putText(display_frame, "REC" if self.detection_enabled else "LIVE", (575, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (255, 255, 255), 1)
            
            # Active Alert Popups on Frame
            y_offset = 55
            for alert in self.active_alerts:
                cv2.rectangle(display_frame, (10, y_offset), (360, y_offset + 32), (0, 0, 220), -1)
                cv2.putText(display_frame, f"ALARM: {alert['type']}", (18, y_offset + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)
                cv2.putText(display_frame, f"{alert['time']} | {alert['zone']}", (18, y_offset + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (220, 220, 220), 1)
                y_offset += 38

        return display_frame

    def get_jpeg_frame(self):
        with self.lock:
            if self.latest_jpeg is not None:
                return self.latest_jpeg
            frame = self.latest_frame if self.latest_frame is not None else np.zeros((480, 640, 3), dtype=np.uint8)
            ret, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if ret:
                return buffer.tobytes()
            return None

# Singleton instance
engine = TheftDetectionEngine()
