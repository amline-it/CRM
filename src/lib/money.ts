/**
 * پول و عدد فارسی — نمایش با جداکننده هزارگان و رقم فارسی، تجزیه ورودی کاربر.
 */
import { enDigits, faDigits } from "@/lib/jalali";

/** جداکننده هزارگان با ارقام لاتین */
export function groupDigits(value: number | string): string {
  const n = typeof value === "number" ? value : Number(enDigits(String(value)).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** نمایش عدد با رقم فارسی و جداکننده */
export function faNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return faDigits(groupDigits(value));
}

/** مبلغ تومان: «۱۵٬۰۰۰٬۰۰۰ تومان» */
export function faMoney(value: number | null | undefined, unit = "تومان"): string {
  if (value === null || value === undefined) return "—";
  return `${faNumber(value)} ${unit}`;
}

/** خلاصه خوانا برای مبالغ بزرگ: «۲۵۰ میلیون تومان» */
export function faMoneyShort(value: number | null | undefined, unit = "تومان"): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${faDigits(trimZero(value / 1_000_000_000_000))} همت ${unit}`;
  if (abs >= 1_000_000_000) return `${faDigits(trimZero(value / 1_000_000_000))} میلیارد ${unit}`;
  if (abs >= 1_000_000) return `${faDigits(trimZero(value / 1_000_000))} میلیون ${unit}`;
  if (abs >= 1_000) return `${faDigits(trimZero(value / 1_000))} هزار ${unit}`;
  return faMoney(value, unit);
}

function trimZero(value: number): string {
  return String(Number(value.toFixed(2)));
}

const MULTIPLIERS: Array<{ words: string[]; factor: number }> = [
  { words: ["هزار"], factor: 1_000 },
  { words: ["میلیون", "ملیون"], factor: 1_000_000 },
  { words: ["میلیارد", "میلیارد", "ملیارد"], factor: 1_000_000_000 },
  { words: ["همت"], factor: 1_000_000_000_000 },
];

/**
 * تجزیه مبلغ ورودی: «۱۵٬۰۰۰٬۰۰۰»، «۱۵ میلیون»، «۱٫۵ میلیارد»، «۱۲۰۰۰۰۰۰ تومان»
 * در صورت نامعتبر بودن null برمی‌گرداند.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : null;
  let text = enDigits(String(input)).trim();
  if (!text) return null;
  text = text.replace(/تومان|ریال|میلیارد|ملیارد|میلیون|ملیون|هزار|همت/g, (m) => ` ${m} `);
  text = text.replace(/[,٬٬\s]+/g, " ").replace(/٫|،/g, ".").trim();
  let factor = 1;
  for (const { words, factor: f } of MULTIPLIERS) {
    const found = words.find((w) => text.includes(w));
    if (found) {
      factor = f;
      text = text.replace(found, " ").trim();
      break;
    }
  }
  const parts = text.split(" ").filter(Boolean);
  if (!parts.length) return null;
  const numberPart = Number(parts[0].replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numberPart)) return null;
  return Math.round(numberPart * factor);
}

/** درصد تخفیف/کارمزد */
export function faPercent(value: number): string {
  return `${faDigits(String(Number(value.toFixed(1))))}٪`;
}
