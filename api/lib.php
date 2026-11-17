<?php
// Общи функции за абонамента: настройки, проверка на входа (Firebase) и Stripe.
//
// Тайните (ключът на Stripe) НЕ са тук, а във файл извън публичната папка:
//   /storage/tapbooke/maxi-private/config-test.php   (за test.tapnime.eu)
//   /storage/tapbooke/maxi-private/config-live.php   (за tapnime.eu)
// Образец: api/config.example.php

declare(strict_types=1);

const MAXI_PRIVATE = '/storage/tapbooke/maxi-private';

function maxi_env(): string {
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    return (strpos($host, 'test.') === 0 || $host === 'localhost' || strpos($host, 'localhost:') === 0) ? 'test' : 'live';
}
function maxi_config_file(): string { return getenv('MAXI_CONFIG') ?: (MAXI_PRIVATE . '/config-' . maxi_env() . '.php'); }

function maxi_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $env = maxi_env();
    $file = maxi_config_file();
    if (!is_file($file)) maxi_fail(503, 'not-configured');
    $cfg = require $file;
    $cfg['env'] = $env;
    $cfg += ['trial_days' => 14, 'free_emails' => [], 'firebase_project' => 'maxiwriting'];
    // Кой може да създава кодове за достъп (по подразбиране — акаунтите с безплатен достъп).
    if (!isset($cfg['admin_emails'])) $cfg['admin_emails'] = $cfg['free_emails'];
    if (empty($cfg['data_dir'])) $cfg['data_dir'] = MAXI_PRIVATE . "/data-$env";
    if (!is_dir($cfg['data_dir'])) @mkdir($cfg['data_dir'], 0700, true);
    return $cfg;
}

function maxi_json(int $code, array $data): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function maxi_fail(int $code, string $error): void { maxi_json($code, ['ok' => false, 'error' => $error]); }

// Само POST от същия сайт.
function maxi_require_post(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') maxi_fail(405, 'method');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        if (!$host || strcasecmp($host, (string)($_SERVER['HTTP_HOST'] ?? '')) !== 0) maxi_fail(403, 'origin');
    }
}
function maxi_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

/* ---------------- Проверка на Firebase ID token (RS256) ---------------- */

function b64url_decode(string $s): string {
    $s = strtr($s, '-_', '+/');
    return base64_decode($s . str_repeat('=', (4 - strlen($s) % 4) % 4), true) ?: '';
}

function google_certs(): array {
    $cfg = maxi_config();
    if ($f = getenv('MAXI_CERTS_FILE')) return json_decode((string)file_get_contents($f), true) ?: [];  // само за тестове
    $cache = $cfg['data_dir'] . '/google-certs.json';
    if (is_file($cache)) {
        $c = json_decode((string)file_get_contents($cache), true);
        if (is_array($c) && ($c['exp'] ?? 0) > time() && !empty($c['certs'])) return $c['certs'];
    }
    $url = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 10]);
    $resp = curl_exec($ch);
    if ($resp === false) maxi_fail(502, 'certs');
    $hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $headers = substr($resp, 0, $hsize);
    $certs = json_decode(substr($resp, $hsize), true);
    if (!is_array($certs) || !$certs) maxi_fail(502, 'certs');
    $maxAge = preg_match('/max-age=(\d+)/i', $headers, $m) ? (int)$m[1] : 3600;
    @file_put_contents($cache, json_encode(['exp' => time() + $maxAge, 'certs' => $certs]), LOCK_EX);
    return $certs;
}

// Връща данните от токена (uid, email, email_verified) или спира с 401.
function maxi_auth(): array {
    $cfg = maxi_config();
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)$/', trim($h), $m)) maxi_fail(401, 'no-token');
    [$h64, $p64, $s64] = explode('.', $m[1]);
    $header = json_decode(b64url_decode($h64), true);
    $claims = json_decode(b64url_decode($p64), true);
    if (!is_array($header) || !is_array($claims) || ($header['alg'] ?? '') !== 'RS256') maxi_fail(401, 'bad-token');
    $certs = google_certs();
    $kid = (string)($header['kid'] ?? '');
    if (!isset($certs[$kid])) maxi_fail(401, 'bad-token');
    $ok = openssl_verify("$h64.$p64", b64url_decode($s64), $certs[$kid], OPENSSL_ALGO_SHA256);
    if ($ok !== 1) maxi_fail(401, 'bad-token');
    $proj = $cfg['firebase_project'];
    $now = time();
    if (($claims['aud'] ?? '') !== $proj
        || ($claims['iss'] ?? '') !== "https://securetoken.google.com/$proj"
        || (int)($claims['exp'] ?? 0) < $now
        || (int)($claims['iat'] ?? 0) > $now + 300
        || !preg_match('/^[A-Za-z0-9]{1,128}$/', (string)($claims['sub'] ?? ''))
        || (($claims['firebase']['sign_in_provider'] ?? '') === 'anonymous')) {
        maxi_fail(401, 'bad-token');
    }
    return [
        'uid' => (string)$claims['sub'],
        'email' => strtolower((string)($claims['email'] ?? '')),
        'verified' => !empty($claims['email_verified']),
    ];
}

