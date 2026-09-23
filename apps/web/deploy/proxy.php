<?php
/**
 * PoE2 Kit — CORS-прокси для веб-приложения на хостинге Beget.
 *
 * Зачем: poe.ninja / poe2scout.com / trade API не отдают Access-Control-Allow-Origin,
 * поэтому браузер напрямую их запросить не может. Этот скрипт работает на сервере,
 * ходит в сторонний API по cURL и возвращает ответ тому же хосту (без CORS-проблем).
 *
 * Структура URL:  /poe2kit/proxy/<service>/<путь до API>
 *   service: poeninja | scout | trade | repower
 *   Пример:  /poe2kit/proxy/scout/poe2/Leagues
 *            /poe2kit/proxy/poeninja/poe2/api/economy/exchange/current/overview?league=...
 *            /poe2kit/proxy/trade/api/trade2/search/...
 *
 * Безопасность: только GET/POST, разрешены только фиксированные хосты, длина пути
 * ограничена. Никакой учётки не требуется. Кэш не используется (ответы живые).
 */

declare(strict_types=1);

// Только эти хосты разрешены в качестве апстримов — подмена невозможна.
const UPSTREAMS = [
    'poeninja' => 'https://poe.ninja',
    'scout'    => 'https://api.poe2scout.com',
    'trade'    => 'https://www.pathofexile.com',
    'repower'  => 'https://repoe-fork.github.io',
];

const MAX_UPSTREAM_BYTES = 5_000_000; // 5 МБ — хватит на любые снапшоты цен
const TIMEOUT_S = 15;

function respond_json(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function bad_request(string $msg): void {
    respond_json(400, ['error' => 'bad_request', 'detail' => $msg]);
}

// ── Разбор пути: относительно каталога прокси берём <service>/<рест> ──
// Base-путь приложения (например, "/poe2kit"). Если файл лежит в
// <base>/proxy/proxy.php, вычисляем base как часть URI до "/proxy/".
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '/';

// Найдём "/proxy/" в пути — всё до него это BASE, всё после него это <service>/<рест>.
$pos = strpos($uri, '/proxy/');
if ($pos === false) {
    bad_request('Не найдена часть "/proxy/" в пути.');
}
$rest = substr($uri, $pos + strlen('/proxy/')); // например "scout/poe2/Leagues"

// Отделяем service
$slash = strpos($rest, '/');
if ($slash === false) {
    bad_request('Укажите сервис: poeninja | scout | trade | repower.');
}
$service = substr($rest, 0, $slash);
$upstreamPath = substr($rest, $slash + 1); // "/poe2/Leagues" (с ведущим слэшем)

if (!array_key_exists($service, UPSTREAMS)) {
    bad_request('Неизвестный сервис. Разрешены: ' . implode(', ', array_keys(UPSTREAMS)) . '.');
}
if (strlen($upstreamPath) > 512) {
    bad_request('Слишком длинный путь.');
}

// ── Метод ──
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    bad_request('Метод не поддерживается (только GET/POST).');
}

// Собираем полный upstream-URL: путь + query-строка.
$query = $_SERVER['QUERY_STRING'] ?? '';
$url = UPSTREAMS[$service] . $upstreamPath . ($query !== '' ? '?' . $query : '');

if (!filter_var($url, FILTER_VALIDATE_URL)) {
    bad_request('Некорректный URL апстрима.');
}

// ── GET/POST тело ──
$body = false;
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = $raw === false ? '' : $raw;
}

// ── cURL-запрос ──
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 4,
    CURLOPT_CONNECTTIMEOUT => TIMEOUT_S,
    CURLOPT_TIMEOUT        => TIMEOUT_S,
    CURLOPT_USERAGENT      => 'poe2-kit/0.2 (web; beget-host)',
    CURLOPT_HTTPHEADER     => [
        'Accept: application/json',
        'Accept-Language: en-US,en;q=0.9',
        ($method === 'POST') ? 'Content-Type: application/json' : '',
    ],
]);
if ($method === 'POST' && $body !== false) {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$upstreamContentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

if ($response === false) {
    respond_json(502, ['error' => 'upstream_unreachable', 'detail' => $err]);
}

// Обрезаем слишком большие ответы.
if (strlen($response) > MAX_UPSTREAM_BYTES) {
    $response = substr($response, 0, MAX_UPSTREAM_BYTES);
}

// Прокидываем ответ.
http_response_code($code);
header('Content-Type: ' . ($upstreamContentType !== '' ? $upstreamContentType : 'application/octet-stream'), true);
echo $response;
exit;