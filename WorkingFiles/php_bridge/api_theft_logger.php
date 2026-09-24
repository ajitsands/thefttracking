<?php
/**
 * PHP Theft Event Receiver & Logger Bridge
 * Receives JSON webhook payloads from Python CCTV AI Engine or handles incident management.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// MySQL Database Credentials (Configured with user credentials)
$dbHost = 'localhost';
$dbUser = 'root';
$dbPass = 'S@nds1@b';
$dbName = 'theft_control_db';

try {
    $pdo = new PDO("mysql:host={$dbHost};dbname={$dbName};charset=utf8mb4", $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    // If MySQL connection fails, fallback to reading SQLite database in WorkingFiles
    $sqlitePath = dirname(__DIR__) . '/database/theft_control.db';
    if (file_exists($sqlitePath)) {
        $pdo = new PDO("sqlite:" . $sqlitePath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    } else {
        echo json_encode(["status" => "error", "message" => "Database connection unavailable: " . $e->getMessage()]);
        exit;
    }
}

$action = $_GET['action'] ?? 'get_events';

switch ($action) {
    case 'log_event':
        // Python AI Engine posts detected theft event
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || empty($input['event_type'])) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Invalid event data"]);
            exit;
        }

        $stmt = $pdo->prepare("
            INSERT INTO theft_events (
                event_uid, camera_id, camera_name, event_type, confidence, severity, zone_name, snapshot_path, clip_path, status, notes
            ) VALUES (
                :event_uid, :camera_id, :camera_name, :event_type, :confidence, :severity, :zone_name, :snapshot_path, :clip_path, :status, :notes
            )
        ");

        $stmt->execute([
            ':event_uid'     => $input['event_uid'] ?? ('EVT-' . time()),
            ':camera_id'     => $input['camera_id'] ?? 1,
            ':camera_name'   => $input['camera_name'] ?? 'CCTV Camera',
            ':event_type'    => $input['event_type'],
            ':confidence'    => $input['confidence'] ?? 0.85,
            ':severity'      => $input['severity'] ?? 'HIGH',
            ':zone_name'     => $input['zone_name'] ?? 'General Shelf Area',
            ':snapshot_path' => $input['snapshot_path'] ?? null,
            ':clip_path'     => $input['clip_path'] ?? null,
            ':status'        => 'PENDING_REVIEW',
            ':notes'         => $input['notes'] ?? 'Auto-logged via PHP API bridge'
        ]);

        echo json_encode(["status" => "success", "message" => "Theft event logged into database"]);
        break;

    case 'get_events':
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
        $stmt = $pdo->prepare("SELECT * FROM theft_events ORDER BY id DESC LIMIT :limit");
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $events = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(["status" => "success", "count" => count($events), "data" => $events]);
        break;

    default:
        echo json_encode(["status" => "error", "message" => "Unknown action"]);
        break;
}
