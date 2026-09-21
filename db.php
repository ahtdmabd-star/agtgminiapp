<?php
$host = 'mysql-14cc93c7-alhudatechglobal-601b.i.aivencloud.com';
$user = 'avnadmin';                          
$pass = 'AVNS_hhfXItvXPam49_lMnOU';             
$dbname = 'defaultdb';                       
$port = 14363; 

$conn = mysqli_init();
$conn->real_connect($host, $user, $pass, $dbname, $port, NULL, MYSQLI_CLIENT_SSL);

if ($conn->connect_error) {
    die(json_encode(['status' => 'error', 'message' => 'Database Connection Failed']));
}
$conn->set_charset("utf8mb4");
?>
