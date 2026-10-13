#!/usr/bin/env node
/**
 * مرورگر محلی دیاگرام‌های Mermaid — بدون هیچ وابستگی npm.
 *
 * چرا؟ رندر Mermaid در سمت سرور به Chromium نیاز دارد که در این محیط نصب نیست؛
 * بنابراین دیاگرام‌ها در همان مرورگر شما با کتابخانه Mermaid (از CDN) رندر می‌شوند.
 *
 * اجرا:  npm run diagrams:view   →  http://localhost:4321
 * متغیرها: PORT (پیش‌فرض 4321)، HOST (پیش‌فرض 0.0.0.0)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const diagramsDir = path.join(root, "docs", "diagrams");
const htmlPath = path.join(root, "scripts", "diagram-viewer.html");

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "0.0.0.0";
const SAFE_NAME = /^[A-Za-z0-9._-]+\.mmd$/;
/** نسخه محلی Mermaid (اختیاری) — با «npm run diagrams:vendor» ساخته می‌شود */
const vendorDir =
  process.env.MERMAID_VENDOR_DIR ?? path.join(root, "node_modules", ".cache", "diagram-viewer", "mermaid");

function diagramTitle(file) {
  const text = fs.readFileSync(path.join(diagramsDir, file), "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/);
  const fromFront = front?.[1].match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (fromFront) return fromFront;
  const firstLine = text.split("\n").find((l) => l.trim() && !l.startsWith("%%"));
  return firstLine?.trim() ?? file;
}

function listDiagrams() {
  if (!fs.existsSync(diagramsDir)) return [];
  return fs
    .readdirSync(diagramsDir)
    .filter((f) => SAFE_NAME.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((file) => {
      const text = fs.readFileSync(path.join(diagramsDir, file), "utf8");
      const type =
        text.includes("stateDiagram") ? "state"
        : text.includes("sequenceDiagram") ? "sequence"
        : text.includes("erDiagram") ? "er"
        : text.includes("mindmap") ? "mindmap"
        : text.includes("flowchart") ? "flowchart"
        : "diagram";
      return {
        file,
        title: diagramTitle(file),
        type,
        lines: text.split("\n").length,
        bytes: Buffer.byteLength(text, "utf8"),
      };
    });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (!fs.existsSync(htmlPath)) return send(res, 500, "scripts/diagram-viewer.html پیدا نشد", { "Content-Type": "text/plain; charset=utf-8" });
    return send(res, 200, fs.readFileSync(htmlPath, "utf8"), { "Content-Type": "text/html; charset=utf-8" });
  }

  if (url.pathname === "/api/diagrams") {
    return send(res, 200, JSON.stringify({ diagrams: listDiagrams() }), { "Content-Type": "application/json; charset=utf-8" });
  }

  if (url.pathname.startsWith("/raw/")) {
    const name = decodeURIComponent(url.pathname.slice("/raw/".length));
    if (!SAFE_NAME.test(name) || !fs.existsSync(path.join(diagramsDir, name))) {
      return send(res, 404, "یافت نشد", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return send(res, 200, fs.readFileSync(path.join(diagramsDir, name), "utf8"), {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${name}"`,
    });
  }

  if (url.pathname.startsWith("/vendor/")) {
    const relative = decodeURIComponent(url.pathname.slice("/vendor/".length));
    const full = path.resolve(vendorDir, relative);
    if (!full.startsWith(path.resolve(vendorDir) + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return send(res, 404, "یافت نشد", { "Content-Type": "text/plain; charset=utf-8" });
    }
    const type = full.endsWith(".mjs") || full.endsWith(".js") ? "text/javascript; charset=utf-8"
      : full.endsWith(".css") ? "text/css; charset=utf-8"
      : "application/octet-stream";
    return send(res, 200, fs.readFileSync(full), { "Content-Type": type, "Cache-Control": "no-store" });
  }

  return send(res, 404, "یافت نشد", { "Content-Type": "text/plain; charset=utf-8" });
});

server.listen(PORT, HOST, () => {
  console.log(`[diagram-viewer] ${listDiagrams().length} دیاگرام در docs/diagrams`);
  console.log(`[diagram-viewer] Mermaid محلی: ${fs.existsSync(path.join(vendorDir, "mermaid.esm.min.mjs")) ? "بله (/vendor)" : "خیر — از CDN بارگذاری می‌شود (npm run diagrams:vendor)"}`);
  console.log(`[diagram-viewer] در حال گوش‌دادن روی http://${HOST}:${PORT}`);
});
