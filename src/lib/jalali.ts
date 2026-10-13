/**
 * تاریخ جلالی — بدون وابستگی بیرونی.
 * نمایش با Intl (تقویم persian) و تبدیل دوطرفه با الگوریتم استاندارد جلالی،
 * که در تست با خروجی Intl مقایسه می‌شود.
 */

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function enDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

/* ── الگوریتم تبدیل (jalaali) ─────────────────────────────────────── */

/**
 * تقسیم و باقی‌مانده با «کوتاه‌سازی به سمت صفر» — همان قرارداد الگوریتم استاندارد
 * جلالی (jalaali-js). استفاده از Math.floor اینجا اشتباه است: برای عملوند منفی
 * (مثلاً div(gm-8, 6) در فروردین) یک سال جابه‌جایی می‌سازد.
 */
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

function jalCal(jy: number) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error(`سال جلالی نامعتبر: ${jy}`);
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(jump % 33, 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div((n % 33) + 3, 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = (((n + 1) % 33) - 1) % 4;
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * ((gm + 9) % 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** JDN → میلادی (معکوس دقیق g2d) */
function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = (k % 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = (k % 30) + 1;
  return { jy, jm, jd };
}

/** میلادی → جلالی (با اعتبارسنجی) */
export function toJalaliParts(date: Date): { jy: number; jm: number; jd: number } {
  return d2j(g2d(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()));
}

/** جلالی → میلادی (به‌صورت Date در UTC) */
export function fromJalaliParts(jy: number, jm: number, jd: number): Date {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
}

/* ── نمایش ────────────────────────────────────────────────────────── */

const dateFmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC",
});

/** ISO → «۱۴۰۵/۰۷/۲۱» (اعداد فارسی) */
export function toJalali(iso: string | Date | null | undefined, opts: { fa?: boolean } = {}): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const p = dateFmt.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const text = `${p.year}/${p.month}/${p.day}`;
  return opts.fa === false ? text : faDigits(text);
}

/** ISO → «۲۱ مهر ۱۴۰۵» */
export function toJalaliLong(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const { jy, jm, jd } = toJalaliParts(date);
  return `${faDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${faDigits(jy)}`;
}

/** ISO → «۱۴۰۵/۰۷/۲۱ — ۱۴:۳۰» */
export function toJalaliDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran", hour12: false,
  }).format(date);
  return `${toJalali(date)} — ${faDigits(time)}`;
}

/** «۱۴۰۵/۰۷/۲۱» (ورودی کاربر) → ISO UTC؛ در صورت نامعتبر بودن null */
export function parseJalaliInput(value: string): string | null {
  const cleaned = enDigits(value.trim()).replace(/[-.]/g, "/");
  const m = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  try {
    const date = fromJalaliParts(jy, jm, jd);
    const roundTrip = toJalaliParts(date);
    if (roundTrip.jy !== jy || roundTrip.jm !== jm || roundTrip.jd !== jd) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

/** فاصله زمانی فارسی: «۳ روز پیش»، «۲ ساعت دیگر» */
export function relativeFa(iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let text: string;
  if (abs < minute) text = "همین حالا";
  else if (abs < hour) text = `${faDigits(Math.round(abs / minute))} دقیقه`;
  else if (abs < day) text = `${faDigits(Math.round(abs / hour))} ساعت`;
  else if (abs < 30 * day) text = `${faDigits(Math.round(abs / day))} روز`;
  else text = toJalali(date);
  if (text === "همین حالا") return text;
  return diffMs < 0 ? `${text} پیش` : `${text} دیگر`;
}

export function tehranNow(): Date {
  return new Date();
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function jalaliMonthName(jm: number): string {
  return JALALI_MONTHS[jm - 1] ?? "";
}

export { JALALI_MONTHS };
