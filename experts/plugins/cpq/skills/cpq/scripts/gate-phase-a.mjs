#!/usr/bin/env node

/**
 * 段 A 综合硬 gate：在所有下游脚本执行前调用，确保 A 阶段最小集 + 友商扩展集已就位。
 *
 * 设计依据：
 *   - 2026-06-22 三问题修复方案 P3
 *   - SKILL.md「Phase 1 → Phase 2 → ... 流程」契约
 *
 * 检查项（按友商行存在与否分两档）：
 *   ===== 最小集（腾讯商品 + 询价 / 选品场景）=====
 *   1. context.md 存在 + 含 site marker + context-done marker（委托 check-context.mjs）
 *   2. phase1.md  存在 + 通过 phase1 内容契约（委托 check-phase1.mjs）
 *
 *   ===== 友商扩展集（含 competitor 行时强制） =====
 *   3. phase2.md  存在 + 通过 phase2 契约（委托 check-phase2.mjs）—— B Winback
 *
 * 退出码：
 *   0 = 通过（下游脚本可继续）
 *   1 = 脚本自身错误（参数缺失 / 路径错误）
 *   2 = gate 未通过（findings 列表见 stderr / JSON）
 *
 * 用法：
 *   node scripts/gate-phase-a.mjs --session-dir <CPQ_SESSION_DIR>
 *   node scripts/gate-phase-a.mjs --session-dir <CPQ_SESSION_DIR> --json     # 结构化输出
 *
 * 嵌入式调用（推荐——下游脚本 CLI 入口顶部 require）：
 *   import { ensurePhaseA } from './gate-phase-a.mjs';
 *   ensurePhaseA(sessionDir);   // 不通过会 process.exit(2)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHECK_CONTEXT = join(__dirname, 'check-context.mjs');
const CHECK_PHASE1 = join(__dirname, 'check-phase1.mjs');
const CHECK_PHASE2 = join(__dirname, 'check-phase2.mjs');

/**
 * 主校验入口（同步、可单测）。
 * @param {string} sessionDir CPQ_SESSION_DIR 绝对路径
 * @returns {{ok: boolean, missing: string[], errors: string[], hasCompetitor: boolean}}
 */
export function validatePhaseA(sessionDir) {
  const missing = [];
  const errors = [];

  if (!isAbsolute(sessionDir)) {
    return { ok: false, missing: [], errors: [`--session-dir 必须是绝对路径，收到：${sessionDir}`], hasCompetitor: false };
  }
  if (!existsSync(sessionDir)) {
    return { ok: false, missing: [], errors: [`CPQ_SESSION_DIR 不存在：${sessionDir}`], hasCompetitor: false };
  }

  // 1. context.md
  const contextPath = join(sessionDir, 'context.md');
  if (!existsSync(contextPath)) {
    missing.push('context.md');
  } else {
    const r = runCheck(CHECK_CONTEXT, sessionDir);
    if (!r.ok) errors.push(...r.errors.map((e) => `[context] ${e}`));
  }

  // 2. phase1.md
  const phase1Path = join(sessionDir, 'phase1.md');
  if (!existsSync(phase1Path)) {
    missing.push('phase1.md');
  } else {
    const r = runCheck(CHECK_PHASE1, sessionDir);
    if (!r.ok) errors.push(...r.errors.map((e) => `[phase1] ${e}`));
  }

  // 3. phase2.md（仅当 phase1 含 competitor 行时强制）
  let hasCompetitor = false;
  if (existsSync(phase1Path)) {
    hasCompetitor = phase1HasCompetitor(phase1Path);
  }
  if (hasCompetitor) {
    const phase2Path = join(sessionDir, 'phase2.md');
    if (!existsSync(phase2Path)) {
      missing.push('phase2.md（含友商行 → 强制走 B Winback）');
    } else {
      const r = runCheck(CHECK_PHASE2, sessionDir);
      if (!r.ok) errors.push(...r.errors.map((e) => `[phase2] ${e}`));
    }
  }

  return {
    ok: missing.length === 0 && errors.length === 0,
    missing,
    errors,
    hasCompetitor,
  };
}

/**
 * 嵌入式调用入口：下游脚本 CLI 顶部使用。
 * 不通过则直接 process.exit(2)，把 finding 列表打到 stderr。
 *
 * @param {string} sessionDir CPQ_SESSION_DIR 绝对路径
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false] 通过时不输出 OK 行
 */
