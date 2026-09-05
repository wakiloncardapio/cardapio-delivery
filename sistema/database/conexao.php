<?php
declare(strict_types=1);

function loadEnvFile(): void {
    $path = dirname(__DIR__, 2) . '/.env';
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        if ($key !== '' && getenv($key) === false) putenv($key . '=' . $value);
    }
}
loadEnvFile();

function db(): ?PDO {
    static $pdo = false;
    if ($pdo !== false) return $pdo ?: null;
    $host = getenv('DB_HOST'); $name = getenv('DB_NAME'); $user = getenv('DB_USER'); $pass = getenv('DB_PASS');
    if (!$host || !$name || !$user) { $pdo = null; return null; }
    try {
        $pdo = new PDO("mysql:host={$host};dbname={$name};charset=utf8mb4", $user, $pass ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return $pdo;
    } catch (Throwable $e) { $pdo = null; return null; }
}
