# راهنمای استقرار (self-hosted)

CRM روی سرور خودتان اجرا می‌شود؛ هیچ داده‌ای جای دیگری نمی‌رود. دو روش دارد: **داکر** (پیشنهادی) و **اجرای مستقیم با Node**.

## پیش‌نیازها

| روش | پیش‌نیاز |
| --- | --- |
| داکر | Docker 24+ و docker compose |
| Node | Node **۲۲.۵ یا بالاتر** (از SQLite داخلی Node استفاده می‌شود) |

منابع پیشنهادی: ۱ vCPU و ۱GB RAM برای دفتر کوچک کافی است (سامانه سبک است).

---

## الف) استقرار با داکر (پیشنهادی)

```bash
git clone <مخزن> crm && cd crm      # یا کپی پوشه پروژه روی سرور
cp .env.example .env
nano .env                            # مقادیر بخش «حداقل تنظیمات» را پر کنید
docker compose up -d --build
docker compose logs -f crm           # تا دیدن پیام آماده‌شدن
```

دسترسی: `http://IP-سرور:3000`

در هر بالا آمدن، مهاجرت‌ها و ثبت تعریف‌های گردش‌کار خودکار اجرا می‌شود.

### حساب مدیر اولیه

```bash
docker compose exec crm node --no-warnings scripts/seed.mjs --staff admin:Admin@1234:مدیر
```

یا از مرورگر: اگر هیچ کارمندی وجود نداشته باشد، صفحه ورود فرم «ساخت حساب مدیر» را نشان می‌دهد.

### پشتیبان‌گیری

```bash
docker compose exec crm sh -c 'cp /data/crm.db /data/backup-$(date +%F).db'
docker cp crm-realestate:/data/backup-$(date +%F).db ./
```

کل دیتابیس یک فایل SQLite است (`/data/crm.db`)؛ برای بازیابی همان فایل را برگردانید.

### به‌روزرسانی نسخه

```bash
git pull
docker compose up -d --build      # مهاجرت‌های جدید خودکار اعمال می‌شوند
```

---

## ب) اجرای مستقیم با Node (بدون داکر)

```bash
cp .env.example .env && nano .env
npm ci
npm run setup                     # migrate + seed
npm run build
npm start                         # پورت پیش‌فرض ۳۰۰۰
```

برای اجرای دائمی با systemd:

```ini
# /etc/systemd/system/crm.service
[Unit]
Description=CRM Real Estate
After=network.target

[Service]
WorkingDirectory=/opt/crm
EnvironmentFile=/opt/crm/.env
ExecStart=/usr/bin/npm start
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now crm
```

---

## پشت Nginx + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name crm.example.com;

    ssl_certificate     /etc/letsencrypt/live/crm.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.example.com/privkey.pem;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

نکته‌ها:

* در `.env` مقدار `APP_URL` را روی دامنه واقعی بگذارید.
* اگر از HTTPS استفاده می‌کنید، `NODE_ENV=production` باشد تا کوکی نشست `Secure` شود.
* `ALLOWED_DEV_ORIGINS` فقط برای محیط توسعه لازم است.

## حالت نمایش محلی (LOCAL_DEMO_MODE) — فقط برای ماشین خودتان

برای اینکه بدون ورود، پنل را ببینید، روی **همان ماشین توسعه** این را در `.env.local` بگذارید:

```env
LOCAL_DEMO_MODE=true
```

نتیجه: صفحه ورود غیرفعال می‌شود، هر بازدید با نقش **مدیر** وارد پنل می‌شود و بالای پنل یک نشان
زرد «حالت نمایش محلی · ورود غیرفعال» دیده می‌شود. هیچ ردیف نشستی هم در دیتابیس ساخته نمی‌شود.

⚠️ **روی سرور واقعی هرگز این متغیر را true نکنید** — با فعال‌بودن آن، احراز هویت عملاً خاموش می‌شود.

چرا روی سرور شما فعال نمی‌شود:
* پیش‌فرض خاموش است؛ فقط مقدار دقیق `true` آن را روشن می‌کند (`1`، `yes` و... کار نمی‌کنند).
* این متغیر فقط در `.env.local` تنظیم شده که در گیت ذخیره نمی‌شود و در ایمیج داکر نیست.
* در `docker-compose.yml` صریحاً `LOCAL_DEMO_MODE: "false"` ست شده است، پس حتی اگر متغیر محیطی
  هم جایی جا بماند، کانتینر سرور آن را نادیده می‌گیرد.
* در `.env.example` مقدار پیش‌فرض `false` است.

برای بازگرداندن حالت عادی کافی است خط `LOCAL_DEMO_MODE=true` را از `.env.local` بردارید و سرور را
دوباره اجرا کنید؛ آن‌وقت ورود اجباری و همه لایه‌های امنیتی مثل قبل کار می‌کنند.

