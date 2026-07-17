#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { globSync } from "glob";

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    fix: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book-root") out.bookRoot = path.resolve(argv[++i] || "");
    else if (a === "--fix") out.fix = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

export function scanTargets(bookRoot) {
  const files = new Set();
  for (const pattern of ["chapters/**/*.md", "deliverables/**/*.md", "releases/**/*.md"]) {
    globSync(pattern, {
      cwd: bookRoot,
      absolute: true,
      nodir: true,
    })
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .forEach((f) => files.add(f));
  }
  return [...files];
}

function countMatches(text, regex) {
  const m = String(text).match(regex);
  return m ? m.length : 0;
}

function countStaleMatMentions(text) {
  const raw = String(text);
  const plain = (raw.match(/待核实-MAT-(?!XXX\b)[A-Za-z0-9-]+/gi) || []).length;
  const bracketed = (raw.match(/\[(?:待核实)-MAT-(?!XXX\b)[A-Za-z0-9-]+\]/gi) || []).length;
  return plain + bracketed;
}

function countPendingMatPlaceholder(text) {
  return (String(text).match(/\[待核实-MAT-XXX\]/gi) || []).length;
}

function countMatTodoSuffix(text) {
  return (String(text).match(/MAT-XXX（待补充）/gi) || []).length;
}

function countMalformedPendingLineMentions(text) {
  const raw = String(text);
  const p1 = (raw.match(/^\s*-\s*`{1,2}\s*`{0,1}\s*[：:]\s*待核实[^\r\n]*$/gim) || []).length;
  const p2 = (raw.match(/^\s*-\s*``\s*[：:]\s*待核实[^\r\n]*$/gim) || []).length;
  return Math.max(p1, p2);
}

function fixText(raw, { sanitizeFinal = false } = {}) {
  let text = String(raw);
  const malformedPendingLineRe = /^\s*-\s*`{1,2}\s*`{0,1}\s*[：:]\s*待核实[^\r\n]*$/gim;
  const before = {
    staleMat: countStaleMatMentions(text),
    discardedTag: countMatches(text, /\[DISCARDED-[^\]\n]{1,300}\]/gi),
    malformedPendingLine: countMalformedPendingLineMentions(text),
  };
  text = text.replaceAll("``：待核实，可能存在偏差", "`[待核实-MAT-XXX]`：待核实，可能存在偏差");
  text = text.replace(/^\s*-\s*.*待核实.*偏差.*$/gim, "- `[待核实-MAT-XXX]`：待核实，可能存在偏差");
  text = text.replace(/^\s*-\s*``[^\r\n]*待核实[^\r\n]*$/gim, "- `[待核实-MAT-XXX]`：待核实，可能存在偏差");
  text = text.replace(malformedPendingLineRe, "- `[待核实-MAT-XXX]`：待核实，可能存在偏差");
  text = text.replace(/\[(?:待核实)-MAT-[A-Za-z0-9-]+\]/gi, (m) => {
    if (sanitizeFinal) return "";
    return /\[待核实-MAT-XXX\]/i.test(m) ? m : "";
  });
  text = text.replace(/待核实-MAT-(?!XXX\b)[A-Za-z0-9-]+/gi, "");
  if (sanitizeFinal) {
    text = text.replace(/MAT-XXX（待补充）/gi, "");
    text = text.replace(/^\s*-\s*.*待核实.*偏差.*$/gim, "");
  }
  text = text.replace(/\[DISCARDED-[^\]\n]{1,300}\]/gi, "");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const after = {
    staleMat: countStaleMatMentions(text),
    discardedTag: countMatches(text, /\[DISCARDED-[^\]\n]{1,300}\]/gi),
    malformedPendingLine: countMalformedPendingLineMentions(text),
  };
  return { text, before, after };
}

/**
 * 全书 MAT/待核实/DISCARDED 逐文件统计（含 0 计数行），供 material-marker-scan 与复盘报告。
 */
export function runMaterialMarkerFullScan(bookRoot) {
  const root = path.resolve(bookRoot);
  const files = scanTargets(root);
  const rows = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const staleMat = countStaleMatMentions(raw);
    const pendingMatPlaceholder = countPendingMatPlaceholder(raw);
    const matTodoSuffix = countMatTodoSuffix(raw);
    const discardedTag = countMatches(raw, /\[DISCARDED-[^\]\n]{1,300}\]/gi);
    const malformedPendingLine = countMalformedPendingLineMentions(raw);
    rows.push({
      file: path.relative(root, file).replace(/\\/g, "/"),
      staleMat,
      pendingMatPlaceholder,
      matTodoSuffix,
      discardedTag,
      malformedPendingLine,
      totalMarkers: staleMat + pendingMatPlaceholder + matTodoSuffix + discardedTag + malformedPendingLine,
    });
  }
  const totals = rows.reduce(
    (acc, r) => {
      acc.files += 1;
      acc.staleMat += r.staleMat;
      acc.pendingMatPlaceholder += r.pendingMatPlaceholder;
      acc.matTodoSuffix += r.matTodoSuffix;
      acc.discardedTag += r.discardedTag;
      acc.malformedPendingLine += r.malformedPendingLine;
      acc.totalMarkers += r.totalMarkers;
      return acc;
    },
    {
      files: 0,
      staleMat: 0,
      pendingMatPlaceholder: 0,
      matTodoSuffix: 0,
      discardedTag: 0,
      malformedPendingLine: 0,
      totalMarkers: 0,
    },
  );
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    fileCount: rows.length,
    rows,
    totals,
  };
}

