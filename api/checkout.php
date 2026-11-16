<?php
// Създава плащане в Stripe Checkout и връща адреса, към който да отиде родителят.
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
$cfg = maxi_config();
$who = maxi_auth();
$u = maxi_user($who);
$plan = (string)(maxi_body()['plan'] ?? '');
$price = $cfg['prices'][$plan] ?? '';
if (!$price) maxi_fail(400, 'plan');

$st = maxi_status($who, $u);
if ($st['kind'] === 'subscription' || $st['kind'] === 'free' || ($st['kind'] === 'code' && $st['until'] === null)) maxi_fail(409, 'already-active');

$customer = maxi_customer($who, $u);
$site = rtrim($cfg['site'], '/');
$params = [
    'mode' => 'subscription',
    'customer' => $customer,
    'client_reference_id' => $who['uid'],
    'line_items' => [['price' => $price, 'quantity' => 1]],
    'locale' => 'bg',
    'allow_promotion_codes' => 'true',
    'success_url' => $site . '/app.html?abonament=ok',
    'cancel_url' => $site . '/app.html?abonament=otkaz',
    'subscription_data' => ['metadata' => ['uid' => $who['uid'], 'plan' => $plan]],
];
// Абонирали се по време на пробния период или на код със срок → плащането започва,
// когато той свърши (Stripe иска поне 48 часа напред).
$paidUntil = $st['trialEnds'] ?? ($st['kind'] === 'code' ? $st['until'] : null);
if (!empty($paidUntil) && $paidUntil > time() + 49 * 3600) {
    $params['subscription_data']['trial_end'] = $paidUntil;
}
$s = stripe('POST', 'checkout/sessions', $params);
maxi_json(200, ['ok' => true, 'url' => $s['url']]);
