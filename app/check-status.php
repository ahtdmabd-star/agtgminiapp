<?php
header('Content-Type: application/json');
require_once '../config/db-connect.php';

$telegramId = $_GET['telegram_id'] ?? '';

if (empty($telegramId)) {
    echo json_encode(['success' => false, 'message' => 'Invalid Telegram ID']);
    exit();
}

try {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE telegram_id = ?");
    $stmt->execute([$telegramId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user) {
        // এখানে ধরা হলো ডাটাবেজে ভেরিফিকেশন স্ট্যাটাসের কলামের নাম 'status' বা 'is_verified'
        $isVerified = isset($user['status']) && strtolower($user['status']) === 'verified';
        
        echo json_encode([
            'success' => true,
            'verified' => $isVerified,
            'userData' => $user
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'User account not found in database.']);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
?>
