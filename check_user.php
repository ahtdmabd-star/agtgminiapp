<?php
header('Content-Type: application/json');
require_once 'db.php';

$telegram_id = $_GET['telegram_id'] ?? null;
$bot_token = '8651381547:AAEqN3SWGvC9bmK7OGb4Nnesf4tCGVyUjzI'; 
$channel = '@AHTG_OFFICIAL'; 
$group = '@ahtgofic'; 

if (!$telegram_id) {
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized Access']);
    exit;
}

// ফাংশন: টেলিগ্রাম এপিআই দিয়ে মেম্বারশিপ চেক করার জন্য
function checkMembership($bot_token, $chat_id, $telegram_id) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, "https://api.telegram.org/bot{$bot_token}/getChatMember?chat_id={$chat_id}&user_id={$telegram_id}");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    $output = curl_exec($ch);
    curl_close($ch);
    
    $res = json_decode($output, true);
    if (isset($res['ok']) && $res['ok'] == true) {
        $status = $res['result']['status'];
        if (in_array($status, ['member', 'administrator', 'creator'])) {
            return true;
        }
    }
    return false;
}

// ১. চ্যানেল এবং গ্রুপ উভয় জায়গায় চেক করা
$is_channel_member = checkMembership($bot_token, $channel, $telegram_id);
$is_group_member = checkMembership($bot_token, $group, $telegram_id);

$is_verified = ($is_channel_member && $is_group_member);
$telegram_status_val = $is_verified ? 'verified' : 'unverified';

// ২. ডাটাবেজে ইউজারের টেলিগ্রাম স্ট্যাটাস আপডেট করা
$update_status = $conn->prepare("UPDATE users SET telegram_status = ? WHERE telegram_id = ?");
$update_status->bind_param("ss", $telegram_status_val, $telegram_id);
$update_status->execute();

if (!$is_verified) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Please join both our official channel and group to proceed!',
        'redirect' => 'join_required',
        'channel_url' => 'https://t.me/AHTG_OFFICIAL',
        'group_url' => 'https://t.me/ahtgofic'
    ]);
    exit;
}

// ৩. ডাটাবেজ থেকে ইউজার এবং রোল ফেচ করা
$stmt = $conn->prepare("SELECT telegram_id, username, first_name, role, balance, referrals, status, telegram_status FROM users WHERE telegram_id = ?");
$stmt->bind_param("s", $telegram_id);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows > 0) {
    $user = $result->fetch_assoc();
    
    if ($user['status'] !== 'active') {
        echo json_encode(['status' => 'error', 'message' => 'Your account is banned or inactive.']);
        exit;
    }

    echo json_encode([
        'status' => 'success',
        'role' => $user['role'], // 'admin' বা 'user'
        'user' => $user
    ]);
} else {
    echo json_encode([
        'status' => 'error',
        'message' => 'Account not found! Please start the bot first.'
    ]);
}
?>
