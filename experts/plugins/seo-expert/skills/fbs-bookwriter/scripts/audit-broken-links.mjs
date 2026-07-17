#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const o = { root: process.cwd(), channel: 'all', enforce: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = argv[++i];
    else if (a === '--channel') o.channel = argv[++i];
    else if (a === '--enforce') o.enforce = true;
  }
  return o;
}

function listMd(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
    }
  }
  return out;
}

function collectSkillScanRoots(root, channel) {
  const scanRoots = [];
  const refNested = path.join(root, 'FBS-BookWriter', 'references');
  const refFlat = path.join(root, 'references');
  const skillNested = path.join(root, 'FBS-BookWriter', 'SKILL.md');
  const skillFlat = path.join(root, 'SKILL.md');

  if (channel === 'user') {
    if (fs.existsSync(refNested)) scanRoots.push(refNested);
    else if (fs.existsSync(refFlat)) scanRoots.push(refFlat);
    if (fs.existsSync(skillNested)) scanRoots.push(skillNested);
    else if (fs.existsSync(skillFlat)) scanRoots.push(skillFlat);
  } else {
    if (fs.existsSync(refNested)) scanRoots.push(refNested);
    else if (fs.existsSync(refFlat)) scanRoots.push(refFlat);
    if (fs.existsSync(skillNested)) scanRoots.push(skillNested);
    else if (fs.existsSync(skillFlat)) scanRoots.push(skillFlat);
  }
  return scanRoots;
}

/** 书稿根下无技能包目录时，扫描章节/交付物等 Markdown（Windows 书稿根实测：原逻辑 files=0） */
function collectBookProjectScanRoots(root) {
  const out = [];
  const candidates = ['chapters', 'deliverables', '全稿', 'releases', '.fbs'];
  for (const name of candidates) {
    const p = path.join(root, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) out.push(p);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  let scanRoots = collectSkillScanRoots(root, args.channel);

  const files = [];
  for (const r of scanRoots) {
    if (r.endsWith('.md')) {
      if (fs.existsSync(r)) files.push(r);
    } else {
      files.push(...listMd(r));
    }
  }

  if (files.length === 0) {
    scanRoots = collectBookProjectScanRoots(root);
    for (const r of scanRoots) {
      files.push(...listMd(r));
    }
  }

  const broken = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1].trim();
      if (!raw || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('#')) continue;
      const filePart = raw.split('#')[0];
      if (!filePart) continue;
      const target = path.resolve(path.dirname(f), filePart);
      if (!fs.existsSync(target)) broken.push({ file: f, link: raw, resolved: target });
    }
  }

  console.log(`audit-broken-links: 扫描文件=${files.length}, 断链=${broken.length}`);
  broken.slice(0, 40).forEach((x) => console.log(`  - ${x.file} -> ${x.link}`));

  if (args.enforce && broken.length > 0) process.exit(1);
  process.exit(0);
}

main();
