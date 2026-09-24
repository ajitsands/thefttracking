import os
import json
import time
from datetime import date, datetime
from decimal import Decimal
from flask import Flask, Response, jsonify, request, send_from_directory, render_template
from flask_cors import CORS
from database import get_db_connection, init_db
from detection_engine import engine, stream_hub, CLIPS_DIR, SNAPSHOTS_DIR, STORAGE_DIR

app = Flask(__name__, static_folder="frontend", static_url_path="")
CORS(app)

class CustomJSONProvider(app.json_provider_class):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return str(obj)
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

app.json = CustomJSONProvider(app)

# Ensure database is initialized
init_db()

# Start background vision engine
engine.start()

@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")

@app.route("/storage/<folder>/<filename>")
def serve_storage(folder, filename):
    folder_map = {
        "clips": CLIPS_DIR,
        "snapshots": SNAPSHOTS_DIR
    }
    target_dir = folder_map.get(folder, STORAGE_DIR)
    return send_from_directory(target_dir, filename)

@app.route("/api/incident_replay/<filename>")
def incident_replay(filename):
    """Streams saved MP4 video clips as seamless MJPEG loops for 100% browser compatibility."""
    import cv2
    clip_path = os.path.join(CLIPS_DIR, filename)
    
    def generate_clip_stream():
        while True:
            cap = cv2.VideoCapture(clip_path)
            if not cap.isOpened():
                break
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                ret, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                if ret:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
                time.sleep(0.045) # ~22fps
            cap.release()
            time.sleep(0.5) # pause before looping
            
    return Response(generate_clip_stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

def generate_video_stream():
    """Generator for MJPEG live video stream."""
    while True:
        frame_bytes = engine.get_jpeg_frame()
        if frame_bytes is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.015) # ~60Hz poll for instantaneous live delivery

