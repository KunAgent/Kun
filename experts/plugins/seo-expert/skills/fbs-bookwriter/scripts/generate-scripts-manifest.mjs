#!/usr/bin/env node
/**
 * 生成 scripts 清单（P1 B2）：供进化门控与 Agent 发现入口
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'generated');
const OUT_FILE = path.join(OUT_DIR, 'scripts-manifest.json');

function walk(dir, acc, rel = '') {
  let list;
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of list) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'test' || ent.name === '__tests__' || ent.name === '_deprecated') continue;
      if (ent.name === 'generated') continue;
      walk(full, acc, r);
    } else if (ent.name.endsWith('.mjs') || ent.name.endsWith('.ps1')) {
      acc.push(r.replace(/\\/g, '/'));
    }
  }
}

function main() {
  const acc = [];
  walk(path.join(ROOT, 'scripts'), acc, '');
  acc.sort();
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    skillRoot: 'FBS-BookWriter',
    scripts: acc,
    count: acc.length,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`已写出 ${OUT_FILE}（${acc.length} 项）`);
}

main();
