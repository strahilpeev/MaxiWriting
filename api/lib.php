<?php
// Общи функции за абонамента: настройки, проверка на входа (Firebase) и Stripe.
//
// Тайните (ключът на Stripe) НЕ са тук, а във файл извън публичната папка:
//   /storage/tapbooke/maxi-private/config-test.php   (за test.tapnime.eu)
//   /storage/tapbooke/maxi-private/config-live.php   (за tapnime.eu)
// Образец: api/config.example.php

declare(strict_types=1);

const MAXI_PRIVATE = '/storage/tapbooke/maxi-private';

function maxi_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $env = (strpos($host, 'test.') === 0 || $host === 'localhost' || strpos($host, 'localhost:') === 0) ? 'test' : 'live';
    $file = getenv('MAXI_CONFIG') ?: (MAXI_PRIVATE . "/config-$env.php");
    if (!is_file($file)) maxi_fail(503, 'not-configured');
    $cfg = require $file;
    $cfg['env'] = $env;
    $cfg += ['trial_days' => 14, 'free_emails' => [], 'firebase_project' => 'maxiwriting'];
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
