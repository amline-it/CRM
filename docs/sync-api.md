# قرارداد سینک CRM با سرور اصلی

این سند دقیقاً می‌گوید سرور شما چطور داده را به CRM بفرستد، چطور از CRM بخواند و تغییرات CRM را چطور دریافت کند.
هر سه کانال مستقل‌اند و می‌توانید فقط یکی را فعال کنید:

| کانال | جهت | چه زمانی استفاده شود |
| --- | --- | --- |
| **Push / Ingest** | سرور شما → CRM | CRM هیچ دسترسی به دیتابیس شما ندارد و شما رویدادها را می‌فرستید (پیشنهاد اصلی) |
| **Pull** | CRM → سرور شما | سرور شما endpoint سبک `GET` دارد و CRM هر ۵/۱۵ دقیقه اختلاف‌ها را می‌خوانَد |
| **Webhook خروجی** | CRM → سرور شما | برای اطلاع از رویدادهای پنل: بسته‌شدن پرونده، انتشار آگهی، پرداخت، کد رهگیری |

هر سه با `SYNC_API_KEY` و `SYNC_SECRET` (فایل `.env`) کار می‌کنند.

---

## ۱) Push — سرور شما داده را می‌فرستد

```
POST /api/v1/ingest/users
POST /api/v1/ingest/contracts
POST /api/v1/ingest/listings
POST /api/v1/ingest/requirements
Content-Type: application/json
X-Sync-Key: <SYNC_API_KEY>
X-Signature: sha256=<HMAC-SHA256 با کلید SYNC_SECRET روی بدنه خام>
X-Idempotency-Key: <اختیاری، پیشنهاد می‌شود: شناسه یکتای این ارسال>
X-Sync-Source: main-server
```

**بدنه** یک شیء با فیلدهای زیر است (آرایه خالص هم پذیرفته می‌شود):

```json
{
  "source": "main-server",
  "items": [ { "...": "رکورد" } ]
}
```

* `items` می‌تواند تا صدها رکورد باشد؛ هر رکورد مستقل پردازش می‌شود. **یک رکورد خراب بقیه را از کار نمی‌اندازد.**
* هم‌نام‌های camelCase و snake_case هر دو پذیرفته می‌شوند (`externalId` = `external_id`).
* کلید یکتایی هر رکورد: **(source, externalId)** — همان شناسه در سرور شما.

### پاسخ

```json
{
  "ok": true,
  "entity": "contracts",
  "summary": { "received": 2, "created": 1, "updated": 0, "unchanged": 1, "rejected": 0 },
  "items": [ { "externalId": "c-1001", "action": "created", "id": "case_ab12" } ],
  "syncLogId": "slog_9f1c"
}
```

| کد | معنا |
| --- | --- |
| `200` | پردازش شد (حتی اگر بخشی از آیتم‌ها `rejected` باشند) |
| `401` | کلید یا امضای نامعتبر |
| `404` | نام موجودیت نادرست |
| `503` | در CRM متغیر `SYNC_API_KEY` تنظیم نشده است |
| `422` | بدنه JSON نامعتبر |

اگر `X-Idempotency-Key` بفرستید و همان کلید قبلاً پردازش شده باشد، پاسخِ قبلی بازپخش می‌شود
(`"replayed": true`) و هیچ تغییری در CRM رخ نمی‌دهد. کلیدها ۴۸ ساعت نگه‌داری می‌شوند.

### ۱-۱) کاربران — `POST /api/v1/ingest/users`

| فیلد | الزامی | توضیح |
| --- | --- | --- |
| `externalId` | ✅ | شناسه کاربر در سرور شما |
| `fullName` | ✅ | نام کامل |
| `mobile` | – | موبایل (برای تماس کارشناس) |
| `nationalId` | – | کد ملی |
| `email` | – | ایمیل |
| `userType` | – | `normal` (پیش‌فرض) یا `agent` (مشاور) |
| `agentLicenseNo` | – | شماره پروانه مشاور |
| `city` | – | شهر |
| `status` | – | پیش‌فرض `active` |
| `deleted` | – | `true` = کاربر در سرور اصلی حذف شده (نرم) |

### ۱-۲) قراردادها — `POST /api/v1/ingest/contracts`

