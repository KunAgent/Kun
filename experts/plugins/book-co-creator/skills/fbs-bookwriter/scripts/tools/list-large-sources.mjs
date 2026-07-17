#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, "../..");
/** qc-output 为机读产物，结构守卫已跳过；此处聚焦可维护源码与权威配置 */
const roots = ["scripts", "references", "scene-packs"];
const exts = new Set([".mjs", ".js", ".md", ".json"]);
const skip = new Set(["node_modules", ".git", "dist", "test-unzip"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skip.has(e.name)) continue;
      walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!exts.has(ext)) continue;
    const rel = path.relative(base, full).replace(/\\/g, "/");
    if (rel === "package-lock.json") continue;
    let raw;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split(/\r?\n/).length;
    const kb = Buffer.byteLength(raw, "utf8") / 1024;
    out.push({ rel, lines, kb: Number(kb.toFixed(1)) });
  }
}

const out = [];
for (const r of roots) {
  const d = path.join(base, r);
  if (fs.existsSync(d)) walk(d, out);
}
out.sort((a, b) => b.lines - a.lines);
const warn = 1200;
const fail = 3200;
for (const x of out) {
  const lv = x.lines >= fail ? "FAIL" : x.lines >= warn ? "warn" : "ok";
  if (x.lines < warn) break;
  console.log(`${String(x.lines).padStart(5)} ${lv.padEnd(4)} ${String(x.kb).padStart(7)}kb  ${x.rel}`);
}