## استقرار داخل iframe یا محیط‌هایی که کوکی را مسدود می‌کنند

اگر پنل را داخل iframe (پیش‌نمایش‌های زنده) یا روی دامنه‌ای متفاوت باز می‌کنید، بعضی مرورگرها کوکی نشست را
ذخیره/ارسال نمی‌کنند و کاربر با هر کلیک به صفحه ورود برمی‌گردد. سامانه برای این حالت سه لایه محافظت دارد و
خودش تصمیم می‌گیرد کدام لایه لازم است:

۱) **کوکی سازگار با iframe** — با تنظیم زیر، کوکی نشست به‌صورت `Secure; SameSite=None; Partitioned` صادر می‌شود:

```env
SESSION_COOKIE_SAMESITE=none   # نیازمند HTTPS
```

۲) **توکن امضاشده در حافظه + هدر** — پس از ورود، توکن نشست در مرورگر (حافظه و در صورت امکان
localStorage) نگه داشته می‌شود و پل نشست، `fetch` سراسری مرورگر را می‌پوشاند؛ بنابراین همه درخواست‌ها
(ناوبری‌های SPA روتر Next، اکشن‌های فرم، درخواست‌های API) هدر `X-Session-Ticket` می‌گیرند. سرور این هدر را
دقیقاً مثل کوکی اعتبارسنجی می‌کند (امضا + ردیف نشست در دیتابیس + انقضا + امکان باطل‌کردن).
برای خاموش‌کردن این مسیر: `ALLOW_HEADER_SESSION=false`

۳) **توکن در آدرس (`?t=…`)** — برای اینکه ناوبری کامل صفحه و رفرش (F5) هم نشست را از دست ندهد، توکن در
آدرس نگه داشته می‌شود و پروکسی سمت سرور آن را به هدر تبدیل می‌کند. (هدر `Referrer-Policy: same-origin`
مانع نشت توکن به سایت‌های دیگر می‌شود.)

روی سرور اختصاصی شما کوکی کار می‌کند، پس پنل بلافاصله پس از ورود پارامتر `?t=` را از آدرس پاک می‌کند و
آدرس تمیز می‌ماند؛ توکن فقط در حافظه مرورگر می‌ماند تا اگر کوکی از بین رفت، کاربر بدون ورود مجدد
ادامه دهد.

CSRF هم مستقل از کوکی است: توکن فرم امضاشده (HMAC) و بدون‌حالت است، پس در همه این حالت‌ها فرم‌ها کار می‌کنند.

## زمان‌بندی کارهای دوره‌ای (cron)

```cron
# ارسال وب‌هوک‌های در انتظار — هر دقیقه
* * * * * curl -s -X POST -H "X-Sync-Key: $SYNC_API_KEY" http://127.0.0.1:3000/api/v1/jobs/dispatch-webhooks > /dev/null

# واکشی داده از سرور اصلی — هر ۱۵ دقیقه (اگر کانال Pull را فعال کرده‌اید)
*/15 * * * * curl -s -X POST -H "X-Sync-Key: $SYNC_API_KEY" http://127.0.0.1:3000/api/v1/jobs/pull > /dev/null
```

> کانال Pull همچنین از پنل → «سینک» → «واکشی اکنون» قابل اجراست. اگر فقط Push دارید، نیازی به این cron نیست.

## حداقل تنظیمات `.env`

```env
APP_URL=https://crm.example.com
SESSION_SECRET=<openssl rand -hex 32>
SYNC_API_KEY=<کلید تصادفی برای سرور شما>
SYNC_SECRET=<راز تصادفی برای امضای HMAC>
WEBHOOK_TARGET_URL=https://api.example.com/crm-webhook
WEBHOOK_SECRET=<راز امضای وب‌هوک>
NODE_ENV=production
```

برای ساخت مقادیر تصادفی: `openssl rand -hex 32`

## چک‌لیست پس از استقرار

- [ ] `GET /api/health` پاسخ `ok: true` می‌دهد
- [ ] ورود با حساب مدیر انجام شد و رمز پیش‌فرض عوض شد
- [ ] در پنل → «کارشناسان» برای هر کارمند حساب ساخته شد (نقش: کارشناس یا مدیر)
- [ ] در پنل → «خدمات» خدمات و مدارک لازم هر خدمت بازبینی شد
- [ ] سرور اصلی با `curl` یک رکورد آزمایشی به `/api/v1/ingest/users` فرستاد (پاسخ ۲۰۰)
- [ ] در پنل → «سینک» رویداد سینک و سپس یک وب‌هوک موفق دیده شد
- [ ] پشتیبان‌گیری خودکار فایل `crm.db` تنظیم شد