| فیلد | الزامی | توضیح |
| --- | --- | --- |
| `externalId` | ✅ | شناسه قرارداد/پرونده در سرور شما |
| `contractType` | – | `rent` (پیش‌فرض) یا `sale` |
| `outputMode` | – | `signature_only` (پیش‌فرض) یا `signature_and_tracking` |
| `title` | – | عنوان پرونده در پنل |
| `ownerExternalId` | – | شناسه کاربر (مالک پرونده) — باید قبلاً سینک شده باشد |
| `agentExternalId` | – | شناسه مشاور |
| `propertyAddress`, `city`, `district`, `area` | – | اطلاعات ملک |
| `landlordName`, `tenantName` | – | برای اجاره (گارد «تکمیل اطلاعات قرارداد» این‌ها را لازم دارد) |
| `sellerName`, `buyerName` | – | برای خرید و فروش |
| `depositAmount`, `rentAmount`, `salePrice` | – | مبالغ به **تومان** |
| `startDate`, `endDate` | – | تاریخ شروع/پایان (متن، مثل `1405/07/01`) |
| `trackingCode` | – | کد رهگیری سامانه املاک (اگر صادر شده) |
| `state` | – | وضعیت گردش‌کار در CRM؛ اگر نفرستید از حالت شروع قرار می‌گیرد |
| `documents` | – | آرایه مدارک: `[{ "kind": "national_landlord", "title": "کارت ملی مالک", "status": "submitted" }]` |
| `deleted` | – | `true` = پرونده در سرور اصلی بسته/حذف شده → در CRM بسته می‌شود |

### ۱-۳) آگهی‌ها — `POST /api/v1/ingest/listings`

`externalId` (✅)، `dealType` (`rent`/`sale`)، `propertyType`، `city`، `district`، `address`، `area`، `rooms`،
`yearBuilt`، `price`، `deposit`، `rent`، `description`، `amenities[]`، `images[]`،
`status` (`draft`/`pending_review`/`published`/`paused`/`expired`/`closed`)، `expiresAt`،
`ownerExternalId`، `agentExternalId`، `deleted`.

### ۱-۴) نیازمندی‌ها — `POST /api/v1/ingest/requirements`

`externalId` (✅)، `dealType`، `propertyType`، `city`، `districts[]`، `budgetMin`، `budgetMax`، `areaMin`،
`areaMax`، `rooms`، `description`، `accessLevel` (`public`/`agents`/`staff`)،
`status` (`open`/`matched`/`fulfilled`/`expired`/`cancelled`)، `expiresAt`، `requesterExternalId`، `deleted`.

### نمونه ارسال (PHP)

```php
<?php
$body = json_encode(['source' => 'main-server', 'items' => [$contract]], JSON_UNESCAPED_UNICODE);
$signature = 'sha256=' . hash_hmac('sha256', $body, getenv('CRM_SYNC_SECRET'));

$ch = curl_init('https://crm.example.com/api/v1/ingest/contracts');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $body,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'X-Sync-Key: ' . getenv('CRM_SYNC_KEY'),
    'X-Signature: ' . $signature,
    'X-Idempotency-Key: contract-' . $contract['id'],
  ],
  CURLOPT_RETURNTRANSFER => true,
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
// 200 = ثبت شد؛ 401 = کلید/امضا را بررسی کنید
```

### نمونه ارسال (Node.js)

```js
import crypto from "node:crypto";

const body = JSON.stringify({ source: "main-server", items: [contract] });
const signature = "sha256=" + crypto.createHmac("sha256", process.env.CRM_SYNC_SECRET).update(body, "utf8").digest("hex");

const response = await fetch("https://crm.example.com/api/v1/ingest/contracts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Sync-Key": process.env.CRM_SYNC_KEY,
    "X-Signature": signature,
    "X-Idempotency-Key": `contract-${contract.id}`,
  },
  body,
});
console.log(response.status, await response.json());
```

> نکته: امضا روی **بدنه خام** محاسبه می‌شود؛ اگر JSON را دوباره سریال می‌کنید، همان رشته‌ای را بفرستید که امضا کردید.

---

## ۲) Pull — CRM از سرور شما می‌خواند

در `.env`:

```
SYNC_PULL_ENABLED=true
SYNC_PULL_URL=https://api.example.com/crm-sync
SYNC_PULL_API_KEY=<کلید خواندن>
SYNC_PULL_INTERVAL_MINUTES=15
```

CRM برای هر موجودیت درخواست می‌زند:

```
GET {SYNC_PULL_URL}/users?since=2026-10-13T08:00:00.000Z
GET {SYNC_PULL_URL}/contracts?since=…
GET {SYNC_PULL_URL}/listings?since=…
GET {SYNC_PULL_URL}/requirements?since=…
X-Sync-Key: <SYNC_PULL_API_KEY>
```

پاسخ باید **همان ساختار Push** باشد: `{ "source": "main-server", "items": [ … ] }`.
CRM فقط رکوردهای تغییرکرده از `since` را می‌خواند و کرسور هر موجودیت را ذخیره می‌کند (اگر `since` را خالی بفرستید،
منتظر «همه رکوردها» نیستیم — می‌توانید همه را برگردانید؛ CRM تکراری‌ها را `unchanged` می‌شمارد).

