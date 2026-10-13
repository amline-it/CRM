#!/usr/bin/env node
/**
 * فراهم‌کردن نسخه محلی Mermaid برای مرورگر دیاگرام‌ها (اختیاری).
 *
 * مرورگر دیاگرام‌ها به‌صورت پیش‌فرض Mermaid را از CDN بارگذاری می‌کند. اگر محیط شما
 * دسترسی به CDN ندارد (شبکه بسته یا iframe با سیاست سخت‌گیرانه)، این اسکریپت بسته
 * `mermaid` را در مسیر cache محلی (خارج از Git) قرار می‌دهد تا مرورگر همان را بردارد.
 *
 *   npm run diagrams:vendor
 *
 * مسیر مقصد: node_modules/.cache/diagram-viewer/mermaid  (با MERMAID_VENDOR_DIR قابل تغییر)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = process.env.MERMAID_VENDOR_DIR ?? path.join(root, "node_modules", ".cache", "diagram-viewer", "mermaid");
const localDist = path.join(root, "node_modules", "mermaid", "dist");

const NEEDED = ["mermaid.esm.min.mjs", path.join("chunks", "mermaid.esm.min")];

function copyTree(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copyTree(path.join(from, entry), path.join(to, entry));
  } else {
    fs.copyFileSync(from, to);
  }
}

function copyFrom(distDir) {
  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  for (const item of NEEDED) {
    const source = path.join(distDir, item);
    if (!fs.existsSync(source)) throw new Error(`فایل لازم پیدا نشد: ${source}`);
    copyTree(source, path.join(vendorDir, item));
  }
}

if (fs.existsSync(localDist)) {
  copyFrom(localDist);
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mermaid-pack-"));
  try {
    console.log("[vendor] بسته mermaid از npm دریافت می‌شود…");
    execFileSync("npm", ["pack", "mermaid@11", "--pack-destination", tmp], { cwd: tmp, stdio: "pipe" });
    const tarball = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error("بسته mermaid دریافت نشد");
    execFileSync("tar", ["-xzf", path.join(tmp, tarball), "-C", tmp], { stdio: "pipe" });
    copyFrom(path.join(tmp, "package", "dist"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const size = fs
  .readdirSync(vendorDir, { recursive: true })
  .reduce((sum, entry) => {
    const full = path.join(vendorDir, entry);
    return fs.statSync(full).isFile() ? sum + fs.statSync(full).size : sum;
  }, 0);

console.log(`[vendor] Mermaid در ${path.relative(root, vendorDir)} آماده شد (${(size / 1024 / 1024).toFixed(1)} مگابایت)`);
console.log("[vendor] این مسیر در node_modules/.cache است و در Git ثبت نمی‌شود.");
console.log("[vendor] حالا «npm run diagrams:view» بدون نیاز به CDN کار می‌کند.");
