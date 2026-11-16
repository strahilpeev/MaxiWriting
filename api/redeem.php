<?php
// Код за достъп: родителят въвежда еднократен код и игрите се отключват без плащане.
// Всеки код се използва само веднъж (един акаунт, едно въвеждане). До 10 грешни опита на час за акаунт.
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
$who = maxi_auth();
$u = maxi_user($who);
$now = time();

$tries = array_values(array_filter((array)($u['codeTries'] ?? []), fn($t) => (int)$t > $now - 3600));
if (count($tries) >= 10) maxi_fail(429, 'too-many');

$st = maxi_status($who, $u);
if ($st['kind'] === 'free' || ($st['kind'] === 'code' && $st['until'] === null)) maxi_fail(409, 'already-active');

$code = maxi_code_norm((string)(maxi_body()['code'] ?? ''));
$res = maxi_codes_tx(function (array &$codes) use ($code, $who, $now) {
    if ($code === '' || !isset($codes[$code]) || !empty($codes[$code]['revoked'])) return 'invalid';
    $c = &$codes[$code];
    if (!empty($c['usedBy'])) return 'used';
    $c['usedBy'] = $who['uid']; $c['usedAt'] = $now; $c['email'] = $who['email'];
    return $c;
});

if (is_string($res)) {
    $tries[] = $now;
    $u['codeTries'] = $tries;
    maxi_user_save($who['uid'], $u);
    maxi_fail($res === 'used' ? 409 : 400, $res);
}

$days = isset($res['days']) && $res['days'] !== null ? (int)$res['days'] : null;
$u['code'] = [
    'code' => $code,
    'since' => (int)$res['usedAt'],
    'until' => $days ? (int)$res['usedAt'] + 86400 * $days : null,
];
unset($u['codeTries']);
maxi_user_save($who['uid'], $u);
maxi_json(200, ['ok' => true, 'now' => $now] + maxi_status($who, $u) + (maxi_is_admin($who) ? ['admin' => true] : []));