@app.route("/api/video_feed")
def video_feed():
    return Response(generate_video_stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/stats")
def get_stats():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # Total today
    cursor.execute("SELECT COUNT(*) as count FROM theft_events WHERE timestamp LIKE ?", (f"{today_str}%",))
    total_today = cursor.fetchone()["count"]
    
    # Pending review
    cursor.execute("SELECT COUNT(*) as count FROM theft_events WHERE status = 'PENDING_REVIEW'")
    pending_review = cursor.fetchone()["count"]
    
    # Confirmed theft
    cursor.execute("SELECT COUNT(*) as count FROM theft_events WHERE status = 'CONFIRMED_THEFT'")
    confirmed_theft = cursor.fetchone()["count"]
    
    # False alarms
    cursor.execute("SELECT COUNT(*) as count FROM theft_events WHERE status = 'FALSE_ALARM'")
    false_alarms = cursor.fetchone()["count"]
    
    # Active camera count
    cursor.execute("SELECT COUNT(*) as count FROM cameras")
    total_cameras = cursor.fetchone()["count"]
    
    # By event type breakdown
    cursor.execute("SELECT event_type, COUNT(*) as count FROM theft_events GROUP BY event_type")
    type_breakdown = {row["event_type"]: row["count"] for row in cursor.fetchall()}
    
    conn.close()
    
    return jsonify({
        "status": "online",
        "fps": engine.fps,
        "active_camera": engine.camera_name,
        "active_source": engine.current_source,
        "total_today": total_today,
        "pending_review": pending_review,
        "confirmed_theft": confirmed_theft,
        "false_alarms": false_alarms,
        "total_cameras": total_cameras,
        "type_breakdown": type_breakdown,
        "engine_state": {
            "sensitivity": engine.sensitivity,
            "loitering_threshold": engine.loitering_threshold,
            "concealment_timeout": engine.concealment_timeout,
            "detection_enabled": engine.detection_enabled,
            "show_overlays": engine.show_overlays
        }
    })

@app.route("/api/events", methods=["GET"])
def get_events():
    status = request.args.get("status")
    severity = request.args.get("severity")
    limit = int(request.args.get("limit", 50))
    
    query = "SELECT * FROM theft_events WHERE 1=1"
    params = []
    
    if status and status != "ALL":
        query += " AND status = ?"
        params.append(status)
    if severity and severity != "ALL":
        query += " AND severity = ?"
        params.append(severity)
        
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    return jsonify({"events": rows})

@app.route("/api/events/<int:event_id>/status", methods=["POST"])
def update_event_status(event_id):
    data = request.json or {}
    new_status = data.get("status")
    notes = data.get("notes", "")
    reviewer = data.get("reviewer", "Security Officer")
    
    if not new_status:
        return jsonify({"error": "Missing status"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE theft_events 
    SET status = ?, notes = ?, reviewed_by = ?
    WHERE id = ?
    """, (new_status, notes, reviewer, event_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "event_id": event_id, "new_status": new_status})

@app.route("/api/cameras", methods=["GET", "POST"])
def manage_cameras():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if request.method == "POST":
        data = request.json or {}
        name = data.get("name", "New Camera")
        cam_type = data.get("camera_type", "webcam")
        source = data.get("source", "0")
        location = data.get("location", "Main Store")
        
        cursor.execute("""
        INSERT INTO cameras (name, camera_type, source, location, is_active)
        VALUES (?, ?, ?, ?, 0)
        """, (name, cam_type, source, location))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return jsonify({"success": True, "id": new_id})
        
    cursor.execute("SELECT * FROM cameras ORDER BY id ASC")
    cameras = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({"cameras": cameras})

@app.route("/api/cameras/<int:cam_id>", methods=["PUT", "DELETE"])
def camera_detail(cam_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if request.method == "DELETE":
        cursor.execute("DELETE FROM zones WHERE camera_id = ?", (cam_id,))
        cursor.execute("DELETE FROM cameras WHERE id = ?", (cam_id,))
        conn.commit()
        conn.close()
        
        # If deleted camera was active, switch to first available camera
        if engine.camera_id == cam_id:
            conn2 = get_db_connection()
            cur2 = conn2.cursor()
            cur2.execute("SELECT * FROM cameras LIMIT 1")
            fallback = cur2.fetchone()
            if fallback:
                cur2.execute("UPDATE cameras SET is_active = 1 WHERE id = ?", (fallback["id"],))
                conn2.commit()
                engine.set_source(fallback["source"], camera_id=fallback["id"], camera_name=fallback["name"])
            conn2.close()
            
        return jsonify({"success": True, "message": "Camera deleted successfully"})
        
    elif request.method == "PUT":
        data = request.get_json(silent=True) or {}
        name = data.get("name", "Camera")
        cam_type = data.get("camera_type", "webcam")
        source = data.get("source", "0")
        location = data.get("location", "")
        
        cursor.execute("""
        UPDATE cameras 
        SET name = ?, camera_type = ?, source = ?, location = ?
        WHERE id = ?
        """, (name, cam_type, source, location, cam_id))
        conn.commit()
        
        # If currently active camera was edited, update the running engine immediately
        if engine.camera_id == cam_id:
            engine.set_source(source, camera_id=cam_id, camera_name=name)
            
        conn.close()
        return jsonify({"success": True, "message": "Camera updated successfully"})

@app.route("/api/cameras/<int:cam_id>/activate", methods=["POST"])
def activate_camera(cam_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("UPDATE cameras SET is_active = 0")
    cursor.execute("UPDATE cameras SET is_active = 1 WHERE id = ?", (cam_id,))
    cursor.execute("SELECT * FROM cameras WHERE id = ?", (cam_id,))
    cam = cursor.fetchone()
    conn.commit()
    conn.close()
    
    if cam:
        cam_dict = dict(cam)
        engine.set_source(cam_dict["source"], camera_id=cam_dict["id"], camera_name=cam_dict["name"])
        return jsonify({"success": True, "camera": cam_dict})
    return jsonify({"error": "Camera not found"}), 404

def get_camera_frame_jpeg(cam_id):
    """Returns a fresh JPEG frame for a specific camera channel."""
    import cv2
    import numpy as np
    
    if cam_id == engine.camera_id:
        frame_bytes = engine.get_jpeg_frame()
        if frame_bytes:
            return frame_bytes

    # Fetch camera metadata
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM cameras WHERE id = ?", (cam_id,))
        cam_row = cursor.fetchone()
        conn.close()
    except Exception:
        cam_row = None
        
    cam_name = cam_row["name"] if cam_row else f"Camera {cam_id}"
    cam_type = cam_row["camera_type"] if cam_row else "cctv"
    location = (cam_row["location"] if cam_row else None) or "Store Floor"
    source = cam_row["source"] if cam_row else "demo"
    
    # Try fetching REAL LIVE FRAME from background stream hub
    real_frame = stream_hub.get_frame(cam_id, source) if cam_row else None
    if real_frame is not None:
        tile = cv2.resize(real_frame, (640, 480))
        # Top banner overlay
        cv2.rectangle(tile, (0, 0), (640, 34), (15, 20, 30), -1)
        cv2.putText(tile, f"CAM {cam_id}: {cam_name.upper()}", (12, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (255, 255, 255), 1)
        cv2.circle(tile, (570, 17), 4, (0, 230, 100), -1)
        cv2.putText(tile, "LIVE", (582, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 230, 100), 1)
        # Footer overlay
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cv2.rectangle(tile, (0, 448), (640, 480), (15, 20, 30), -1)
        cv2.putText(tile, f"{location} | {cam_type.upper()} | {now_str}", (12, 470), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 195, 210), 1)
        
        ret_jpg, jpeg = cv2.imencode('.jpg', tile, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        if ret_jpg:
            return jpeg.tobytes()

    # Fallback to dynamic simulation if camera is demo or connecting
    t_sec = time.time()
    angle = float(cam_id * 35) + t_sec * 1.5
    tile = np.full((360, 480, 3), 242, dtype=np.uint8)
    
    # Floor
    cv2.rectangle(tile, (0, 240), (480, 360), (215, 218, 222), -1)
    for gx in range(0, 480, 50):
        cv2.line(tile, (gx, 240), (gx + 30, 360), (195, 200, 205), 1)
        
    # Shelf racks
    cv2.rectangle(tile, (35, 30), (445, 180), (230, 235, 240), -1)
    cv2.rectangle(tile, (35, 30), (445, 180), (170, 180, 195), 2)
    cv2.line(tile, (35, 105), (445, 105), (150, 160, 175), 2)
    
    # Stock items on shelf
    for s_idx, sx in enumerate(range(60, 420, 45)):
        color_item = (120, 80, 210) if (s_idx + cam_id) % 2 == 0 else (60, 150, 220)
        cv2.rectangle(tile, (sx, 45), (sx + 32, 98), color_item, -1)
        cv2.rectangle(tile, (sx, 115), (sx + 32, 172), color_item, -1)
    
    # Simulated customer motion in this aisle
    cx = 240 + int(90 * np.sin(angle * 0.4))
    cv2.circle(tile, (cx, 195), 18, (170, 130, 110), -1)
    cv2.ellipse(tile, (cx, 275), (35, 60), 0, 0, 360, (65, 55, 45), -1)
    
    # CCTV Header Bar
    cv2.rectangle(tile, (0, 0), (480, 32), (20, 28, 40), -1)
    cv2.putText(tile, f"CAM {cam_id}: {cam_name.upper()}", (12, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (255, 255, 255), 1)
    
    # Live status pill
    cv2.circle(tile, (420, 16), 4, (0, 230, 100), -1)
    cv2.putText(tile, "STANDBY", (430, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 230, 100), 1)
    
    # Footer Bar
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cv2.rectangle(tile, (0, 332), (480, 360), (20, 28, 40), -1)
    cv2.putText(tile, f"{location} | {cam_type.upper()} | {now_str}", (12, 351), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (180, 195, 210), 1)
    
    ret_jpg, jpeg = cv2.imencode('.jpg', tile, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    return jpeg.tobytes() if ret_jpg else b''

@app.route("/api/cameras/<int:cam_id>/snapshot")
def camera_snapshot(cam_id):
    """High-speed discrete snapshot endpoint for multi-camera grid tiles without socket blocking."""
    jpeg_bytes = get_camera_frame_jpeg(cam_id)
    return Response(
        jpeg_bytes,
        mimetype="image/jpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.route("/api/matrix_feed")
def matrix_feed():
    """Unified composite stream stitching all active cameras into a single video wall feed (1 HTTP socket)."""
    import cv2
    import numpy as np
    
    def generate_matrix_composite():
        while True:
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM cameras ORDER BY id ASC")
                cameras = cursor.fetchall()
                conn.close()
            except Exception:
                cameras = []
                
            if not cameras:
                cameras = [{"id": 1, "name": "Camera 1", "camera_type": "webcam", "location": "Store"}]
                
            # Create a 3x2 Grid Canvas (960x720)
            wall = np.full((720, 960, 3), 15, dtype=np.uint8)
            
            # Position coordinates for 3x2 grid
            grid_slots = [
                (0, 0, 480, 360),     # Row 1, Col 1
                (480, 0, 480, 360),   # Row 1, Col 2
                (0, 360, 480, 360),   # Row 2, Col 1
                (480, 360, 480, 360), # Row 2, Col 2
                (0, 0, 320, 240),     # Fallbacks if more cams
                (320, 0, 320, 240),
            ]
            
            # Draw 6-camera 3x2 layout: 3 columns x 2 rows
            col_w, row_h = 320, 360
            for idx, cam in enumerate(cameras[:6]):
                c_id = cam["id"]
                col_idx = idx % 3
                row_idx = idx // 3
                x1 = col_idx * col_w
                y1 = row_idx * row_h
                
                # Fetch frame
                if c_id == engine.camera_id and engine.latest_frame is not None:
                    tile_img = cv2.resize(engine.latest_frame, (col_w, row_h))
                    cv2.rectangle(tile_img, (0, 0), (col_w, row_h), (0, 180, 255), 2)
                    cv2.putText(tile_img, "PRIMARY AI ACTIVE", (col_w - 145, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 100), 1)
                else:
                    jpg_data = get_camera_frame_jpeg(c_id)
                    nparr = np.frombuffer(jpg_data, np.uint8)
                    tile_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if tile_img is not None:
                        tile_img = cv2.resize(tile_img, (col_w, row_h))
                    else:
                        tile_img = np.full((row_h, col_w, 3), 30, dtype=np.uint8)
                        
                # Border line
                cv2.rectangle(tile_img, (0, 0), (col_w - 1, row_h - 1), (50, 60, 75), 1)
                wall[y1:y1 + row_h, x1:x1 + col_w] = tile_img
                
            ret_jpg, jpeg = cv2.imencode('.jpg', wall, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if ret_jpg:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
            time.sleep(0.04) # ~25 FPS composite stream
            
    return Response(generate_matrix_composite(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/cameras/<int:cam_id>/video_feed")
def camera_video_feed(cam_id):
    """Streams live video for a specific camera in single camera views."""
    if cam_id == engine.camera_id:
        return Response(generate_video_stream(),
                        mimetype='multipart/x-mixed-replace; boundary=frame')
    else:
        def generate_secondary_stream():
            while True:
                if cam_id == engine.camera_id:
                    frame_bytes = engine.get_jpeg_frame()
                else:
                    frame_bytes = get_camera_frame_jpeg(cam_id)
                if frame_bytes:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                time.sleep(0.05)
        return Response(generate_secondary_stream(),
                        mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/api/all_zones", methods=["GET"])
def get_all_zones():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM zones")
    rows = cursor.fetchall()
    zones = []
    for r in rows:
        z = dict(r)
        try:
            z["coords"] = json.loads(z["coords"])
        except Exception:
            pass
        zones.append(z)
    conn.close()
    return jsonify({"zones": zones})

@app.route("/api/zones", methods=["GET", "POST"])
def manage_zones():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if request.method == "POST":
        data = request.json or {}
        name = data.get("name", "Zone")
        zone_type = data.get("zone_type", "shelf_zone")
        coords = json.dumps(data.get("coords", {"x": 100, "y": 100, "width": 200, "height": 200}))
        sensitivity = float(data.get("sensitivity", 0.75))
        camera_id = int(data.get("camera_id", engine.camera_id))
        
        zone_id = data.get("id")
        if zone_id:
            cursor.execute("""
            UPDATE zones SET name = ?, zone_type = ?, coords = ?, sensitivity = ?, camera_id = ? WHERE id = ?
            """, (name, zone_type, coords, sensitivity, camera_id, zone_id))
        else:
            cursor.execute("""
            INSERT INTO zones (camera_id, name, zone_type, coords, sensitivity)
            VALUES (?, ?, ?, ?, ?)
            """, (camera_id, name, zone_type, coords, sensitivity))
            zone_id = cursor.lastrowid
            
        conn.commit()
        conn.close()
        return jsonify({"success": True, "zone_id": zone_id})
        
    target_camera_id = request.args.get("camera_id")
    if target_camera_id:
        try:
            target_camera_id = int(target_camera_id)
        except Exception:
            target_camera_id = engine.camera_id
    else:
        target_camera_id = engine.camera_id
        
    cursor.execute("SELECT * FROM zones WHERE camera_id = ?", (target_camera_id,))
    rows = cursor.fetchall()
    zones = []
    for r in rows:
        z = dict(r)
        try:
            z["coords"] = json.loads(z["coords"])
        except Exception:
            pass
        zones.append(z)
    conn.close()
    return jsonify({"zones": zones})

@app.route("/api/zones/preset", methods=["POST"])
def apply_zone_preset():
    data = request.get_json(silent=True) or {}
    preset_name = data.get("preset", "laptop_side")
    camera_id = int(data.get("camera_id", engine.camera_id))
    
    presets = {
        "laptop_side": [
            ("Left Shelf Pick Zone", "shelf_zone", json.dumps({"x": 20, "y": 60, "width": 190, "height": 280}), 0.8),
            ("Right Concealment / Pocket ROI", "pocket_concealment_zone", json.dumps({"x": 430, "y": 270, "width": 190, "height": 190}), 0.75),
            ("Checkout Scanning Plane", "checkout_zone", json.dumps({"x": 430, "y": 60, "width": 190, "height": 190}), 0.7)
        ],
        "desk_face_clear": [
            ("Left Item Rack", "shelf_zone", json.dumps({"x": 20, "y": 50, "width": 180, "height": 280}), 0.8),
            ("Right Hand Concealment ROI", "pocket_concealment_zone", json.dumps({"x": 440, "y": 260, "width": 180, "height": 200}), 0.75)
        ],
        "top_down_aisle": [
            ("Top Shelf Rack (Items)", "shelf_zone", json.dumps({"x": 60, "y": 40, "width": 520, "height": 150}), 0.85),
            ("Bottom Cart / Pocket Zone", "pocket_concealment_zone", json.dumps({"x": 100, "y": 290, "width": 440, "height": 170}), 0.8),
            ("Aisle Center Blindspot", "blind_spot", json.dumps({"x": 200, "y": 140, "width": 240, "height": 180}), 0.7)
        ],
        "checkout_counter": [
            ("Left Conveyor Belt", "shelf_zone", json.dumps({"x": 30, "y": 100, "width": 190, "height": 300}), 0.8),
            ("Center Barcode Scanner Plane", "checkout_zone", json.dumps({"x": 240, "y": 140, "width": 160, "height": 240}), 0.85),
            ("Right Bagging & Concealment ROI", "pocket_concealment_zone", json.dumps({"x": 420, "y": 160, "width": 200, "height": 280}), 0.75)
        ],
        "full_shelf_showcase": [
            ("Upper Showcase Rack", "shelf_zone", json.dumps({"x": 40, "y": 40, "width": 560, "height": 160}), 0.85),
            ("Lower Bag / Pocket Zone", "pocket_concealment_zone", json.dumps({"x": 80, "y": 280, "width": 480, "height": 180}), 0.8)
        ],
        "mobile_portrait": [
            ("Top Showcase ROI (Phone)", "shelf_zone", json.dumps({"x": 60, "y": 30, "width": 520, "height": 200}), 0.8),
            ("Bottom Concealment ROI (Phone)", "pocket_concealment_zone", json.dumps({"x": 60, "y": 260, "width": 520, "height": 200}), 0.75)
        ],
        "high_value_jewelry": [
            ("Glass Display Case (Pick ROI)", "shelf_zone", json.dumps({"x": 100, "y": 70, "width": 440, "height": 240}), 0.85),
            ("Bottom Pocket / Bag Drop", "pocket_concealment_zone", json.dumps({"x": 100, "y": 330, "width": 440, "height": 130}), 0.8),
            ("Case Approach Blindspot", "blind_spot", json.dumps({"x": 40, "y": 40, "width": 560, "height": 400}), 0.65)
        ],
        "clear_all": []
    }
    
    selected = presets.get(preset_name, presets["desk_face_clear"])
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM zones WHERE camera_id = ?", (camera_id,))
    
    for item in selected:
        cursor.execute("""
        INSERT INTO zones (camera_id, name, zone_type, coords, sensitivity)
        VALUES (?, ?, ?, ?, ?)
        """, (camera_id, item[0], item[1], item[2], item[3]))
        
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"Applied preset '{preset_name}'"})

@app.route("/api/zones/<int:zone_id>", methods=["DELETE"])
def delete_zone(zone_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM zones WHERE id = ?", (zone_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/toggle_camera", methods=["POST"])
def toggle_camera():
    """Explicitly releases or re-enables the camera hardware."""
    data = request.get_json(silent=True) or {}
    if "enable" in data:
        if data["enable"]:
            engine.enable_camera()
        else:
            engine.release_camera()
    else:
        # Flip current state
        if engine.camera_turned_off:
            engine.enable_camera()
        else:
            engine.release_camera()
            
    return jsonify({"success": True, "camera_on": not engine.camera_turned_off})

@app.route("/api/toggle_ai", methods=["POST"])
def toggle_ai():
    """Arms or disarms AI behavior detection."""
    data = request.get_json(silent=True) or {}
    if "armed" in data:
        engine.detection_enabled = bool(data["armed"])
    else:
        # Flip current state
        engine.detection_enabled = not engine.detection_enabled
        
    return jsonify({"success": True, "armed": engine.detection_enabled})

@app.route("/api/clear_events", methods=["POST"])
def clear_events():
    """Clears event history."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM theft_events")
    cursor.execute("DELETE FROM behavior_logs")
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "All event logs cleared."})

