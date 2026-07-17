#!/usr/bin/env node
/**
 * scripts/wecom/lib/utils.mjs
 * 企业微信集成层共享基础工具
 *
 * 所有 wecom 模块均 import 此文件，避免重复实现：
 *   - WecomError 结构化错误类
 *   - sanitizeForLog 日志脱敏
 *   - appendAuditLog JSONL 审计日志原子追加
 *   - resolveBookRoot bookRoot 规范化 + 校验
 *   - ANSI 颜色常量
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ─────────────────────────────────────────────
// ANSI 颜色常量（复用 wecom-probe.mjs 风格）
// ─────────────────────────────────────────────
export const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

// ─────────────────────────────────────────────
// WecomError — 结构化错误类
// ─────────────────────────────────────────────

/**
 * 企业微信集成层统一错误类型
 *
 * code 前缀约定（§4.1）：
 *   AUTH_           未初始化 / 未授权
 *   NET_            网络超时（含 NET_POLL_TIMEOUT）
 *   RATE_           API 限频
 *   RATE_EXHAUSTED  限频三档耗尽
 *   BIZ_            业务错误（文档不存在、参数超大等）
 */
export class WecomError extends Error {
  /**
   * @param {string} code   - 错误码，如 'NET_TIMEOUT'、'BIZ_PAYLOAD_TOO_LARGE'
   * @param {string} message - 人可读描述
   * @param {string} [rawOutput] - 原始 stderr/stdout（写入前会脱敏）
   */
  constructor(code, message, rawOutput = '') {
    super(message);
    this.name = 'WecomError';
    this.code = code;
    this.rawOutput = sanitizeForLog(rawOutput);
  }
}

// ─────────────────────────────────────────────
// sanitizeForLog — 日志脱敏
// ─────────────────────────────────────────────

/** 过滤包含敏感关键字的行，供 WecomError.rawOutput 写入日志前使用（§4.1/§8.2）*/
export function sanitizeForLog(str) {
  if (!str) return '';
  const SENSITIVE = /token|secret|bot_id|bot\.enc|encryption_key|password/i;
  return String(str)
    .split('\n')
    .map(line => SENSITIVE.test(line) ? '[REDACTED]' : line)
    .join('\n');
}

// ─────────────────────────────────────────────
// resolveBookRoot — bookRoot 规范化与校验
// ─────────────────────────────────────────────

/**
 * 规范化并校验 bookRoot 路径（§8.1 C6）
 *
 * 规则：
 *  1. 调用 path.resolve() 规范化（统一路径分隔符，消除相对路径）
 *  2. 拒绝 UNC 路径（\\server\share）和 /net/ 挂载路径（C6：不支持网络文件系统）
 *  3. 目录不存在时自动创建（首次写书时 bookRoot 可能尚未存在）
 *
 * @param {string} raw - 原始 bookRoot 字符串（可能为相对路径）
 * @returns {string}   - 规范化后的绝对路径
 * @throws {WecomError} BIZ_INVALID_BOOK_ROOT
 */
export function resolveBookRoot(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new WecomError('BIZ_INVALID_BOOK_ROOT', 'bookRoot 不能为空');
  }
  const resolved = path.resolve(raw);

  // 拒绝 UNC 路径（Windows: \\server\share）
  if (resolved.startsWith('\\\\')) {
    throw new WecomError(
      'BIZ_INVALID_BOOK_ROOT',
      `bookRoot 不支持 UNC 网络路径（${resolved}）。` +
      '请将书籍目录放在本地磁盘，详见设计文档 §8.1 C6。'
    );
  }

  // 拒绝 /net/ 挂载路径（Linux/macOS NFS）
  if (/^\/net\//i.test(resolved) || /^\/Volumes\/.*@/i.test(resolved)) {
    throw new WecomError(
      'BIZ_INVALID_BOOK_ROOT',
      `bookRoot 不支持网络挂载路径（${resolved}）。请使用本地磁盘路径。`
    );
  }

  // 目录不存在则创建（首次写书场景）
  if (!fs.existsSync(resolved)) {
    try {
      fs.mkdirSync(resolved, { recursive: true });
    } catch (e) {
      throw new WecomError(
        'BIZ_INVALID_BOOK_ROOT',
        `bookRoot 目录不存在且无法创建（${resolved}）：${e.message}`
      );
    }
  }

  return resolved;
}

// ─────────────────────────────────────────────
// appendAuditLog — JSONL 审计日志原子追加
// ─────────────────────────────────────────────

/**
 * 向 bookRoot/.fbs-wecom-audit.log 追加一条审计日志（§8.2）
 *
 * 格式：JSONL，每行一条 JSON，UTF-8 编码，末尾换行
 * 失败时仅输出 warn，不抛出异常（审计日志不阻断主流程）
 *
 * @param {string} bookRoot  - 已规范化的 bookRoot 路径
 * @param {object} entry     - 日志条目（不含 ts，此函数自动填充）
 */
export function appendAuditLog(bookRoot, entry) {
  try {
    const logPath = path.join(bookRoot, '.fbs-wecom-audit.log');
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (e) {
    // 审计日志写入失败不阻断主流程，仅 stderr warn
    process.stderr.write(
      `${C.yellow}[WARN][audit] 审计日志写入失败：${e.message}${C.reset}\n`
    );
  }
}

// ─────────────────────────────────────────────
// readAuditLog — 读取审计日志（供 wecom-status 使用）
// ─────────────────────────────────────────────

/**
 * 读取 bookRoot/.fbs-wecom-audit.log 并解析为对象数组
 * 解析失败的行静默跳过
 *
 * @param {string} bookRoot
 * @returns {{ exists: boolean, entries: object[] }}
 */
export function readAuditLog(bookRoot) {
  const logPath = path.join(bookRoot, '.fbs-wecom-audit.log');
  if (!fs.existsSync(logPath)) {
    return { exists: false, entries: [] };
  }
  const raw = fs.readFileSync(logPath, 'utf8');
  const entries = raw
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return { exists: true, entries };
}

// ─────────────────────────────────────────────
// platformInfo — 平台信息（供 wecom-client 使用）
// ─────────────────────────────────────────────

/** 当前平台对应的 @wecom/cli-* 包名 */
export const WECOM_PLATFORM_PKG = {
  win32:  '@wecom/cli-win32-x64',
  linux:  '@wecom/cli-linux-x64',
  darwin: '@wecom/cli-darwin-x64',
}[process.platform] ?? '@wecom/cli-win32-x64';

/** 当前机器 hostname（审计日志使用）*/
export const HOSTNAME = os.hostname();

/**
 * 解析 wecom 数据目录（兼容仓库根目录与 FBS-BookWriter 子目录两种布局）
 * @param {string} root
 * @returns {{ scenePacksDir: string, referencesScenePacksDir: string }}
 */
export function resolveWecomDataPaths(root) {
  const base = path.resolve(root || process.cwd());
  const scenePacksCandidates = [
    path.join(base, 'scene-packs'),
    path.join(base, 'FBS-BookWriter', 'scene-packs'),
  ];
  const referencesCandidates = [
    path.join(base, 'references', 'scene-packs'),
    path.join(base, 'FBS-BookWriter', 'references', 'scene-packs'),
  ];

  const scenePacksDir = scenePacksCandidates.find((p) => fs.existsSync(p)) || scenePacksCandidates[0];
  const referencesScenePacksDir = referencesCandidates.find((p) => fs.existsSync(p)) || referencesCandidates[0];

  return { scenePacksDir, referencesScenePacksDir };
}

