<?php
// Портал на Stripe: смяна на карта, фактури, спиране на абонамента.
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
$cfg = maxi_config();
$who = maxi_auth();
$u = maxi_user($who);
if (empty($u['customer'])) maxi_fail(404, 'no-customer');
$s = stripe('POST', 'billing_portal/sessions', [
    'customer' => $u['customer'],
    'return_url' => rtrim($cfg['site'], '/') . '/app.html',
    'locale' => 'bg',
]);
maxi_json(200, ['ok' => true, 'url' => $s['url']]);