/* ---------------- Запис за всеки акаунт (начало на пробния период, клиент в Stripe) ---------------- */

function maxi_user_file(string $uid): string { return maxi_config()['data_dir'] . "/users/$uid.json"; }
function maxi_user_load(string $uid): array {
    $f = maxi_user_file($uid);
    if (!is_file($f)) return [];
    $j = json_decode((string)file_get_contents($f), true);
    return is_array($j) ? $j : [];
}
function maxi_user_save(string $uid, array $data): void {
    $dir = dirname(maxi_user_file($uid));
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    file_put_contents(maxi_user_file($uid), json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
}
// Пробният период започва при първата проверка на акаунта.
function maxi_user(array $who): array {
    $u = maxi_user_load($who['uid']);
    $changed = false;
    if (empty($u['firstSeen'])) { $u['firstSeen'] = time(); $changed = true; }
    if ($who['email'] && ($u['email'] ?? '') !== $who['email']) { $u['email'] = $who['email']; $changed = true; }
    if ($changed) maxi_user_save($who['uid'], $u);
    return $u;
}

/* ---------------- Stripe (REST, без външни библиотеки) ---------------- */

function stripe(string $method, string $path, array $params = []): array {
    $cfg = maxi_config();
    $url = (getenv('MAXI_STRIPE_BASE') ?: 'https://api.stripe.com/v1/') . ltrim($path, '/');  // MAXI_STRIPE_BASE само за тестове
    $body = http_build_query($params, '', '&', PHP_QUERY_RFC1738);
    if ($method === 'GET' && $body !== '') { $url .= '?' . $body; $body = ''; }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_USERPWD => $cfg['stripe_secret'] . ':',
        CURLOPT_HTTPHEADER => ['Stripe-Version: 2025-03-31.basil'],
    ]);
    if ($method !== 'GET') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $j = is_string($resp) ? json_decode($resp, true) : null;
    if (!is_array($j) || $code >= 400) {
        error_log('stripe ' . $method . ' ' . $path . ' ' . $code . ' ' . (is_string($resp) ? substr($resp, 0, 500) : 'no response'));
        maxi_fail(502, 'stripe');
    }
    return $j;
}

function maxi_customer(array $who, array &$u): string {
    if (!empty($u['customer'])) return $u['customer'];
    $c = stripe('POST', 'customers', [
        'email' => $who['email'] ?: null,
        'metadata' => ['uid' => $who['uid']],
        'preferred_locales' => ['bg'],
    ]);
    $u['customer'] = $c['id'];
    maxi_user_save($who['uid'], $u);
    return $u['customer'];
}

// Текущото състояние на достъпа за акаунта.
function maxi_status(array $who, array $u): array {
    $cfg = maxi_config();
    $now = time();
    $trialEnds = (int)$u['firstSeen'] + 86400 * (int)$cfg['trial_days'];

    if ($who['verified'] && in_array($who['email'], array_map('strtolower', (array)$cfg['free_emails']), true)) {
        return ['active' => true, 'kind' => 'free'];
    }
    // Код за достъп: без срок или до определена дата (и не е спрян от собственика).
    if (!empty($u['code']['code'])) {
        $until = $u['code']['until'] ?? null;
        $c = maxi_codes_load()[$u['code']['code']] ?? null;
        if ($c && empty($c['revoked']) && ($c['usedBy'] ?? '') === $who['uid'] && ($until === null || (int)$until > $now)) {
            return ['active' => true, 'kind' => 'code', 'until' => $until === null ? null : (int)$until];
        }
    }
    if (!empty($u['customer'])) {
        $subs = stripe('GET', 'subscriptions', ['customer' => $u['customer'], 'status' => 'all', 'limit' => 10]);
        $best = null;
        foreach ($subs['data'] ?? [] as $s) {
            if (!in_array($s['status'], ['active', 'trialing', 'past_due'], true)) continue;
            if (!$best || ($s['created'] ?? 0) > ($best['created'] ?? 0)) $best = $s;
        }
        if ($best) {
            $item = $best['items']['data'][0] ?? [];
            $periodEnd = (int)($item['current_period_end'] ?? $best['current_period_end'] ?? 0);
            $interval = $item['price']['recurring']['interval'] ?? ($item['plan']['interval'] ?? '');
            return [
                'active' => true,
                'kind' => 'subscription',
                'status' => $best['status'],
                'interval' => $interval,
                'periodEnd' => $periodEnd,
                'cancelAtPeriodEnd' => !empty($best['cancel_at_period_end']),
                'trialEnds' => $best['status'] === 'trialing' ? (int)($best['trial_end'] ?? 0) : null,
            ];
        }
    }
    return ['active' => $now < $trialEnds, 'kind' => 'trial', 'trialEnds' => $trialEnds, 'trialDays' => (int)$cfg['trial_days']];
}

