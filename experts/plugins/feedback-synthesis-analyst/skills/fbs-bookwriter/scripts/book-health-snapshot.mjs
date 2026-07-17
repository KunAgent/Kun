#!/usr/bin/env node
/**
 * 一书稿健康快照（BookHealthSnapshot）— 规格见 references/05-ops/fbs-optimization-roadmap-spec.md §P0-1
 *
 * 用法：
 *   node scripts/book-health-snapshot.mjs --book-root <本书根> [--skill-root <技能根>] [--json-out <路径>] [--with-p0-audit] [--skip-expansion-gate]
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';
import {
  QUALITY_SCAN_IGNORE_GLOBS,
} from './lib/quality-runtime.mjs';
import { imperativeHitsForText, loadS2QualityMachineLexicon } from './lib/s2-quality-lexicon.mjs';
import { runMaterialMarkerGovernor } from './material-marker-governor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = {
    bookRoot: null,
    skillRoot: DEFAULT_SKILL,
    jsonOut: null,
    withP0Audit: false,
    skipExpansionGate: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') o.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--skill-root') o.skillRoot = path.resolve(argv[++i] || '');
    else if (a === '--json-out') o.jsonOut = argv[++i];
    else if (a === '--with-p0-audit') o.withP0Audit = true;
    else if (a === '--skip-expansion-gate') o.skipExpansionGate = true;
  }
  return o;
}

function readSkillVersion(skillRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function runEnvPreflight(skillRoot) {
  const script = path.join(skillRoot, 'scripts', 'env-preflight.mjs');
  const r = spawnSync(process.execPath, [script, '--json'], {
    encoding: 'utf8',
    cwd: skillRoot,
    windowsHide: true,
  });
  try {
    const line = String(r.stdout || '').trim();
    const json = JSON.parse(line);
    return { env: { allOk: !!json.allOk, checks: json.checks || [] }, exitCode: r.status };
  } catch {
    return {
      env: { allOk: false, checks: [{ id: 'env-preflight', ok: false, detail: '无法解析 env-preflight 输出' }] },
      exitCode: r.status ?? 1,
    };
  }
}

function countPendingVerification(bookRoot) {
  const candidates = [
    path.join(bookRoot, '.fbs', 'writing-notes', 'pending-verification.md'),
    path.join(bookRoot, '.fbs', 'writing-notes', '.pending-verification.md'),
  ];
  const target = candidates.find(fs.existsSync);
  if (!target) return null;
  const text = fs.readFileSync(target, 'utf8');
  return text.split(/\r?\n/).filter((l) => /^\s*[-*]\s*\[\s\]/.test(l)).length;
}

function stripNoiseForMatScan(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function detectLastIntakeAt(bookRoot) {
  const fbs = path.join(bookRoot, '.fbs');
  const candidates = [
    path.join(fbs, 'workbuddy-resume.json'),
    path.join(fbs, 'session-exit.json'),
    path.join(fbs, 'intake-router.json'),
  ];
  let latestTs = null;
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const stat = fs.statSync(file);
      if (!latestTs || stat.mtimeMs > latestTs.mtimeMs) {
        latestTs = { iso: new Date(stat.mtimeMs).toISOString(), mtimeMs: stat.mtimeMs, source: file };
      }
    } catch {
      // ignore
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const maybeTs = parsed?.intakeRouterRunAt || parsed?.generatedAt || parsed?.updatedAt || parsed?.timestamp;
      if (!maybeTs) continue;
      const t = new Date(maybeTs).getTime();
      if (Number.isNaN(t)) continue;
      if (!latestTs || t > latestTs.mtimeMs) {
        latestTs = { iso: new Date(t).toISOString(), mtimeMs: t, source: file };
      }
    } catch {
      // non-json file or no timestamp
    }
  }
  return latestTs ? { value: latestTs.iso, source: latestTs.source } : { value: null, source: null };
}

function sumImperativeManuscript(bookRoot, skillRoot) {
  const lex = loadS2QualityMachineLexicon(skillRoot);
  const fileSet = new Set();
  for (const pattern of ['chapters/**/*.md', 'deliverables/**/*.md']) {
    globSync(pattern, {
      cwd: bookRoot,
      absolute: true,
      nodir: true,
      ignore: QUALITY_SCAN_IGNORE_GLOBS,
    })
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .forEach((f) => fileSet.add(f));
  }
  const files = [...fileSet];

  let total = 0;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = imperativeHitsForText(text, lex);
    total += Object.values(hits).reduce((a, b) => a + b, 0);
  }
  return { bookTotal: total, threshold: 3, exceedsThreshold: total > 3, filesScanned: files.length };
}

