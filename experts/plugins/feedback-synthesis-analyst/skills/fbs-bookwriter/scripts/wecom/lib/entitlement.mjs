#!/usr/bin/env node
/**
 * scripts/wecom/lib/entitlement.mjs
 * 乐包权益门禁（评审决议 R1/R7）
 *
 * v2.1 变更：接入本地乐包账本（credits-ledger.mjs）
 *   - 优先读本地账本余额（credits-ledger.json）
 *   - 次读 enterprise.json 静态字段（向后兼容）
 *   - 余额不足时触发升级提醒钩子 getUpgradeHint()
 *   - 正式后端上线后替换 _getBalanceFromBackend()
 *
 * general 体裁永久免费（R1）：credits_required=0，注册用户直接放行
 * 无权益时静默降级到 general，写 audit log，不弹错误（R1 无感知原则）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { appendAuditLog, C, resolveWecomDataPaths } from './utils.mjs';
import { getBalance, getUpgradeHint, isLedgerInitialized } from './credits-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const { scenePacksDir } = resolveWecomDataPaths(ROOT);
const ENTERPRISE_PATH = path.join(scenePacksDir, 'enterprise.json');


// ─────────────────────────────────────────────
// 体裁乐包门槛（本地默认值，优先读官方 entitlement sheet）
// ─────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  'general':       0,    // 永久免费（R1）
  'genealogy':     100,
  'consultant':    200,
  'ghostwriter':   200,  // 章节级产品（R3）
  'whitepaper':    200,
  'report':        200,
  'training':      300,
  'personal-book': 500,
};

// ─────────────────────────────────────────────
// 主入口：checkEntitlement
// ─────────────────────────────────────────────

/**
 * 检查用户是否有权使用指定体裁
 * 无权时静默降级到 general，不抛错
 *
 * @param {string}   genre       - 目标体裁
 * @param {object}   corpConfig  - enterprise.json 内容（可为 null）
 * @param {object[]} [entitlementSheet] - 官方 entitlement sheet 解析结果（可为 null）
 * @param {string}   [bookRoot]  - 用于写 audit log
 * @returns {{ allowed: boolean, genre: string, mode: 'free'|'paid'|'fallback' }}
 */
export async function checkEntitlement(genre, corpConfig, entitlementSheet, bookRoot) {
  // general 永久免费，直接放行（R1）
  if (genre === 'general') {
    return { allowed: true, genre: 'general', mode: 'free' };
  }

  // 读取该体裁的乐包门槛
  const threshold = _getThreshold(genre, entitlementSheet);

  // 门槛为 0：免费放行
  if (threshold === 0) {
    return { allowed: true, genre, mode: 'free' };
  }

  // 检查企业包是否启用该体裁
  const packConfig = corpConfig?.packs?.[genre];
  if (packConfig && packConfig.enabled === false) {
    _logFallback(bookRoot, genre, 'corp_pack_disabled', threshold, 0);
    return { allowed: false, genre: 'general', mode: 'fallback' };
  }

  // 检查乐包余额（优先本地账本，次读 enterprise.json 静态字段）
  const balance = _getBalance(corpConfig, genre);

  if (balance >= threshold) {
    return { allowed: true, genre, mode: 'paid' };
  }

  // 余额不足：触发升级提醒钩子（透传 entitlementSheet 获取最新阈值）
  const upgradeHint = getUpgradeHint(entitlementSheet);
  _logFallback(bookRoot, genre, 'insufficient_credits', threshold, balance, upgradeHint);

  if (upgradeHint.hint) {
    process.stderr.write(`${C.cyan}[乐包] ${upgradeHint.hint}${C.reset}\n`);
  }
  process.stderr.write(
    `${C.gray}[entitlement] ${genre}(需${threshold}个乐包) 余额${balance}，降级→general${C.reset}\n`
  );

  return { allowed: false, genre: 'general', mode: 'fallback', upgradeHint };
}

// ─────────────────────────────────────────────
// 读取门槛（优先官方 sheet，其次本地默认）
// ─────────────────────────────────────────────

function _getThreshold(genre, entitlementSheet) {
  if (entitlementSheet?.length) {
    const entry = entitlementSheet.find(e => e.genre === genre);
    if (entry) return Number(entry.credits_required ?? 0);
  }
  return DEFAULT_THRESHOLDS[genre] ?? 200;
}

// ─────────────────────────────────────────────
// MVP 过渡：读取乐包余额
// 优先本地账本（credits-ledger.json），次读 enterprise.json 静态字段
// ─────────────────────────────────────────────

/**
 * 读取乐包余额
 * 1. 本地账本余额（credits-ledger.json）—— 账本已初始化则以账本为准（含余额=0）
 * 2. enterprise.json 体裁级 credits_balance
 * 3. enterprise.json 顶层 credits_balance
 * 4. corp_id 存在 → 企业版信任，返回 Infinity（向后兼容，仅账本未初始化时生效）
 */
