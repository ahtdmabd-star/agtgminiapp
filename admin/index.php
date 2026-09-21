<?php
require_once '../db.php';
$telegram_id = $_GET['telegram_id'] ?? null;

if (!$telegram_id) {
    die("Unauthorized Access!");
}

// নিখুঁত নিরাপত্তা: শুধুমাত্র অ্যাডমিন রোলধারীরাই ঢুকতে পারবে
$stmt = $conn->prepare("SELECT * FROM users WHERE telegram_id = ? AND role = 'admin'");
$stmt->bind_param("s", $telegram_id);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows === 0) {
    die("Access Denied! Administrators only.");
}
$admin = $result->fetch_assoc();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Admin Dashboard - AL-HUDA TASK</title>
    <style>
        body { background: #1e1b4b; color: #fff; font-family: sans-serif; text-align: center; padding: 20px; }
        .card { background: #312e81; padding: 20px; border-radius: 12px; margin: 15px auto; max-width: 400px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
    </style>
</head>
<body>
    <div class="card">
        <h2>👑 Admin Control Panel</h2>
        <p>Welcome, <?php echo htmlspecialchars($admin['first_name']); ?></p>
        <p>Status: <b style="color: #4ade80;"><?php echo strtoupper($admin['telegram_status']); ?></b></p>
        <hr style="border-color: #4338ca;">
        <p>Full Admin Privileges Loaded Securely.</p>
    </div>
</body>
</html>
