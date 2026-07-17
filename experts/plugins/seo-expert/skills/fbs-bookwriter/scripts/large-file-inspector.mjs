#!/usr/bin/env node
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const o = {
    root: process.cwd(),
    top: 30,
    minKb: 20,
    exts: [".md", ".mjs", ".js", ".json"],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") o.root = argv[++i];
    else if (a === "--top") o.top = Number(argv[++i] || 30);
    else if (a === "--min-kb") o.minKb = Number(argv[++i] || 20);
    else if (a === "--exts") o.exts = String(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean);
  }
  return o;
}

function shouldSkipDir(name) {
  return ["node_modules", ".git", "dist", "test-unzip", "final-test"].includes(name);
}

/**
 * 近似行数统计：分块读取，避免 readFileSync 整文件入内存。
 * 对超大文件只统计前 maxBytes，给出 lower-bound，优先保障扫描速度和稳定性。
 */
function countLinesFast(filePath, maxBytes = 2 * 1024 * 1024) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    const bufSize = 64 * 1024;
    const buffer = Buffer.allocUnsafe(bufSize);
    let offset = 0;
    let lines = 0;
    let bytesRead = 0;
    while (bytesRead < maxBytes) {
      const toRead = Math.min(bufSize, maxBytes - bytesRead);
      const read = fs.readSync(fd, buffer, 0, toRead, offset);
      if (!read) break;
      offset += read;
      bytesRead += read;
      for (let i = 0; i < read; i++) {
        if (buffer[i] === 10) lines += 1; // \n
      }
    }
    return { lines: lines + 1, truncated: bytesRead >= maxBytes };
  } catch {
    return { lines: -1, truncated: false };
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  const rows = [];

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name)) continue;
        walk(path.join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      const full = path.join(dir, e.name);
      const ext = path.extname(e.name).toLowerCase();
      if (!args.exts.includes(ext)) continue;

      const size = fs.statSync(full).size;
      const kb = size / 1024;
      if (kb < args.minKb) continue;

      const lineStat = countLinesFast(full);

      rows.push({
        file: path.relative(root, full).replace(/\\/g, "/"),
        kb: Number(kb.toFixed(1)),
        lines: lineStat.lines,
        lineCountTruncated: lineStat.truncated,
      });
    }
  };

  walk(root);
  rows.sort((a, b) => b.kb - a.kb);
  const topRows = rows.slice(0, args.top);

  console.log(JSON.stringify({ root, total: rows.length, top: topRows }, null, 2));
}

main();