export function runMaterialMarkerGovernor({ bookRoot, fix = false } = {}) {
  if (!bookRoot) return { code: 2, message: "missing --book-root" };
  const files = scanTargets(bookRoot);
  const issues = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const staleMat = countStaleMatMentions(raw);
    const pendingMatPlaceholder = countPendingMatPlaceholder(raw);
    const matTodoSuffix = countMatTodoSuffix(raw);
    const discardedTag = countMatches(raw, /\[DISCARDED-[^\]\n]{1,300}\]/gi);
    const malformedPendingLine = countMalformedPendingLineMentions(raw);
    if (staleMat === 0 && pendingMatPlaceholder === 0 && matTodoSuffix === 0 && discardedTag === 0 && malformedPendingLine === 0) continue;
    const item = {
      file,
      staleMat,
      pendingMatPlaceholder,
      matTodoSuffix,
      discardedTag,
      malformedPendingLine,
      changed: false,
      removedStaleMat: 0,
      removedDiscardedTag: 0,
      fixedMalformedPendingLine: 0,
    };
    if (fix) {
      const norm = file.replace(/\\/g, "/").toLowerCase();
      const sanitizeFinal = norm.includes("/releases/") || norm.includes("/deliverables/") || /终稿|全稿|终审稿/.test(raw);
      const { text, before, after } = fixText(raw, { sanitizeFinal });
      if (text !== raw) {
        fs.writeFileSync(file, text, "utf8");
        item.changed = true;
        item.removedStaleMat = Math.max(0, before.staleMat - after.staleMat);
        item.removedDiscardedTag = Math.max(0, before.discardedTag - after.discardedTag);
        item.fixedMalformedPendingLine = Math.max(0, before.malformedPendingLine - after.malformedPendingLine);
        if (
          item.fixedMalformedPendingLine === 0 &&
          item.malformedPendingLine > 0 &&
          text.includes("[待核实-MAT-XXX]")
        ) {
          item.fixedMalformedPendingLine = item.malformedPendingLine;
        }
      }
    }
    issues.push(item);
  }

  const totals = issues.reduce(
    (acc, it) => {
      acc.files += 1;
      acc.staleMat += it.staleMat;
      acc.pendingMatPlaceholder += it.pendingMatPlaceholder;
      acc.matTodoSuffix += it.matTodoSuffix;
      acc.discardedTag += it.discardedTag;
      acc.malformedPendingLine += it.malformedPendingLine;
      if (it.changed) acc.filesChanged += 1;
      acc.removedStaleMat += it.removedStaleMat;
      acc.removedDiscardedTag += it.removedDiscardedTag;
      acc.fixedMalformedPendingLine += it.fixedMalformedPendingLine;
      return acc;
    },
    { files: 0, staleMat: 0, pendingMatPlaceholder: 0, matTodoSuffix: 0, discardedTag: 0, malformedPendingLine: 0, filesChanged: 0, removedStaleMat: 0, removedDiscardedTag: 0, fixedMalformedPendingLine: 0 },
  );

  const out = {
    code: 0,
    message: "material marker scan completed",
    mode: fix ? "fix" : "scan",
    totals,
    issues,
  };
  try {
    const fbs = path.join(bookRoot, ".fbs");
    fs.mkdirSync(fbs, { recursive: true });
    fs.writeFileSync(path.join(fbs, "material-marker-governor.json"), JSON.stringify({ generatedAt: new Date().toISOString(), ...out }, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const out = runMaterialMarkerGovernor(args);
  if (out.code !== 0) {
    console.error(`[material-marker-governor] ${out.message}`);
    process.exit(out.code);
  }
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[material-marker-governor] ${out.message}`);
    console.log(
      `[material-marker-governor] files=${out.totals.files} staleMat=${out.totals.staleMat} discarded=${out.totals.discardedTag} changed=${out.totals.filesChanged}`,
    );
  }
  process.exit(out.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("material-marker-governor.mjs")) {
  main();
}
