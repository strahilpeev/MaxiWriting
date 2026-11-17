<?php
// Анонимна статистика: устройството праща натрупаните събития (посещения и игри).
//   {"e":[{"t":"v","d":"2026-11-17","u":"<случаен ключ>"},
//         {"t":"g","g":"dvizhenie/konturi","d":"2026-11-17","u":"…"}]}
// Без вход. Пазят се само бройки и съкратен HMAC на ключа (за „различни потребители“).
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
date_default_timezone_set('Europe/Sofia');

$ev = maxi_body()['e'] ?? null;
if (!is_array($ev)) maxi_fail(400, 'events');
$ev = array_slice($ev, 0, 100);
$min = date('Y-m-d', time() - 35 * 86400);   // офлайн таблет може да прати и по-стари
$max = date('Y-m-d', time() + 86400);
$salt = maxi_stats_salt();

$byMonth = [];
foreach ($ev as $e) {
    if (!is_array($e)) continue;
    $t = $e['t'] ?? '';
    $d = (string)($e['d'] ?? '');
    $u = (string)($e['u'] ?? '');
    $g = (string)($e['g'] ?? '');
    if (($t !== 'v' && $t !== 'g') || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || $d < $min || $d > $max) continue;
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $u)) continue;
    if ($t === 'g' && !preg_match('#^[a-z0-9_-]{1,32}(/[a-z0-9_-]{1,32})?$#', $g)) continue;
    $byMonth[substr($d, 0, 7)][] = [$t, $d, substr(hash_hmac('sha256', $u, $salt), 0, 12), $g];
}
foreach ($byMonth as $month => $list) {
    maxi_json_tx(maxi_stats_dir() . "/$month.json", function (array &$m) use ($list) {
        foreach ($list as [$t, $d, $h, $g]) {
            $day = &$m[$d];
            if (!is_array($day)) $day = ['v' => 0, 'vu' => [], 'g' => []];
            if ($t === 'v') {
                $day['v']++;
                $day['vu'][$h] = 1;
            } else {
                if (!isset($day['g'][$g])) {
                    if (count($day['g']) >= 200) continue;   // защита от боклук
                    $day['g'][$g] = ['n' => 0, 'u' => []];
                }
                if ($day['g'][$g]['n'] >= 100000) continue;
                $day['g'][$g]['n']++;
                $day['g'][$g]['u'][$h] = 1;
            }
            unset($day);
        }
    });
}
http_response_code(204);