function runExpansionGate(bookRoot, skillRoot) {
  const script = path.join(skillRoot, 'scripts', 'expansion-gate.mjs');
  const r = spawnSync(process.execPath, [script, '--book-root', bookRoot, '--skill-root', skillRoot], {
    encoding: 'utf8',
    cwd: skillRoot,
    windowsHide: true,
  });
  return typeof r.status === 'number' ? r.status : 1;
}

function runP0Audits(skillRoot, bookRoot) {
  const script = path.join(skillRoot, 'scripts', 'run-p0-audits.mjs');
  const r = spawnSync(process.execPath, [script, '--skill-root', skillRoot, '--book-root', bookRoot], {
    encoding: 'utf8',
    cwd: skillRoot,
    windowsHide: true,
  });
  return { exitCode: typeof r.status === 'number' ? r.status : 1 };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.bookRoot) {
    console.error('book-health-snapshot: 请指定 --book-root');
    process.exit(2);
  }
  const bookRoot = args.bookRoot;
  const skillRoot = args.skillRoot;
  const fbs = path.join(bookRoot, '.fbs');
  fs.mkdirSync(fbs, { recursive: true });

  const outPath = args.jsonOut
    ? path.resolve(args.jsonOut)
    : path.join(fbs, 'book-health-snapshot.json');

  const { env } = runEnvPreflight(skillRoot);

  const planPath = path.join(fbs, 'expansion-plan.md');
  const planPresent = fs.existsSync(planPath);
  let gateLastExitCode = null;
  if (planPresent && !args.skipExpansionGate) {
    gateLastExitCode = runExpansionGate(bookRoot, skillRoot);
  }

  const imperativeClassA = sumImperativeManuscript(bookRoot, skillRoot);
  const pendingCount = countPendingVerification(bookRoot);
  const markerScan = runMaterialMarkerGovernor({ bookRoot, fix: false });
  const staleMatMarkers = Number(markerScan?.totals?.staleMat) || 0;
  const staleDiscardedTags = Number(markerScan?.totals?.discardedTag) || 0;

  let p0AuditSummary = null;
  if (args.withP0Audit) {
    p0AuditSummary = runP0Audits(skillRoot, bookRoot);
  }

  const lastIntake = detectLastIntakeAt(bookRoot);
  const intake = {
    lastIntakeAt: lastIntake.value,
    intakeSource: lastIntake.source,
    resumePresent: fs.existsSync(path.join(fbs, 'workbuddy-resume.json')),
    chapterStatusPresent: fs.existsSync(path.join(fbs, 'chapter-status.md')),
  };

  const blockers = [];
  if (imperativeClassA.exceedsThreshold) {
    blockers.push(`A 类命令词全书合计 ${imperativeClassA.bookTotal} 次，超过阈值 ${imperativeClassA.threshold}`);
  }
  if (planPresent && gateLastExitCode !== null && gateLastExitCode !== 0) {
    blockers.push(`expansion-gate 退出码 ${gateLastExitCode}`);
  }
  const warns = [];
  if (env && env.allOk === false) {
    warns.push('环境预检未全部通过（见 env.checks）');
  }
  if (pendingCount !== null && pendingCount > 0) {
    warns.push(`待核实台账未勾选条目 ${pendingCount} 条`);
  }
  if (staleMatMarkers > 0) {
    warns.push(`正文残留「待核实-MAT」类标注约 ${staleMatMarkers} 处（复盘 P1：素材溯源）`);
  }
  if (staleDiscardedTags > 0) {
    warns.push(`检测到废弃标注 [DISCARDED-*] 约 ${staleDiscardedTags} 处，建议清理发布可见文本`);
  }

  let status = 'ok';
  if (blockers.length) status = 'block';
  else if (warns.length) status = 'warn';

  const snapshot = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    bookRoot,
    skillVersion: readSkillVersion(skillRoot),
    intake,
    env,
    expansion: {
      planPresent,
      gateLastExitCode,
    },
    imperativeClassA: {
      bookTotal: imperativeClassA.bookTotal,
      threshold: imperativeClassA.threshold,
      exceedsThreshold: imperativeClassA.exceedsThreshold,
      manuscriptFilesScanned: imperativeClassA.filesScanned,
    },
    pendingVerification: pendingCount === null ? null : { count: pendingCount },
    materialTags: {
      staleMatMarkers,
      discardedTagMarkers: staleDiscardedTags,
      governorReport: path.join(fbs, 'material-marker-governor.json'),
    },
    p0AuditSummary,
    status,
    blockers,
    warnings: warns.length ? warns : undefined,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`book-health-snapshot: 已写入 ${outPath}（status=${status}）`);
  process.exit(0);
}

main();
