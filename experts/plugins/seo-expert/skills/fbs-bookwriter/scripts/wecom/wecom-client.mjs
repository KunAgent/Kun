#!/usr/bin/env node
/**
 * scripts/wecom/wecom-client.mjs
 * wecom-cli 统一调用入口
 *
 * 职责：封装对 @wecom/cli 的所有调用，提供统一的错误处理、重试、审计日志。
 * 上层模块（auth-check / scene-pack-loader / scene-pack-admin）只调用此模块，
 * 不直接 spawn wecom-cli。
 *
 * 核心策略（§4.1，PROBE 全部 PASS）：
 *   - 直接 spawn 真实 .exe，shell:false，JSON 作 args[2] 独立项
 *   - 双层 JSON 解析：outer.content[0].text → inner
 *   - C9：JSON 参数总长度 ≤ 20KB，超限立即抛 BIZ_PAYLOAD_TOO_LARGE
 *   - NET_ 重试：指数退避 500ms/1s/2s，最多 3 次
 *   - RATE_ 三档退避：2s → 10s → 30s → RATE_EXHAUSTED
 *   - 审计日志：每次调用后写入 bookRoot/.fbs-wecom-audit.log（JSONL）
 *
 * ── stdin 方案探测结论（2026-04-05）────────────────────────────────
 *   wecom-cli 对 stdin 传参支持不一致：
 *   - contact get_userlist（无必填字段）：stdin 有效，读到 {}
 *   - doc create_doc（有必填字段）：stdin 无效，内部忽略 stdin，
 *     实际读到的是空 {}，提示 doc_type/doc_name 为必填（pydantic 验证错误）
 *   结论：wecom-cli 只在 args[2] 缺失时才读 stdin，且读到的始终是空 {}，
 *   不是我们写入的实际 JSON。args[2] 是唯一可靠的参数传递方式。
 *   命令行长度限制（32767B）是当前架构下的硬约束，C9（20KB）保持有效。
 */

import { spawn, spawnSync } from 'child_process';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WecomError,
  sanitizeForLog,
  appendAuditLog,
  WECOM_PLATFORM_PKG,
  HOSTNAME,
  C,
} from './lib/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ─────────────────────────────────────────────
// 可配置常量（§4.3，P1 验收 checklist 要求）
// ─────────────────────────────────────────────
export const POLL_MAX_RETRIES = 10;
export const POLL_INTERVAL_MS = 500;
const C9_LIMIT = 20 * 1024;            // 20KB JSON 参数安全阈值（§4.1 C9，Windows 命令行硬限 ~32KB）
const SPAWN_TIMEOUT_MS = 60_000;       // 单次 spawn 超时 60s
const NET_RETRY_DELAYS = [500, 1000, 2000];       // NET_ 退避间隔
const RATE_RETRY_DELAYS = [2000, 10_000, 30_000]; // RATE_ 三档退避

// ─────────────────────────────────────────────
// FBS_SCENE_PACK_TOKEN — 一次性读取并冻结（§8.2 SecOps）
// ─────────────────────────────────────────────
export const scenePackToken = Object.freeze({
  value:   process.env.FBS_SCENE_PACK_TOKEN ?? '',
  present: Boolean(process.env.FBS_SCENE_PACK_TOKEN),
});

// ─────────────────────────────────────────────
// 插件版本（审计日志用，从 package.json 读取）
// ─────────────────────────────────────────────
let _pluginVersion = '1.60';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  _pluginVersion = String(pkg.version ?? '1.60');
} catch { /* 降级使用默认值 */ }

// ─────────────────────────────────────────────
// exe 路径解析（跨平台，§4.1）
// ─────────────────────────────────────────────

/**
 * 解析 wecom-cli 真实 exe 路径
 * 优先级：环境变量显式指定 → 本地平台包 → PATH 中全局命令
 *
 * @returns {string|null} exe 绝对路径，不存在返回 null
 */
export function resolveExePath() {
  const envPath = String(process.env.FBS_WECOM_CLI_PATH ?? '').trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const binDir = path.join(ROOT, 'node_modules', WECOM_PLATFORM_PKG, 'bin');
  const exeWithExt = path.join(binDir, 'wecom-cli.exe');
  const exeNoExt   = path.join(binDir, 'wecom-cli');
  if (fs.existsSync(exeWithExt)) return exeWithExt;
  if (fs.existsSync(exeNoExt))   return exeNoExt;

  return resolveGlobalExePath();
}

