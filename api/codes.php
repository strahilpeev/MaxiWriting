<?php
// Кодове за достъп — само за собственика (admin_emails в настройките, потвърден имейл).
//   {"action":"create","count":5,"days":null,"note":"Училище №1"}  → нови кодове
//   {"action":"list"}                                              → всички кодове
//   {"action":"revoke","code":"MAXI-ABCD-2345"}                    → спира код (и достъпа по него)
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
$who = maxi_auth();
if (!maxi_is_admin($who)) maxi_fail(403, 'not-admin');
$b = maxi_body();
$action = (string)($b['action'] ?? '');
$now = time();

function codes_view(array $codes): array {
    $out = [];
    foreach ($codes as $k => $c) {
        $out[] = [
            'code' => maxi_code_show((string)$k),
            'created' => (int)($c['created'] ?? 0),
            'days' => isset($c['days']) && $c['days'] !== null ? (int)$c['days'] : null,
            'note' => (string)($c['note'] ?? ''),
            'usedAt' => isset($c['usedAt']) ? (int)$c['usedAt'] : null,
            'email' => (string)($c['email'] ?? ''),
            'revoked' => !empty($c['revoked']),
        ];
    }
    usort($out, fn($a, $b) => $b['created'] <=> $a['created'] ?: strcmp($a['code'], $b['code']));
    return $out;
}

if ($action === 'create') {
    $count = (int)($b['count'] ?? 1);
    if ($count < 1 || $count > 50) maxi_fail(400, 'count');
    $days = $b['days'] ?? null;
    if ($days !== null && $days !== '') {
        $days = (int)$days;
        if ($days < 1 || $days > 3650) maxi_fail(400, 'days');
    } else $days = null;
    $note = trim(preg_replace('/\s+/u', ' ', (string)($b['note'] ?? '')) ?? '');
    if (strlen($note) > 300) $note = substr($note, 0, 300);
    $new = maxi_codes_tx(function (array &$codes) use ($count, $days, $note, $now) {
        $made = [];
        for ($i = 0; $i < $count; $i++) {
            $k = maxi_code_new($codes);
            $codes[$k] = ['created' => $now, 'days' => $days, 'note' => $note, 'usedBy' => null];
            $made[$k] = $codes[$k];
        }
        return $made;
    });
    maxi_json(200, ['ok' => true, 'codes' => codes_view($new)]);
}
if ($action === 'list') {
    maxi_json(200, ['ok' => true, 'codes' => codes_view(maxi_codes_load())]);
}
if ($action === 'revoke') {
    $k = maxi_code_norm((string)($b['code'] ?? ''));
    $ok = maxi_codes_tx(function (array &$codes) use ($k) {
        if ($k === '' || !isset($codes[$k])) return false;
        $codes[$k]['revoked'] = true;
        return true;
    });
    if (!$ok) maxi_fail(404, 'no-code');
    maxi_json(200, ['ok' => true]);
}
maxi_fail(400, 'action');
