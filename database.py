import pymysql
import pymysql.cursors
import sqlite3
import os
import json
from datetime import datetime

# MySQL Credentials provided by user
MYSQL_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "S@nds1@b",
    "database": "theft_control_db",
    "port": 3306,
    "charset": "utf8mb4",
    "autocommit": True,
    "cursorclass": pymysql.cursors.DictCursor
}

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "WorkingFiles", "database", "theft_control.db")
USE_MYSQL = True

class UnifiedCursor:
    def __init__(self, raw_cursor, is_mysql=True):
        self.raw_cursor = raw_cursor
        self.is_mysql = is_mysql

    def execute(self, query, params=None):
        if self.is_mysql:
            # Convert SQLite '?' placeholders to MySQL '%s'
            mysql_query = query.replace("?", "%s")
            if params is not None:
                if isinstance(params, (list, tuple)):
                    return self.raw_cursor.execute(mysql_query, params)
                elif isinstance(params, dict):
                    return self.raw_cursor.execute(mysql_query, params)
                else:
                    return self.raw_cursor.execute(mysql_query, (params,))
            return self.raw_cursor.execute(mysql_query)
        else:
            if params is not None:
                return self.raw_cursor.execute(query, params)
            return self.raw_cursor.execute(query)

    def executemany(self, query, params_list):
        if self.is_mysql:
            mysql_query = query.replace("?", "%s")
            return self.raw_cursor.executemany(mysql_query, params_list)
        else:
            return self.raw_cursor.executemany(query, params_list)

    def fetchone(self):
        return self.raw_cursor.fetchone()

    def fetchall(self):
        return self.raw_cursor.fetchall()

    @property
    def lastrowid(self):
        return self.raw_cursor.lastrowid

    def close(self):
        self.raw_cursor.close()

class DBConnectionWrapper:
    def __init__(self, is_mysql=True, mysql_conn=None, sqlite_conn=None):
        self.is_mysql = is_mysql
        self.mysql_conn = mysql_conn
        self.sqlite_conn = sqlite_conn

    def cursor(self):
        if self.is_mysql:
            return UnifiedCursor(self.mysql_conn.cursor(), is_mysql=True)
        else:
            return UnifiedCursor(self.sqlite_conn.cursor(), is_mysql=False)

    def commit(self):
        if self.is_mysql:
            self.mysql_conn.commit()
        else:
            self.sqlite_conn.commit()

    def close(self):
        if self.is_mysql and self.mysql_conn:
            self.mysql_conn.close()
        elif self.sqlite_conn:
            self.sqlite_conn.close()