/* ---------------- Кодове за достъп ----------------
   Еднократен код отключва игрите за един акаунт без плащане — без срок или за N дни.
   Кодовете се пазят в data_dir/codes.json (извън публичната папка):
     { "ABCD2345EFGH6789": { "created": 1700000000, "days": null, "note": "…",
                             "usedBy": "uid", "usedAt": 1700000000, "email": "…", "revoked": false } }
   Показват се като MAXI-ABCD-2345-EFGH-6789: 16 случайни знака от 31 (≈79 бита, random_int) —
   не могат да се налучкат. Букви без лесни за бъркане знаци (няма I, L, O, 0, 1).
   Всеки код се използва само веднъж. Старите 8-знакови кодове (MAXI-XXXX-XXXX) още се приемат. */

const MAXI_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function maxi_is_admin(array $who): bool {
    return $who['verified'] && $who['email'] !== ''
        && in_array($who['email'], array_map('strtolower', (array)maxi_config()['admin_emails']), true);
}

// „maxi-abcd 2345 …“, „МАХI…“ на кирилица и т.н. → „ABCD2345…“ (16 знака; 8 при старите кодове).
function maxi_code_norm(string $s): string {
    static $cyr = ['А'=>'A','В'=>'B','Е'=>'E','К'=>'K','М'=>'M','Н'=>'H','О'=>'O','Р'=>'P','С'=>'C','Т'=>'T','Х'=>'X','У'=>'Y',
                   'а'=>'A','в'=>'B','е'=>'E','к'=>'K','м'=>'M','н'=>'H','о'=>'O','р'=>'P','с'=>'C','т'=>'T','х'=>'X','у'=>'Y'];
    $s = strtoupper(strtr(substr($s, 0, 256), $cyr));
    $s = preg_replace('/[^A-Z0-9]/', '', $s);
    if ((strlen($s) === 20 || strlen($s) === 12) && strpos($s, 'MAXI') === 0) $s = substr($s, 4);
    return (strlen($s) === 16 || strlen($s) === 8) ? $s : '';
}
function maxi_code_show(string $k): string { return 'MAXI-' . implode('-', str_split($k, 4)); }

function maxi_codes_file(): string { return maxi_config()['data_dir'] . '/codes.json'; }
function maxi_codes_load(): array {
    $f = maxi_codes_file();
    if (!is_file($f)) return [];
    $j = json_decode((string)file_get_contents($f), true);
    return is_array($j) ? $j : [];
}
// Промяна на кодовете под заключване (два таблета да не вземат един код едновременно).
function maxi_codes_tx(callable $fn) {
    $h = fopen(maxi_codes_file(), 'c+');
    if (!$h) maxi_fail(500, 'storage');
    flock($h, LOCK_EX);
    $raw = stream_get_contents($h);
    $codes = json_decode((string)$raw, true);
    if (!is_array($codes)) $codes = [];
    $result = $fn($codes);
    ftruncate($h, 0); rewind($h);
    fwrite($h, json_encode($codes, JSON_UNESCAPED_UNICODE));
    fflush($h); flock($h, LOCK_UN); fclose($h);
    @chmod(maxi_codes_file(), 0600);
    return $result;
}
function maxi_code_new(array $codes): string {
    $n = strlen(MAXI_CODE_ALPHABET);
    do {
        $k = '';
        for ($i = 0; $i < 16; $i++) $k .= MAXI_CODE_ALPHABET[random_int(0, $n - 1)];
    } while (isset($codes[$k]));
    return $k;
}

/* ---------------- Статистика ----------------
   Анонимно броене на посещения и игри. Устройството праща случаен ключ (без имена,
   имейли или IP); сървърът пази само съкратен HMAC от него, за да брои „различни
   потребители“. Файлове: data_dir/stats/ГГГГ-ММ.json
     { "2026-11-17": { "v": 12, "vu": {"a1b2…":1}, "g": { "dvizhenie/konturi": { "n": 5, "u": {"a1b2…":1} } } } }
   Работи и без config (тогава data_dir = maxi-private/data-<env>). */

function maxi_data_dir(): string {
    if (is_file(maxi_config_file())) return maxi_config()['data_dir'];
    $d = MAXI_PRIVATE . '/data-' . maxi_env();
    if (!is_dir($d)) @mkdir($d, 0700, true);
    return $d;
}
function maxi_stats_dir(): string {
    $d = maxi_data_dir() . '/stats';
    if (!is_dir($d)) @mkdir($d, 0700, true);
    return $d;
}
function maxi_stats_salt(): string {
    $f = maxi_stats_dir() . '/salt.txt';
    if (!is_file($f)) { file_put_contents($f, bin2hex(random_bytes(16)), LOCK_EX); @chmod($f, 0600); }
    return trim((string)file_get_contents($f));
}
// JSON файл под заключване: $fn получава масива по референция.
function maxi_json_tx(string $file, callable $fn) {
    $h = fopen($file, 'c+');
    if (!$h) maxi_fail(500, 'storage');
    flock($h, LOCK_EX);
    $data = json_decode((string)stream_get_contents($h), true);
    if (!is_array($data)) $data = [];
    $r = $fn($data);
    ftruncate($h, 0); rewind($h);
    fwrite($h, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($h); flock($h, LOCK_UN); fclose($h);
    @chmod($file, 0600);
    return $r;
}

