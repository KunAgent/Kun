/**
 * D 询价前导门控（机器化 · 替代旧 D040 / 旧「Phase 1-4 完整」硬门控）
 *
 * 解耦后的语义：D（询价）与 C（选品）互不依赖。进入询价前**只**校验：
 *   - 段 A 已完成：context.md 含 `context-done`；phase1.md 含 `phase1-done` 且带 `competitor` 字段
 *   - 段 B 已完成或明确跳过：
 *       competitor>0  → phase2.md 含 `phase2-done`（B 真的跑过）
 *       competitor==0 → context-done 须含 `b_status=skipped(no_competitor)`（B 明确跳过的结论标注）
 *   - 数据格式合规（done 标记齐全）
 *
 * **不再**要求"询价前必走完选品 Phase 2.5/2.6/3/4"。
 *
 * 纯脚本判定，无 AI 自检。契约见：
 *   - references/how-to-query-pricing.md §前导 gate
 *   - docs/cpq/abc-refactor/{subagent-d,intermediate-files}.md
 *
 * 用法：
 *   node scripts/check-phase4-1-gate.mjs --session-dir <CPQ_SESSION_DIR>
 *   node scripts/check-phase4-1-gate.mjs --session-dir <CPQ_SESSION_DIR> --report   # dry-run，exit 0
 *
 * 退出码：0 通过；1 用法/路径错误；2 门控未通过。
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDoneMarker } from './lib/md-contract.mjs';

/**
 * 解耦前导门控核心判定（纯函数 · 可单测）。
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDPregate({ contextText, phase1Text, phase2Text }) {
  const errors = [];
  const ctx = parseDoneMarker(contextText || '', 'context');
  if (!ctx.found) errors.push('A 未完成：缺 context-done');

  const p1 = parseDoneMarker(phase1Text || '', 'phase1');
  if (!p1.found || !('competitor' in p1.fields)) {
    errors.push('A 未完成：缺 phase1-done 或其 competitor 字段');
    return { ok: false, errors };
  }

  const competitor = Number(p1.fields.competitor);
  if (competitor > 0) {
    const p2 = parseDoneMarker(phase2Text || '', 'phase2');
    if (!p2.found) errors.push(`有友商行(competitor=${competitor})但 B 未完成：缺 phase2-done`);
  } else if (ctx.fields.b_status !== 'skipped(no_competitor)') {
    errors.push('无友商行但 context-done 未标 b_status=skipped(no_competitor)');
  }
  return { ok: errors.length === 0, errors };
}

// ---------- CLI ----------

function err(msg) {
  process.stderr.write(msg + '\n');
}

function printUsage() {
  err('用法：');
  err('  node scripts/check-phase4-1-gate.mjs --session-dir <CPQ_SESSION_DIR>');
  err('  node scripts/check-phase4-1-gate.mjs --session-dir <CPQ_SESSION_DIR> --report');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session-dir') {
      out.sessionDir = argv[++i];
    } else if (a === '--report') {
      out.report = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      err(`未知参数：${a}`);
    }
  }
  return out;
}

function read(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

function main() {
  const ARGS = parseArgs(process.argv.slice(2));
  if (ARGS.help || !ARGS.sessionDir) {
    printUsage();
    process.exit(ARGS.help ? 0 : 1);
  }

  const sessionDir = ARGS.sessionDir;
  if (!isAbsolute(sessionDir)) {
    err(`--session-dir 必须是绝对路径，收到：${sessionDir}`);
    process.exit(1);
  }
  if (!existsSync(sessionDir)) {
    err(`CPQ_SESSION_DIR 不存在：${sessionDir}`);
    err('  → 先跑：node scripts/resolve-session-dir.mjs');
    process.exit(1);
  }

  const { ok, errors } = validateDPregate({
    contextText: read(sessionDir, 'context.md'),
    phase1Text: read(sessionDir, 'phase1.md'),
    phase2Text: read(sessionDir, 'phase2.md'),
  });

  const findings = errors.map((message) => ({ code: 'D_PREGATE', level: 'fail', message }));

  if (ARGS.report) {
    // dry-run：打印所有 findings，但 exit 0
    console.log(JSON.stringify({ ok, findings }, null, 2));
    process.exit(0);
  }

  if (!ok) {
    err('❌ D 询价前导门控未通过。请回退补齐段 A / 段 B 后再询价：\n');
    for (const f of findings) err(`  · [${f.code}] ${f.message}`);
    err('');
    err('完整契约见：plugins/cpq/skills/cpq/references/how-to-query-pricing.md §前导 gate');
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        session_dir: sessionDir,
        checks: findings.map((f) => ({ code: f.code, level: f.level, message: f.message })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
