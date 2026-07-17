#!/usr/bin/env node
/**
 * scripts/wecom/auth-check.mjs
 * 企微连接状态探测 + .gitignore 维护
 *
 * v2.0 定位：企微为只读配置载体（企微→FBS），书稿不写企微。
 * assertAuthReady() 用于场景包拉取前探测连接状态：
 *   - exe 不存在或凭证未就绪 → mode='local'，调用方走本地降级路径
 *   - 连接正常 → mode='wecom'，调用方可尝试从企微拉取规则
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WecomError, resolveBookRoot, C } from './lib/utils.mjs';
import { wecomRun, resolveExePath, scenePackToken } from './wecom-client.mjs';

export { scenePackToken };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .gitignore 须包含的条目（防止状态文件意外提交）
const GITIGNORE_ENTRIES = [
  '.fbs-wecom-state.json',
  '.fbs-wecom-audit.log',
  'scene-packs/user-config.json',
];

// ─────────────────────────────────────────────
// assertAuthReady
// ─────────────────────────────────────────────

/**
 * 探测企微连接状态（只读探测，不进行任何写入）
 *
 * @returns {Promise<{ ready: boolean, mode: 'wecom' | 'local' }>}
 */
export async function assertAuthReady() {
  // exe 不存在 → 本地模式
  const exePath = resolveExePath();
  if (!exePath) {
    process.stderr.write(`${C.yellow}[auth-check] 未找到 wecom-cli exe，本地模式${C.reset}\n`);
    return { ready: true, mode: 'local' };
  }

  // 轻量接口探测
  try {
    await wecomRun('contact', 'get_userlist', {});
    return { ready: true, mode: 'wecom' };
  } catch (err) {
    const code = err instanceof WecomError ? err.code : '';
    if (code.startsWith('AUTH_')) {
      process.stderr.write(`${C.yellow}[auth-check] 凭证未就绪（${code}），本地模式${C.reset}\n`);
      return { ready: true, mode: 'local' };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// ensureGitignore
// ─────────────────────────────────────────────

/**
 * 自动追加 .gitignore 条目
 * @param {string} bookRoot
 */
export async function ensureGitignore(bookRoot) {
  const resolved = resolveBookRoot(bookRoot);
  const gitignorePath = path.join(resolved, '.gitignore');

  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }

  const missing = GITIGNORE_ENTRIES.filter(entry => {
    const lines = existing.split('\n').map(l => l.trim());
    return !lines.includes(entry);
  });

  if (missing.length === 0) return;

  const toAppend = '\n# FBS-BookWriter 状态文件（自动追加）\n' +
    missing.map(e => e + '\n').join('');
  fs.appendFileSync(gitignorePath, toAppend, 'utf8');
  process.stderr.write(
    `${C.cyan}[auth-check] .gitignore 已追加：${missing.join(', ')}${C.reset}\n`
  );
}
