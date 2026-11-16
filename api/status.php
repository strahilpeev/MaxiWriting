<?php
// Има ли акаунтът достъп: пробен период, абонамент, код за достъп или безплатен достъп.
declare(strict_types=1);
require __DIR__ . '/lib.php';
maxi_require_post();
$who = maxi_auth();
$u = maxi_user($who);
maxi_json(200, ['ok' => true, 'now' => time()] + maxi_status($who, $u) + (maxi_is_admin($who) ? ['admin' => true] : []));
