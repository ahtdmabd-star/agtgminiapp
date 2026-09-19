<?php
$host = 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com';
$port = '14363';
$dbname = 'defaultdb';
$username = 'avnadmin';
$password = 'AVNS_hhfXItvXPam49_lMnOU';

try {
    $pdo = new PDO("mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'Database connection failed: ' . $e->getMessage()]);
    exit();
}
?>
