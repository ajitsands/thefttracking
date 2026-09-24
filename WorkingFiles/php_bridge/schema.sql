-- ==========================================================
-- SUPERMARKET CCTV THEFT CONTROL SYSTEM - MYSQL SCHEMA
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `theft_control_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `theft_control_db`;

-- 1. Cameras Configuration
CREATE TABLE IF NOT EXISTS `cameras` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `camera_type` ENUM('webcam', 'mobile_ip', 'cctv_rtsp', 'demo_sim') NOT NULL DEFAULT 'webcam',
    `source` VARCHAR(255) NOT NULL, -- e.g. '0', 'http://192.168.1.50:8080/video', 'rtsp://user:pass@192.168.1.100:554/stream'
    `location` VARCHAR(150) NULL,
    `is_active` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Regions of Interest / Detection Zones
CREATE TABLE IF NOT EXISTS `zones` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `camera_id` INT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `zone_type` ENUM('shelf_zone', 'pocket_concealment_zone', 'checkout_zone', 'blind_spot') NOT NULL,
    `coords` JSON NOT NULL, -- {"x": 100, "y": 60, "width": 400, "height": 200}
    `sensitivity` DECIMAL(3,2) DEFAULT 0.75,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Theft Detection Events & Incidents
CREATE TABLE IF NOT EXISTS `theft_events` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `event_uid` VARCHAR(64) UNIQUE NOT NULL,
    `camera_id` INT NOT NULL,
    `camera_name` VARCHAR(100) NOT NULL,
    `event_type` VARCHAR(100) NOT NULL, -- 'CONCEALMENT_DETECTED', 'LOITERING_SUSPICIOUS', 'CHECKOUT_BYPASS', 'SHELF_SWEEP'
    `confidence` DECIMAL(4,2) NOT NULL,
    `severity` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'HIGH',
    `zone_name` VARCHAR(100) NULL,
    `snapshot_path` VARCHAR(255) NULL,
    `clip_path` VARCHAR(255) NULL,
    `status` ENUM('PENDING_REVIEW', 'CONFIRMED_THEFT', 'FALSE_ALARM', 'RESOLVED') DEFAULT 'PENDING_REVIEW',
    `reviewed_by` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_timestamp` (`timestamp`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- 4. Behavior Audit Trail
CREATE TABLE IF NOT EXISTS `behavior_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `camera_id` INT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `description` TEXT NOT NULL,
    `details` JSON NULL,
    `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