@app.route("/api/trigger_test_alert", methods=["POST"])
def trigger_test_alert():
    """Allows instant manual triggering of a theft alert for testing sound, notifications, clips."""
    data = request.json or {}
    event_type = data.get("event_type", "CONCEALMENT_DETECTED")
    severity = data.get("severity", "CRITICAL")
    confidence = float(data.get("confidence", 0.94))
    zone = data.get("zone", "Left Shelf Pick Zone")
    
    clean_frame = engine.latest_clean_frame
    if clean_frame is None:
        import numpy as np
        clean_frame = np.full((480, 640, 3), 220, dtype=np.uint8)
        
    engine._trigger_theft_event(
        event_type=event_type,
        confidence=confidence,
        severity=severity,
        zone_name=zone,
        clean_frame=clean_frame
    )
    return jsonify({"success": True, "message": f"Test {event_type} alert triggered successfully!"})

@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.json or {}
    if "sensitivity" in data:
        engine.sensitivity = float(data["sensitivity"])
    if "loitering_threshold" in data:
        engine.loitering_threshold = float(data["loitering_threshold"])
    if "concealment_timeout" in data:
        engine.concealment_timeout = max(1.0, min(30.0, float(data["concealment_timeout"])))
    if "detection_enabled" in data:
        engine.detection_enabled = bool(data["detection_enabled"])
    if "show_overlays" in data:
        engine.show_overlays = bool(data["show_overlays"])
    return jsonify({"success": True, "settings": {
        "sensitivity": engine.sensitivity,
        "loitering_threshold": engine.loitering_threshold,
        "concealment_timeout": engine.concealment_timeout,
        "detection_enabled": engine.detection_enabled,
        "show_overlays": engine.show_overlays
    }})

@app.route("/api/export_csv")
def export_csv():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM theft_events ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    
    csv_data = "Event ID,UID,Camera,Type,Confidence,Severity,Zone,Status,Timestamp,Notes\n"
    for r in rows:
        notes_clean = str(r["notes"] or "").replace('"', '""')
        csv_data += f'"{r["id"]}","{r["event_uid"]}","{r["camera_name"]}","{r["event_type"]}","{r["confidence"]}","{r["severity"]}","{r["zone_name"]}","{r["status"]}","{r["timestamp"]}","{notes_clean}"\n'
        
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-disposition": "attachment; filename=theft_control_audit_log.csv"}
    )

if __name__ == "__main__":
    print("===============================================================")
    print(" [AEGISVISION] SUPERMARKET CCTV AI THEFT CONTROL & PREVENTION")
    print("===============================================================")
    print(" Web Dashboard: http://localhost:5000")
    print(" Storage Path:  E:\\theftcontrol\\WorkingFiles\\storage")
    print(" Database:      E:\\theftcontrol\\WorkingFiles\\database\\theft_control.db")
    print("===============================================================")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