function resolveGlobalExePath() {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, ['wecom-cli'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.status !== 0) return null;
  const firstLine = String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  return firstLine && fs.existsSync(firstLine) ? firstLine : null;
}


// ─────────────────────────────────────────────
// 核心：wecomRun
// ─────────────────────────────────────────────

/**
 * 执行 wecom-cli 命令，返回解析后的内层 JSON 结果（inner 对象）
 *
 * @param {string} category   - 如 'doc'、'contact'
 * @param {string} method     - 如 'create_doc'、'edit_doc_content'
 * @param {object} [params]   - 请求参数（会被序列化为 JSON args[2]）
 * @param {object} [opts]
 * @param {string} [opts.bookRoot]     - 用于写审计日志（可选）
 * @param {string} [opts.sessionId]   - UUID 前 8 位，写入审计日志
 * @param {string} [opts.source]      - 'enterprise' 时审计日志标注（H3）
 * @returns {Promise<object>}         - inner 对象（errcode=0 时）
 * @throws {WecomError}
 */
export async function wecomRun(category, method, params = {}, opts = {}) {
  // ── C9：参数大小强制断言（Windows 命令行长度硬限约 32767B，取 20KB 保守阈值）──
  const jsonStr = JSON.stringify(params);
  if (jsonStr.length > C9_LIMIT) {
    throw new WecomError(
      'BIZ_PAYLOAD_TOO_LARGE',
      `JSON 参数 ${jsonStr.length} 字节超过 20KB 安全阈值（C9），请分片后调用`,
      `params.length=${jsonStr.length}`
    );
  }

  // ── exe 存在性检查 ────────────────────────────
  const exePath = resolveExePath();
  if (!exePath) {
    throw new WecomError(
      'AUTH_CLI_NOT_FOUND',
      `未找到 wecom-cli 可执行文件（${WECOM_PLATFORM_PKG}），` +
      '请先执行 npm install 或检查插件安装是否完整'
    );
  }

  const t0 = Date.now();
  let lastError;

  // ── RATE_ 重试外层（三档退避） ─────────────────
  for (let rateAttempt = 0; rateAttempt < RATE_RETRY_DELAYS.length + 1; rateAttempt++) {
    // ── NET_ 重试内层（指数退避） ─────────────────
    for (let netAttempt = 0; netAttempt < NET_RETRY_DELAYS.length + 1; netAttempt++) {
      try {
        const inner = await _spawnOnce(exePath, category, method, jsonStr);
        const durationMs = Date.now() - t0;

        // ── 审计日志 ────────────────────────────────
        _writeAudit(opts, { category, method, durationMs, ok: true, errcode: 0 });

        return inner;
      } catch (err) {
        lastError = err;
        const code = err instanceof WecomError ? err.code : 'UNKNOWN';

        // ── RATE_ 错误：跳出 NET_ 循环，进入 RATE_ 退避 ──
        if (code.startsWith('RATE_') && code !== 'RATE_EXHAUSTED') {
          break; // 跳出 NET_ 内层，由外层 RATE_ 处理
        }

        // ── 业务错误：立即抛出 ────────────────────
        if (code.startsWith('BIZ_') || code.startsWith('AUTH_')) {
          const durationMs = Date.now() - t0;
          _writeAudit(opts, { category, method, durationMs, ok: false,
            errcode: -1, errMsg: err.message });
          throw err;
        }

        // ── NET_ 错误：等待后重试 ─────────────────
        if (code.startsWith('NET_') && netAttempt < NET_RETRY_DELAYS.length) {
          const delay = NET_RETRY_DELAYS[netAttempt];
          process.stderr.write(
            `${C.yellow}[WARN][wecom] NET 重试 ${netAttempt + 1}/3，等待 ${delay}ms…${C.reset}\n`
          );
          await _sleep(delay);
          continue;
        }

        // ── 最后一次 NET_ 重试失败 ────────────────
        if (netAttempt >= NET_RETRY_DELAYS.length) {
          const durationMs = Date.now() - t0;
          _writeAudit(opts, { category, method, durationMs, ok: false,
            errcode: -1, errMsg: err.message });
          throw err;
        }
      }
    }

    // ── RATE_ 退避处理 ────────────────────────────
    if (!(lastError instanceof WecomError) || !lastError.code.startsWith('RATE_')) {
      break;
    }
    if (rateAttempt >= RATE_RETRY_DELAYS.length) {
      const exhausted = new WecomError(
        'RATE_EXHAUSTED',
        '企业微信 API 限频三档耗尽，请稍后重试或联系管理员确认企业微信 API 配额',
        lastError.rawOutput
      );
      const durationMs = Date.now() - t0;
      _writeAudit(opts, { category, method, durationMs, ok: false,
        errcode: -1, errMsg: exhausted.message });
      throw exhausted;
    }
    const rateDelay = RATE_RETRY_DELAYS[rateAttempt];
    process.stderr.write(
      `${C.yellow}[WARN][wecom] RATE 退避 ${rateAttempt + 1}/3，等待 ${rateDelay / 1000}s…${C.reset}\n`
    );
    await _sleep(rateDelay);
  }

  // 不应到达此处
  throw lastError ?? new WecomError('UNKNOWN', '未知错误');
}

