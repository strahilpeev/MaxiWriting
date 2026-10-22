<?php
// ОБРАЗЕЦ. Истинският файл е извън публичната папка:
//   /storage/tapbooke/maxi-private/config-test.php  (test.tapnime.eu, тестови ключове sk_test_ / rk_test_)
//   /storage/tapbooke/maxi-private/config-live.php  (tapnime.eu, истински ключове)
// Не качвайте истинските ключове в GitHub.
return [
    // Stripe → Developers → API keys. Препоръчително: ограничен ключ (rk_...) с права
    // Customers: Write, Checkout Sessions: Write, Customer portal: Write, Subscriptions: Read.
    'stripe_secret' => 'rk_test_ПОСТАВЕТЕ_ТУК',
    // Stripe → Product catalog → продукта „Моите учебни игри“ → цените (price_...)
    'prices' => [
        'month' => 'price_ПОСТАВЕТЕ_ТУК',   // 4,99 € на месец
        'year'  => 'price_ПОСТАВЕТЕ_ТУК',   // 49,99 € на година
    ],
    'trial_days' => 14,
    'site' => 'https://test.tapnime.eu',
    // Акаунти с безплатен достъп (потвърден имейл)
    'free_emails' => ['strahil.peev@gmail.com'],
    'firebase_project' => 'maxiwriting',
];
