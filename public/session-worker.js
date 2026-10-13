/**
 * سرویس‌ورکر نشست — توکن جلسه را روی همه درخواست‌های هم‌دامنه می‌گذارد.
 *
 * چرا لازم است؟ در برخی محیط‌ها (پنل داخل iframe، پروکسی‌هایی که کوکی را حفظ نمی‌کنند،
 * مرورگرهایی که کوکی شخص‌ثالث را مسدود می‌کنند) کوکی نشست ارسال نمی‌شود و کاربر مدام
 * به صفحه ورود پرت می‌شود. این ورکر توکن امضاشده را در IndexedDB نگه می‌دارد و آن را
 * به‌صورت هدر X-Session-Ticket روی درخواست‌ها می‌گذارد.
 *
 * اگر کوکی کار کند، هیچ تغییری در رفتار سامانه ایجاد نمی‌کند (هدر فقط پشتیبان است).
 */
const DB_NAME = "crm-session";
const STORE = "kv";
const KEY = "ticket";

let ticketCache = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readTicket() {
  if (ticketCache) return ticketCache;
  try {
    const db = await openDb();
    ticketCache = await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    ticketCache = null;
  }
  return ticketCache;
}

async function writeTicket(value) {
  ticketCache = value || null;
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      if (value) tx.objectStore(STORE).put(value, KEY);
      else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => resolve(null);
    });
  } catch {
    /* ذخیره‌سازی در دسترس نیست؛ فقط حافظه */
  }
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
  readTicket();
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "set-ticket") {
    event.waitUntil(writeTicket(String(data.ticket || "")));
    if (event.ports?.[0]) event.ports[0].postMessage({ ok: true });
  }
  if (data.type === "clear-ticket") {
    event.waitUntil(writeTicket(""));
    if (event.ports?.[0]) event.ports[0].postMessage({ ok: true });
  }
});

function shouldSkip(url) {
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/_next/image")) return true;
  if (url.pathname === "/session-worker.js") return true;
  if (/\.(png|jpg|jpeg|svg|ico|webp|woff2?|css|map)$/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" && request.method !== "POST") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || shouldSkip(url)) return;

  event.respondWith(
    (async () => {
      const ticket = await readTicket();
      if (!ticket) return fetch(request);
      const headers = new Headers(request.headers);
      if (!headers.has("x-session-ticket")) headers.set("x-session-ticket", ticket);
      if (!headers.has("authorization")) headers.set("authorization", `Bearer ${ticket}`);
      try {
        return await fetch(new Request(request, { headers }));
      } catch {
        // ناوبری‌ها گاهی قابل بازسازی نیستند؛ همان درخواست با هدرهای اضافه دوباره ساخته می‌شود
        return fetch(request.url, {
          method: request.method,
          headers,
          credentials: "same-origin",
          redirect: "follow",
          cache: request.cache,
        });
      }
    })(),
  );
});