// ─────────────────────────────────────────────
// _spawnOnce — 单次 spawn 并解析结果
// ─────────────────────────────────────────────

async function _spawnOnce(exePath, category, method, jsonStr) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(exePath, [category, method, jsonStr], {
        shell: false,
        windowsHide: true,
      });
    } catch (e) {
      return reject(new WecomError('NET_SPAWN_FAIL', `spawn 失败：${e.message}`, e.message));
    }

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new WecomError('NET_TIMEOUT', `spawn 超时（${SPAWN_TIMEOUT_MS / 1000}s）`, stderr));
    }, SPAWN_TIMEOUT_MS);

    proc.on('close', code => {
      clearTimeout(timer);
      const raw = stdout.trim();

      if (code !== 0) {
        const errText = sanitizeForLog(stderr.trim() || raw);
        const isAuth = /auth|login|init|unauthorized|token/i.test(errText);
        const isRate = /rate.?limit|too.?many.?request|429/i.test(errText);
        const errCode = isAuth ? 'AUTH_REJECTED' : isRate ? 'RATE_LIMITED' : 'NET_ERROR';
        return reject(new WecomError(errCode, errText, stderr));
      }

      // ── 双层 JSON 解析（§4.1 R2） ──────────────────
      try {
        const outer = JSON.parse(raw);
        // 内层在 content[0].text 里再次序列化
        const innerRaw = outer?.content?.[0]?.text;
        if (innerRaw) {
          const inner = JSON.parse(innerRaw);
          if (inner.errcode !== 0 && inner.errcode !== undefined) {
            const isRate = inner.errcode === 45009 || inner.errcode === 429;
            const errCode = isRate ? 'RATE_LIMITED' : `BIZ_ERRCODE_${inner.errcode}`;
            return reject(new WecomError(
              errCode,
              inner.errmsg || `企业微信接口错误（errcode: ${inner.errcode}）`,
              raw
            ));
          }
          return resolve(inner);
        }
        // 无内层，直接返回 outer
        return resolve(outer);
      } catch {
        // JSON 解析失败，返回原始字符串（由调用方决定）
        return resolve(raw);
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new WecomError('NET_SPAWN_FAIL', `进程错误：${err.message}`, err.message));
    });
  });
}

// ─────────────────────────────────────────────
// _writeAudit — 写审计日志（内部用）
// ─────────────────────────────────────────────

function _writeAudit(opts, fields) {
  if (!opts.bookRoot) return;
  const entry = {
    category: fields.category,
    method:   fields.method,
    durationMs: fields.durationMs,
    ok:       fields.ok,
    errcode:  fields.errcode,
    session_id:     opts.sessionId ?? undefined,
    hostname:       HOSTNAME,
    plugin_version: _pluginVersion,
    ...(opts.source === 'enterprise' ? { source: 'enterprise' } : {}),
    ...(fields.errMsg ? { errMsg: fields.errMsg } : {}),
  };
  // 清除 undefined 字段
  Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);
  appendAuditLog(opts.bookRoot, entry);
}

// ─────────────────────────────────────────────
// _sleep
// ─────────────────────────────────────────────
function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
// CLI 入口（npm run wecom:ping 调用）
// ─────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.includes('--ping')) {
    console.log(`${C.cyan}[wecom-client] --ping 模式：检测 exe 路径${C.reset}`);
    const exe = resolveExePath();
    if (exe) {
      console.log(`${C.green}✅ wecom-cli exe：${exe}${C.reset}`);
    } else {
      console.log(`${C.red}❌ 未找到 wecom-cli exe（${WECOM_PLATFORM_PKG}）${C.reset}`);
      process.exit(1);
    }
  }
}
