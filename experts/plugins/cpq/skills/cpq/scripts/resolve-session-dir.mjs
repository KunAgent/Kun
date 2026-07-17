#!/usr/bin/env node

/**
 * 解析 cpq skill 本次会话的临时目录（CPQ_SESSION_DIR）
 *
 * 设计目标：
 *   - 跨平台（macOS / Linux / Windows）
 *   - 跨沙箱（Claude Code CLI / CodeBuddy / WorkBuddy 容器 / 磐石+ 沙箱）
 *   - 不污染用户 git working tree（默认 .cpq-tmp/ 自动写 .gitignore）
 *   - 维护者 / 沙箱 operator 可通过 env 显式覆盖
 *
 * 解析顺序（前者命中即返回 · 不再回退）：
 *   1. process.env.CPQ_TMP_DIR        →  $CPQ_TMP_DIR/<ts>/
 *   2. <cwd>/.cpq-tmp/                →  <cwd>/.cpq-tmp/<ts>/    （默认 · 工作区内）
 *   3. <os.tmpdir()>/cpq/             →  <os.tmpdir()>/cpq/<ts>/ （兜底 · cwd 不可写时）
 *
 * 会话 id = `<ts>-<rand4>`（4 位随机后缀防同秒多任务碰撞）；下文路径里的 `<ts>` 一律指该完整 id。
 *
 * 用法：
 *   node scripts/resolve-session-dir.mjs                          # 生成 <ts>-<rand4>
 *   node scripts/resolve-session-dir.mjs 20260528-163045-a3f9     # 复用完整会话 id（同会话跨阶段时用）
 *
 * 输出：
 *   stdout 单行绝对路径；目录已创建并校验可写
 *   失败时 exit code 1，错误信息写 stderr
 */

import { existsSync, mkdirSync, accessSync, writeFileSync, constants as fsc } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

function fmtTs(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function rand4() {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

/**
 * 会话 id：
 * - 传入 explicit（跨阶段复用上游会话 id）→ 原样返回
 * - 否则 → `<ts>-<rand4>`，4 位随机后缀防同秒多任务碰撞
 */
export function sessionId(explicit) {
  return explicit || `${fmtTs()}-${rand4()}`;
}

function tryClaim(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsc.W_OK);
    return true;
  } catch {
    return false;
  }
}

const ts = sessionId(process.argv[2]);
const cwd = process.cwd();
const wsRoot = join(cwd, '.cpq-tmp');
const OUTBOX = '/workspace/outbox';

const candidates = [
  process.env.CPQ_TMP_DIR ? join(process.env.CPQ_TMP_DIR, ts) : null,
  existsSync(OUTBOX) ? join(OUTBOX, ts) : null,
  join(wsRoot, ts),
  join(tmpdir(), 'cpq', ts),
].filter(Boolean);

let chosen = null;
for (const c of candidates) {
  if (tryClaim(c)) {
    chosen = c;
    break;
  }
}

if (!chosen) {
  console.error('cpq: no writable session dir found. tried: ' + candidates.join(' | '));
  process.exit(1);
}

if (chosen.startsWith(wsRoot + sep)) {
  const gi = join(wsRoot, '.gitignore');
  if (!existsSync(gi)) {
    writeFileSync(gi, '*\n!.gitignore\n');
  }
}

console.log(chosen);