def get_db_connection():
    global USE_MYSQL
    if USE_MYSQL:
        try:
            # Ensure DB exists
            init_conn = pymysql.connect(
                host=MYSQL_CONFIG["host"],
                user=MYSQL_CONFIG["user"],
                password=MYSQL_CONFIG["password"],
                port=MYSQL_CONFIG["port"]
            )
            with init_conn.cursor() as cur:
                cur.execute(f"CREATE DATABASE IF NOT EXISTS `{MYSQL_CONFIG['database']}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            init_conn.close()

            conn = pymysql.connect(**MYSQL_CONFIG)
            return DBConnectionWrapper(is_mysql=True, mysql_conn=conn)
        except Exception as e:
            print(f"[Database Warning] MySQL connection failed ({e}). Falling back to SQLite.")
            USE_MYSQL = False

    # Fallback to isolated SQLite in WorkingFiles
    os.makedirs(os.path.dirname(SQLITE_PATH), exist_ok=True)
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    return DBConnectionWrapper(is_mysql=False, sqlite_conn=sqlite_conn)

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    if conn.is_mysql:
        # MySQL Schema
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS `cameras` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `name` VARCHAR(100) NOT NULL,
            `camera_type` VARCHAR(50) NOT NULL DEFAULT 'webcam',
            `source` VARCHAR(255) NOT NULL,
            `location` VARCHAR(150) NULL,
            `is_active` TINYINT(1) DEFAULT 1,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS `zones` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `camera_id` INT NOT NULL,
            `name` VARCHAR(100) NOT NULL,
            `zone_type` VARCHAR(50) NOT NULL,
            `coords` TEXT NOT NULL,
            `sensitivity` DECIMAL(3,2) DEFAULT 0.75,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS `theft_events` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `event_uid` VARCHAR(64) UNIQUE NOT NULL,
            `camera_id` INT NULL,
            `camera_name` VARCHAR(100) NULL,
            `event_type` VARCHAR(100) NOT NULL,
            `confidence` DECIMAL(4,2) NOT NULL,
            `severity` VARCHAR(20) NOT NULL DEFAULT 'HIGH',
            `zone_name` VARCHAR(100) NULL,
            `snapshot_path` VARCHAR(255) NULL,
            `clip_path` VARCHAR(255) NULL,
            `status` VARCHAR(50) DEFAULT 'PENDING_REVIEW',
            `reviewed_by` VARCHAR(100) NULL,
            `notes` TEXT NULL,
            `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS `behavior_logs` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `camera_id` INT NULL,
            `event_type` VARCHAR(100) NOT NULL,
            `description` TEXT NOT NULL,
            `details` TEXT NULL,
            `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS `settings` (
            `setting_key` VARCHAR(50) PRIMARY KEY,
            `setting_value` TEXT NULL
        ) ENGINE=InnoDB;
        """)

        # Seed Cameras if empty
        cursor.execute("SELECT COUNT(*) as count FROM cameras")
        row = cursor.fetchone()
        count = row["count"] if isinstance(row, dict) else row[0]
        if count == 0:
            default_cameras = [
                ("Laptop Webcam (Default)", "webcam", "0", "Store Checkout Counter A", 1),
                ("Mobile Phone IP Cam", "mobile_ip", "http://192.168.1.100:8080/video", "Cosmetics & Perfume Aisle", 0),
                ("Supermarket CCTV RTSP 01", "cctv_rtsp", "rtsp://admin:pass@192.168.1.200:554/h264Preview_01_main", "Electronics & High-Value Shelf", 0),
                ("Interactive AI Demo Stream", "demo_sim", "demo", "Liquor & High-Risk Zone B", 0)
            ]
            cursor.executemany("INSERT INTO cameras (name, camera_type, source, location, is_active) VALUES (?, ?, ?, ?, ?)", default_cameras)

        # Seed Zones if empty
        cursor.execute("SELECT COUNT(*) as count FROM zones")
        row = cursor.fetchone()
        count = row["count"] if isinstance(row, dict) else row[0]
        if count == 0:
            default_zones = [
                (1, "Left Shelf Pick Zone", "shelf_zone", json.dumps({"x": 30, "y": 70, "width": 220, "height": 260}), 0.8),
                (1, "Right Concealment / Pocket ROI", "pocket_concealment_zone", json.dumps({"x": 390, "y": 220, "width": 220, "height": 230}), 0.75),
                (1, "Checkout Scanning Plane", "checkout_zone", json.dumps({"x": 390, "y": 70, "width": 220, "height": 180}), 0.7)
            ]
            cursor.executemany("INSERT INTO zones (camera_id, name, zone_type, coords, sensitivity) VALUES (?, ?, ?, ?, ?)", default_zones)

    else:
        # SQLite Schema
        cursor.execute("CREATE TABLE IF NOT EXISTS cameras (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, camera_type TEXT NOT NULL, source TEXT NOT NULL, location TEXT, is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        cursor.execute("CREATE TABLE IF NOT EXISTS zones (id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, name TEXT NOT NULL, zone_type TEXT NOT NULL, coords TEXT NOT NULL, sensitivity REAL DEFAULT 0.75, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        cursor.execute("CREATE TABLE IF NOT EXISTS theft_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_uid TEXT UNIQUE NOT NULL, camera_id INTEGER, camera_name TEXT, event_type TEXT NOT NULL, confidence REAL NOT NULL, severity TEXT NOT NULL, zone_name TEXT, snapshot_path TEXT, clip_path TEXT, status TEXT DEFAULT 'PENDING_REVIEW', reviewed_by TEXT, notes TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        cursor.execute("CREATE TABLE IF NOT EXISTS behavior_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, camera_id INTEGER, event_type TEXT, description TEXT, details TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        cursor.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")

    conn.commit()
    conn.close()

# Auto-initialize on import
init_db()

if __name__ == "__main__":
    conn = get_db_connection()
    db_type = "MySQL (theft_control_db)" if conn.is_mysql else "SQLite"
    conn.close()
    print(f"[Database Initialized] Active Database Engine: {db_type}")
