# 🛒 AegisVision - Supermarket AI CCTV Theft Control & Prevention System

A real-time, AI-driven CCTV surveillance and theft behavior detection system built with **Python (Computer Vision & Behavior Engine)** and a **Light/Dark Modern Web Dashboard**, with complete **PHP & MySQL integration bridges**.

---

## 🚀 Quick Start (1-Click Run & 1-Click Stop)

* **To Start**: Double-click **`run_theft_control.bat`** in this folder (`E:\theftcontrol\`).
  The web interface will automatically open at **`http://localhost:5000`**.
* **To Stop & Turn Off Camera**: Double-click **`stop_theft_control.bat`** to completely terminate all background processes and turn off your camera light immediately.

---

## 🛡️ Drive Isolation Guarantee (C: Drive Protection)

As requested, **no files, cache, or models are saved on your C: drive**. Everything is strictly isolated inside `E:\theftcontrol\WorkingFiles\`:
- **Python Virtual Environment**: `E:\theftcontrol\WorkingFiles\venv\`
- **Database (SQLite / MySQL schema)**: `E:\theftcontrol\WorkingFiles\database\theft_control.db`
- **Video Evidence MP4 Clips**: `E:\theftcontrol\WorkingFiles\storage\clips\`
- **High-Resolution JPEG Snapshots**: `E:\theftcontrol\WorkingFiles\storage\snapshots\`
- **AI Models & Weights**: `E:\theftcontrol\WorkingFiles\models\`
- **PHP & MySQL Bridge**: `E:\theftcontrol\WorkingFiles\php_bridge\`
- **Pip & Python Cache**: `E:\theftcontrol\WorkingFiles\pip_cache\` & `pycache\`

---

## 📱 How to Use Your Laptop Cam or Mobile Device for Testing

### Option 1: Laptop Built-in Webcam
- Under **Camera Setup** tab, select **"Laptop / USB Webcam"** and enter device index `0`.
- Position yourself in front of the camera:
  - Wave hand in the upper **"Shelf Pick Zone"**.
  - Move hand downward into the lower **"Pocket / Waistline Zone"**.
  - The AI will detect the downward concealment vector and automatically trigger a **`CONCEALMENT_DETECTED`** alert with an audio chime and save a 5-second `.mp4` video clip!

### Option 2: Mobile Phone as a Wireless CCTV Camera (Over Wi-Fi)
1. **Android**: Install the free app **"IP Webcam"** (by Pavel Khlebovich) from Google Play.
   **iPhone/iOS**: Install **"Live-Reporter"** or **"IP Camera Lite"** from App Store.
2. Connect your mobile phone to the **same Wi-Fi network** as your laptop.
3. Open the app and tap **"Start Server"**.
4. The app will display an IP address, e.g.: `http://192.168.1.15:8080/video`.
5. In AegisVision -> **Camera Setup** tab:
   - Camera Name: `Mobile Cam Aisle 2`
   - Type: `Mobile Phone IP Camera`
   - Source URL: `http://192.168.1.15:8080/video`
   - Click **Add & Save Camera** -> **Switch to Feed**.

### Option 3: Real CCTV RTSP Stream (For Tomorrow)
When you bring your supermarket CCTV camera/NVR/DVR tomorrow:
- Connect the camera to your network switch/router.
- In **Camera Setup** tab:
  - Source URL: `rtsp://username:password@192.168.1.200:554/h264Preview_01_main` (or the RTSP link provided by your Hikvision/Dahua/Uniview/Reolink camera).

---

## 🧠 AI Detection Models & Behavior Logic

The system utilizes an automated behavior state machine:
1. **Concealment Detection (Hand to Pocket / Bagging)**:
   - Tracks motion centroids in the upper shelf zone.
   - Computes trajectory vectors transitioning into pocket / waistline boundaries.
2. **Loitering / Suspicious Dwelling**:
   - Measures stationary dwell time in high-value blind spots. If dwell time exceeds $T > 5.0\text{s}$, a loitering warning is generated.
3. **Continuous Rolling Video Pre-Buffer**:
   - A ring buffer holds the preceding 90 frames in memory.
   - When an event occurs, the system records the pre-event context + the action + post-event footage and saves an `.mp4` clip into `WorkingFiles/storage/clips/`.

---

## 🐘 PHP & MySQL Integration (Method B)

If you wish to log events to a MySQL database or use PHP for your management portal:
1. **MySQL Schema**: Import `WorkingFiles/php_bridge/schema.sql` into phpMyAdmin / MySQL Workbench.
2. **PHP Bridge**: `WorkingFiles/php_bridge/api_theft_logger.php` receives webhook JSON payloads from the AI engine or queries theft logs directly.

---

## 🎨 Dashboard Features
- **Horizontal Menu Navigation**: Dashboard, Live CCTV Monitor, Incident Review, Zone & ROI Editor, Camera Setup, and Audit Logs.
- **Pearl White Theme (Default)** with 1-click **Sleek Dark Theme** toggle.
- **Web Audio API Alarm Chime**: Real-time acoustic alert when suspicious behavior is detected.
- **Interactive Evidence Modal**: Play recorded incident clips, zoom into snapshots, add officer notes, and mark incidents as *Confirmed Theft*, *False Alarm*, or *Resolved*.
- **CSV Export**: Export all incident timestamps and logs for security audits.