export function ensurePhaseA(sessionDir, opts = {}) {
  const { silent = false } = opts;
  const result = validatePhaseA(sessionDir);
  if (result.ok) {
    if (!silent) {
      const tag = result.hasCompetitor ? 'A+B' : 'A';
      console.error(`[gate-phase-a] OK · 阶段 ${tag} 已就位`);
    }
    return result;
  }
  printFailure(result);
  process.exit(2);
}

// ============================================================================
// 内部工具
// ============================================================================

function runCheck(scriptPath, sessionDir) {
  try {
    execFileSync('node', [scriptPath, '--session-dir', sessionDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, errors: [] };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    const errors = stderr
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return { ok: false, errors };
  }
}

/**
 * 检测 phase1.md 中是否存在 competitor 行（vendor 列 != 腾讯云 的活跃行）。
 * 解析失败时保守返回 false（让 phase1 自身的 gate 报错，本 gate 不重复）。
 */
function phase1HasCompetitor(phase1Path) {
  try {
    const content = readFileSync(phase1Path, 'utf-8');
    // 优先看 phase1-done.competitor 字段（最可靠）
    const m = content.match(/<!--\s*phase1-done:\s*([\s\S]*?)\s*-->/);
    if (m) {
      const block = m[1];
      const cm = block.match(/competitor\s*=\s*(\d+)/);
      if (cm) return parseInt(cm[1], 10) > 0;
    }
    // 兜底：扫描表格 vendor / 厂商 列
    const lines = content.split('\n').map((l) => l.trim());
    let headers = null;
    for (const line of lines) {
      if (!line.startsWith('|') || !line.endsWith('|')) continue;
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!headers) {
        headers = cells;
        continue;
      }
      // 找 vendor / 厂商 列
      const vendorIdx = headers.findIndex((h) => /vendor|厂商|品牌/i.test(h));
      if (vendorIdx === -1) continue;
      const vendor = cells[vendorIdx] || '';
      if (vendor && !/腾讯|tencent/i.test(vendor) && vendor !== '-') {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function printFailure(result) {
  process.stderr.write('\n❌ [gate-phase-a] A 阶段未就位，下游脚本拒绝执行：\n\n');
  if (result.missing.length > 0) {
    process.stderr.write('  缺失文件：\n');
    for (const m of result.missing) {
      process.stderr.write(`    - ${m}\n`);
    }
    process.stderr.write('\n');
  }
  if (result.errors.length > 0) {
    process.stderr.write('  契约校验错误：\n');
    for (const e of result.errors) {
      process.stderr.write(`    · ${e}\n`);
    }
    process.stderr.write('\n');
  }
  process.stderr.write('  修复指引：\n');
  if (result.missing.includes('context.md')) {
    process.stderr.write('    · 跑完 A 阶段「上下文准备」，落盘 context.md\n');
  }
  if (result.missing.includes('phase1.md')) {
    process.stderr.write('    · 跑完 Phase 1「解析清单」，落盘 phase1.md\n');
  }
  if (result.missing.find((m) => m.startsWith('phase2.md'))) {
    process.stderr.write(
      '    · 输入清单含友商行（competitor > 0）→ 必须走 B Winback，落盘 phase2.md\n',
    );
  }
  if (result.errors.length > 0) {
    process.stderr.write('    · 按上面契约校验错误回到对应阶段修正后再跑下游脚本\n');
  }
  process.stderr.write('\n');
}

// ============================================================================
// CLI 入口
// ============================================================================

function cliMain() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--session-dir');
  const json = args.includes('--json');
  if (idx < 0 || !args[idx + 1]) {
    process.stderr.write('用法: node scripts/gate-phase-a.mjs --session-dir <CPQ_SESSION_DIR> [--json]\n');
    process.exit(1);
  }
  const sessionDir = args[idx + 1];
  const result = validatePhaseA(sessionDir);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  }
  if (result.ok) {
    const tag = result.hasCompetitor ? 'A+B' : 'A';
    console.log(`[gate-phase-a] OK · 阶段 ${tag} 已就位`);
    process.exit(0);
  }
  printFailure(result);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain();
}