function _getBalance(corpConfig, genre) {
  // 优先读本地账本（用户行为积累的乐包）
  // 注意：账本已初始化（文件存在）时，余额=0 也应以账本为准，不再回退 corp_id Infinity
  if (isLedgerInitialized()) return getBalance();

  if (!corpConfig) return 0;

  // 体裁级余额（精确控制，由管理员手动配置）
  const packBalance = corpConfig.packs?.[genre]?.credits_balance;
  if (typeof packBalance === 'number') return packBalance;

  // 顶层余额
  const topBalance = corpConfig.credits_balance;
  if (typeof topBalance === 'number') return topBalance;

  // 无余额字段：企业版信任（商务流程已验证）
  if (corpConfig.corp_id) return Infinity;

  return 0;
}

// ─────────────────────────────────────────────
// audit log
// ─────────────────────────────────────────────

function _logFallback(bookRoot, genre, reason, threshold, balance, upgradeHint) {
  if (!bookRoot) return;
  appendAuditLog(bookRoot, {
    event:     'entitlement_fallback',
    genre,
    reason,
    threshold,
    balance,
    fallback:  'general',
    upgradeHint: upgradeHint?.hint ?? null,
  });
}

// ─────────────────────────────────────────────
// 读取企业配置（供外部调用）
// ─────────────────────────────────────────────

/**
 * 读取企业配置（供外部调用）
 * FIX-P2-02: loadCorpConfig 加载后自动调用 validateCorpConfig 做启动时校验，将 errors/warnings 输出 stderr
 * @returns {object|null}
 */
export function loadCorpConfig() {
  if (!fs.existsSync(ENTERPRISE_PATH)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(ENTERPRISE_PATH, 'utf8'));
    // 启动时自动校验配置（仅当不是占位符模板时）
    if (config?.corp_id && !config.corp_id.startsWith('${')) {
      const { valid, errors, warnings } = validateCorpConfig(config);
      if (!valid) {
        for (const e of errors) {
          process.stderr.write(`${C.red}[enterprise] 配置错误：${e}${C.reset}\n`);
        }
      }
      for (const w of warnings) {
        process.stderr.write(`${C.yellow}[enterprise] 配置警告：${w}${C.reset}\n`);
      }
    }
    return config;
  } catch {
    return null;
  }
}

/**
 * 验证 enterprise.json 配置合法性（config-check，R13）
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateCorpConfig(config) {
  const errors   = [];
  const warnings = [];
  if (!config) return { valid: false, errors: ['enterprise.json 不存在或解析失败'], warnings: [] };

  if (!config.corp_id) errors.push('缺少 corp_id 字段');

  const accessMode = config.access_mode ?? 'same-corp';
  const validModes = ['same-corp', 'cross-corp', 'public-link'];
  if (!validModes.includes(accessMode)) {
    errors.push(`access_mode 无效：${accessMode}，合法值：${validModes.join(' / ')}`);
  }

  // 跨 corp 模式的额外校验
  if (accessMode === 'cross-corp') {
    if (!config.user_corp_id) {
      warnings.push('access_mode=cross-corp 时建议填写 user_corp_id（用户所在企业微信 corp_id）');
    }
    if (!config.corp_spreadsheet_url) {
      warnings.push('access_mode=cross-corp 时建议用 corp_spreadsheet_url（URL）而非 docid，确保跨 corp 可访问');
    }
  }

  // public-link 模式必须有 URL
  if (accessMode === 'public-link' && !config.corp_spreadsheet_url) {
    errors.push('access_mode=public-link 时必须填写 corp_spreadsheet_url');
  }

  // same-corp 或有 id 时校验 spreadsheet 配置
  if (accessMode === 'same-corp' && !config.corp_spreadsheet_id && !config.corp_spreadsheet_url) {
    errors.push('缺少 corp_spreadsheet_id（或 corp_spreadsheet_url）字段——企业覆盖文档 ID');
  }

  if (config.permissions?.advanced_customization === true) {
    const tokenInConfig = String(config.permissions?.advanced_customization_token ?? '').trim();
    const tokenInEnv = String(process.env.FBS_ADVANCED_CUSTOMIZATION_TOKEN ?? '').trim();
    if (!tokenInConfig) {
      errors.push('advanced_customization=true 时必须提供 permissions.advanced_customization_token');
    } else if (!tokenInEnv) {
      warnings.push('advanced_customization 已开启，但环境变量 FBS_ADVANCED_CUSTOMIZATION_TOKEN 未设置，运行时将拒绝 must 级覆盖');
    } else if (tokenInConfig !== tokenInEnv) {
      errors.push('advanced_customization_token 校验失败（与环境变量 FBS_ADVANCED_CUSTOMIZATION_TOKEN 不一致）');
    }
  }


  const validGenres = ['general', 'genealogy', 'consultant', 'ghostwriter', 'whitepaper', 'report', 'training', 'personal-book'];
  for (const [genre, packCfg] of Object.entries(config.packs ?? {})) {
    if (!validGenres.includes(genre)) {
      errors.push(`未知体裁：${genre}（合法值：${validGenres.join('/')}）`);
    }
    if (typeof packCfg.enabled !== 'boolean') {
      errors.push(`packs.${genre}.enabled 应为 boolean`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
