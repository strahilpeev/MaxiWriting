<?php
// Статистика за собственика (admin_emails): посещения по дни и игри.
//   {"days": 400} → { days: { "2026-11-17": { v, vu, p, pu, g: { "app/mode": [пъти, потребители] } } },
//                     periods: { "7": { users, games: { "app/mode": потребители } }, "30": …, "365": … } }
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
$who = maxi_auth();
if (!maxi_is_admin($who)) maxi_fail(403, 'not-admin');
date_default_timezone_set('Europe/Sofia');

$want = max(1, min(800, (int)(maxi_body()['days'] ?? 400)));
$from = date('Y-m-d', time() - ($want - 1) * 86400);
$today = date('Y-m-d');
$days = [];
$periods = [7 => [], 30 => [], 365 => []];   // за уникални потребители: множества по период
$cut = [];
foreach (array_keys($periods) as $p) $cut[$p] = date('Y-m-d', time() - ($p - 1) * 86400);

foreach (glob(maxi_stats_dir() . '/*.json') ?: [] as $f) {
    $month = basename($f, '.json');
    if (!preg_match('/^\d{4}-\d{2}$/', $month) || $month < substr($from, 0, 7)) continue;
    $m = json_decode((string)file_get_contents($f), true);
    if (!is_array($m)) continue;
    foreach ($m as $d => $day) {
        if ($d < $from || $d > $today || !is_array($day)) continue;
        $games = [];
        $plays = 0; $pu = [];
        foreach (($day['g'] ?? []) as $g => $x) {
            $games[$g] = [(int)$x['n'], count($x['u'] ?? [])];
            $plays += (int)$x['n'];
            $pu += ($x['u'] ?? []);
        }
        $days[$d] = ['v' => (int)($day['v'] ?? 0), 'vu' => count($day['vu'] ?? []), 'p' => $plays, 'pu' => count($pu), 'g' => $games];
        foreach ($periods as $p => &$set) {
            if ($d < $cut[$p]) continue;
            $set['_users'] = ($set['_users'] ?? []) + ($day['vu'] ?? []) + $pu;
            foreach (($day['g'] ?? []) as $g => $x) $set[$g] = ($set[$g] ?? []) + ($x['u'] ?? []);
        }
        unset($set);
    }
}
ksort($days);
$out = [];
foreach ($periods as $p => $set) {
    $games = [];
    foreach ($set as $g => $u) if ($g !== '_users') $games[$g] = count($u);
    $out[(string)$p] = ['users' => count($set['_users'] ?? []), 'games' => $games];
}
maxi_json(200, ['ok' => true, 'today' => $today, 'from' => $from, 'days' => $days, 'periods' => $out]);
