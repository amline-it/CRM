# CRM املاک — سامانه مدیریت قرارداد، آگهی و نیازمندی

سامانه CRM خودمیزبان (self-hosted) برای کارشناسان و مدیران یک دفتر/آژانس املاک؛ برگرفته از نمودار گردش‌کار کامل:
**انتخاب خدمت → اطلاعات قرارداد → بررسی مالی → مدارک → بررسی حقوقی → امضا → کد رهگیری → بستن پرونده**،
به‌همراه گردش‌کارهای **آگهی**، **نیازمندی** و **خدمت سفارشی**.

* رابط کاربری کاملاً **فارسی و RTL** با تقویم **جلالی** و فونت وزیرمتن
* پنل **فقط برای کارکنان** (کارشناس/مدیر) — داده کاربران نهایی از سرور اصلی شما **سینک** می‌شود
* موتور گردش‌کار **داده‌محور**: تعریف‌ها در `workflow-definitions/*.json` هستند، نه در کد
* سینک دوطرفه با سرور شما: **Push** (اینگست امضاشده) + **Pull** (واکشی زمان‌بندی‌شده) + **وب‌هوک خروجی** با HMAC
* آداپتورهای جایگزین‌پذیر برای پرداخت، کد رهگیری و پیامک (سندباکس داخلی برای توسعه)

---

## راه‌اندازی سریع (توسعه)

```bash
cp .env.example .env.local     # کلیدها را پر کنید (حداقل SESSION_SECRET)
npm install
npm run setup                  # مهاجرت دیتابیس + تعریف گردش‌کارها + خدمات
npm run seed -- --staff admin:Admin@1234:مدیر  # حساب مدیر اولیه (یک‌بار)
npm run dev                    # http://localhost:3000
```

برای داده نمونه (کاربر، قرارداد، آگهی، نیازمندی، وظیفه):

```bash
npm run seed -- --demo --staff admin:Admin@1234:مدیر
```

## اجرا روی سرور با داکر

```bash
cp .env.example .env           # مقادیر واقعی: SESSION_SECRET، SYNC_API_KEY، SYNC_SECRET، …
docker compose up -d --build
# لاگ‌ها:  docker compose logs -f crm
# آدرس:    http://SERVER-IP:3000   (قرار دادن پشت Nginx/HTTPS توصیه می‌شود)
```

در اولین اجرا، مهاجرت‌ها و تعریف‌های گردش‌کار خودکار اعمال می‌شوند. دیتابیس SQLite در والیوم `crm-data`
(`/data/crm.db`) نگه‌داری می‌شود — پشتیبان‌گیری = کپی همین فایل.

## دستورها

| دستور | کار |
| --- | --- |
| `npm run dev` | اجرای محیط توسعه |
| `npm run build` / `npm start` | ساخت و اجرای نسخه تولیدی |
| `npm test` | آزمون‌های واحد و سناریو (Vitest) |
| `npm run e2e` | آزمون سرتاسری روی سرور در حال اجرا (سینک + وب‌هوک) |
| `npm run migrate` | اعمال مهاجرت‌های SQL (`-- --status` برای مشاهده وضعیت) |
| `npm run seed` | ثبت تعریف‌های گردش‌کار، خدمات و (با `--demo`) داده نمونه |
| `npm run lint` | بررسی نوع‌ها با TypeScript |

## معماری (خلاصه)

```
src/domain/engine/     موتور گردش‌کار داده‌محور (plan/available/validate) — بدون وابستگی به وب
src/domain/guards/     گاردها (شرط‌های گذار): مدارک، مالی، حقوقی، امضا، رهگیری، …
src/domain/effects/    افکت‌ها: رویداد تایم‌لاین، وظیفه، اعلان، فاکتور، وب‌هوک، بستن پرونده
src/domain/service/    لایه سرویس: اجرای گذار با تراکنش + idempotency + Audit
src/db/                دسترسی داده روی SQLite داخلی Node (بدون وابستگی باینری) + مهاجرت‌ها
src/auth/              نشست JWT، scrypt، RBAC (کارشناس/مدیر)، CSRF، SSO اختیاری
src/services/sync.ts   اینگست Push، واکشی Pull، وب‌هوک خروجی، گزارش سینک
src/app/panel/         پنل کارکنان (داشبورد، پرونده‌ها، آگهی‌ها، نیازمندی‌ها، وظایف، مدیریت)
src/app/api/v1/        API سینک با سرور اصلی + cron وب‌هوک + سلامت
workflow-definitions/  منبع حقیقت گردش‌کارها (قرارداد، آگهی، نیازمندی، خدمت سفارشی)
```

مستندات بیشتر: `docs/architecture.md` · `docs/sync-api.md` (قرارداد API برای سرور شما) · `docs/deployment.md` ·
`docs/fa/راهنمای-کاربری.md` · طراحی کامل: `docs/superpowers/specs/2026-10-13-crm-design.md`.

## امنیت

* پنل فقط با حساب کارکنان قابل ورود است؛ داده کاربران نهایی هرگز توسط آن‌ها دیده نمی‌شود.
* کوکی نشست HttpOnly + SameSite=Lax، توکن CSRF روی همه فرم‌ها، هش رمز با scrypt.
* API سینک با کلید (`X-Sync-Key`) **و** امضای HMAC-SHA256 بدنه (`X-Signature`) محافظت می‌شود؛ درخواست‌های تکراری با
  `X-Idempotency-Key` بازپخش می‌شوند (بدون اثر دوباره).
* همه اقدام‌های کارکنان در `audit_log` ثبت می‌شود (قابل مشاهده در «گزارش رویدادها»).

---

## Agent setup

This repository has the official [Superpowers](https://github.com/obra/superpowers)
skills by obra installed for Arena Agent Mode (pinned `v7.0.0`): the skills live
in `skills/`, the session bootstrap and skill index in `AGENTS.md`.

- Install/update/verify: `bash scripts/superpowers-install.sh [--check] [--ref <tag>]`
- Details, troubleshooting, acceptance test: [`docs/superpowers-install.md`](docs/superpowers-install.md)