اجرای دستی واکشی: پنل → «سینک» → «واکشی اکنون» (فقط مدیر) یا:

```bash
curl -X POST -H "X-Sync-Key: $SYNC_API_KEY" https://crm.example.com/api/v1/jobs/dispatch-webhooks
```

---

## ۳) Webhook خروجی — CRM رویدادها را می‌فرستد

در `.env` آدرس گیرنده را بگذارید (یا از پنل → سینک تنظیم کنید):

```
WEBHOOK_TARGET_URL=https://api.example.com/crm-webhook
WEBHOOK_SECRET=<راز امضا؛ اگر خالی باشد از SYNC_SECRET استفاده می‌شود>
```

### رویدادها

| رویداد | چه زمانی |
| --- | --- |
| `case.completed` | پرونده با نتیجه «تکمیل‌شده» بسته شد |
| `case.cancelled` / `case.rejected` | بسته‌شدن با نتیجه دیگر |
| `listing.published` / `listing.paused` / `listing.expired` | تغییر وضعیت آگهی |
| `payment.succeeded` / `payment.failed` | نتیجه پرداخت |
| `tracking.received` / `tracking.failed` | نتیجه کد رهگیری |
| `case.note` | رویدادهای داخلی قابل‌اطلاع طرف مقابل |

### درخواست

```
POST <WEBHOOK_TARGET_URL>
Content-Type: application/json
X-Webhook-Event: case.completed
X-Webhook-Signature: sha256=<HMAC-SHA256 با کلید WEBHOOK_SECRET روی بدنه خام>
X-Webhook-Attempt: 1

{ "event": "case.completed", "data": { "caseId": "case_…", "code": "CRM-C-1405001", "outcome": "completed", "at": "…" } }
```

* پاسخ `2xx` = تحویل‌شده. هر خطا → تلاش دوباره با تأخیر نمایی (۲^تلاش دقیقه، سقف ۲۴ ساعت) تا **۵ تلاش**؛ بعد از آن
  وضعیت رکورد `dead` می‌شود و در پنل → سینک قابل بازگرداندن به صف است.
* Pending ها با cron سرور شما ارسال می‌شوند:

```bash
curl -X POST -H "X-Sync-Key: $SYNC_API_KEY" https://crm.example.com/api/v1/jobs/dispatch-webhooks
# برای بررسی بدون ارسال:
curl https://crm.example.com/api/v1/jobs/dispatch-webhooks
```

### بررسی امضا در سرور شما (PHP)

```php
<?php
$raw = file_get_contents('php://input');
$expected = 'sha256=' . hash_hmac('sha256', $raw, getenv('CRM_WEBHOOK_SECRET'));
if (!hash_equals($expected, $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '')) {
    http_response_code(401);
    exit('invalid signature');
}
$payload = json_decode($raw, true);
switch ($payload['event']) {
    case 'case.completed':
        // مثلاً علامت‌گذاری قرارداد در سیستم شما
        break;
}
http_response_code(200);
```

---

## ۴) پایش

* `GET /api/health` — سلامت سامانه، تعداد رکوردها، اعتبار تعریف‌های گردش‌کار، وضعیت یکپارچه‌سازی‌ها
* پنل → «سینک» — تاریخچه هر ارسال/واکشی، کرسورها، صف وب‌هوک و دکمه‌های دستی
* پنل → «گزارش رویدادها» — همه اقدام‌های کارکنان و سینک‌ها

## ۵) عیب‌یابی رایج

| نشانه | علت احتمالی | راه‌حل |
| --- | --- | --- |
| `401 کلید سینک نامعتبر است` | `X-Sync-Key` غلط یا `SYNC_API_KEY` در CRM تنظیم نشده | کلیدها را در `.env` سرور و CRM یکسان کنید |
| `401 امضای بدنه نامعتبر است` | امضا روی رشته دیگری محاسبه شده (مثلاً بعد از re-encode) | همان بدنه خامی که امضا کردید را بفرستید |
| `503` | `SYNC_API_KEY` در `.env` CRM خالی است | مقدار بدهید و سرویس را ری‌استارت کنید |
| آیتم `rejected` با «شناسه بیرونی … الزامی است» | `externalId` نفرستاده‌اید | شناسه یکتا در سرور خودتان را بفرستید |
| کاربر/مشاور به پرونده وصل نیست | `ownerExternalId` پیش از خودِ کاربر سینک نشده | اول `users` را بفرستید |
| وب‌هوک `dead` می‌شود | آدرس گیرنده خطا می‌دهد | در پنل «بازگشت به صف» بزنید و لاگ گیرنده را ببینید |
