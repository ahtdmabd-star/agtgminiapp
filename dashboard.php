<?php
require_once 'db.php';
$telegram_id = $_GET['telegram_id'] ?? null;

if (!$telegram_id) {
    die("Unauthorized Access!");
}

$stmt = $conn->prepare("SELECT * FROM users WHERE telegram_id = ? AND role != 'admin'");
$stmt->bind_param("s", $telegram_id);
$stmt->execute();
$result = $stmt->get_result();
if ($result->num_rows === 0) {
    die("Access Denied or Invalid Role!");
}
$user = $result->fetch_assoc();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>User Dashboard - AL-HUDA TASK</title>
    <style>
        body { background: #0f172a; color: #fff; font-family: sans-serif; text-align: center; padding: 20px; }
        .card { background: #1e293b; padding: 20px; border-radius: 12px; margin: 15px auto; max-width: 400px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        .balance { font-size: 24px; color: #38bdf8; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h2>Welcome, <?php echo htmlspecialchars($user['first_name']); ?>! 👋</h2>
        <p>Telegram Status: <b style="color: #4ade80;"><?php echo strtoupper($user['telegram_status']); ?></b></p>
        <div class="balance">Balance: $<?php echo $user['balance']; ?></div>
        <p>Total Referrals: <?php echo $user['referrals']; ?></p>
    </div>
</body>
</html>
