#!/usr/bin/env node
/**
 * scripts/wecom/verify-member.mjs
 * 会员身份验证（T0~T3 用户层级核实）
 *
 * 设计原则：
 *   - T0（访客）：本地账本余额 0，只能使用 general
 *   - T1（注册用户）：账本有效、完成首次安装，可使用低门槛体裁
 *   - T2（付费会员）：向 api.u3w.com 验证会员状态，需网络
 *   - T3（企业授权）：验证激活码（.fbs/pending-activation.json），本地+服务端双验
 *
 * 调用方式：
 *   import { verifyMember, verifyActivationCode, getMemberTier } from './verify-member.mjs';
 *
 *   // 获取当前用户层级（T0~T3）
 *   const { tier, reason } = await getMemberTier();
 *
 *   // 验证 T2 会员（联网）
 *   const result = await verifyMember({ userid, corpId });
 *
 *   // 激活 T3 授权码（本地+服务端双验）
 *   const activation = await verifyActivationCode(code);
 *
 * CLI：
 *   node verify-member.mjs --check           输出当前层级与权益
 *   node verify-member.mjs --activate CODE   验证并写入激活码
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveWecomDataPaths, C } from './lib/utils.mjs';
import { getBalance, isLedgerInitialized } from './lib/credits-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const { scenePacksDir } = resolveWecomDataPaths(ROOT);

const PENDING_ACTIVATION_PATH = path.join(ROOT, '.fbs', 'pending-activation.json');
const USER_FILE_PATH          = path.join(ROOT, '.fbs', 'user.json');
const VERIFY_API_BASE         = 'https://api.u3w.com';
const VERIFY_TIMEOUT_MS       = 8000;

// ─────────────────────────────────────────────
// 用户层级定义
// ─────────────────────────────────────────────

/** @typedef {'T0'|'T1'|'T2'|'T3'} MemberTier */

/**
 * 各层级解锁的最高体裁门槛
 * T0: 只能用 general (0)
 * T1: 可用 genealogy (100)
 * T2: 可用 consultant / ghostwriter / whitepaper / report (200)
 * T3: 可用所有体裁，含 training (300) / personal-book (500)
 */
export const TIER_MAX_THRESHOLD = {
  T0: 0,
  T1: 100,
  T2: 200,
  T3: Infinity,
};

// ─────────────────────────────────────────────
// 主 API：获取当前用户层级
// ─────────────────────────────────────────────

/**
 * 获取当前用户的会员层级（本地判断，无需联网）
 *
 * 优先级：T3（激活码）> T2（账本余额≥200）> T1（账本已初始化）> T0
 *
 * @returns {{ tier: MemberTier, reason: string, balance: number }}
 */
export function getMemberTier() {
  // T3：本地有效激活码
  const activation = _readActivation();
  if (activation?.verified && _isActivationValid(activation)) {
    return {
      tier:    'T3',
      reason:  `企业授权码（${activation.code_prefix ?? '***'}...），有效期至 ${activation.expires_at ?? '永久'}`,
      balance: getBalance(),
    };
  }

  // 账本未初始化 → T0
  if (!isLedgerInitialized()) {
    return { tier: 'T0', reason: '账本未初始化，尚未使用过 FBS-BookWriter', balance: 0 };
  }

  const balance = getBalance();

  // T2：余额 ≥ 200
  if (balance >= TIER_MAX_THRESHOLD.T2) {
    return {
      tier:    'T2',
      reason:  `账本余额 ${balance} 个乐包（≥ T2 门槛 200）`,
      balance,
    };
  }

  // T1：账本存在（余额 ≥ 0）
  if (balance >= 0) {
    return {
      tier:    'T1',
      reason:  `账本余额 ${balance} 个乐包（已注册用户）`,
      balance,
    };
  }

  return { tier: 'T0', reason: '账本余额不足', balance };
}

// ─────────────────────────────────────────────
// T2 联网验证
// ─────────────────────────────────────────────

/**
 * 向 api.u3w.com 验证 T2 会员身份
 *
 * @param {{ userid: string, corpId?: string }} params
 * @returns {Promise<{
 *   verified: boolean,
 *   tier: MemberTier,
 *   message: string,
 *   expires_at: string|null
 * }>}
 */
export async function verifyMember({ userid, corpId = '' }) {
  if (!userid) {
    return { verified: false, tier: 'T1', message: '缺少 userid，无法验证 T2 会员身份', expires_at: null };
  }

  try {
    const url    = `${VERIFY_API_BASE}/v1/member/verify`;
    const body   = JSON.stringify({ userid, corp_id: corpId, client: 'fbs-bookwriter', version: '2.0.2' });
    const signal = AbortSignal.timeout ? AbortSignal.timeout(VERIFY_TIMEOUT_MS) : undefined;

    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(signal ? { signal } : {}),
    });

    if (!resp.ok) {
      return {
        verified: false,
        tier:     'T1',
        message:  `验证服务响应异常（HTTP ${resp.status}），降级为 T1`,
        expires_at: null,
      };
    }

    const data = await resp.json();

    if (data.verified) {
      // 写入本地用户文件，缓存验证结果（有效期内免重复联网）
      _writeUserFile({ userid, corpId, tier: data.tier ?? 'T2', verified_at: new Date().toISOString(), expires_at: data.expires_at ?? null });
      return {
        verified:   true,
        tier:       data.tier ?? 'T2',
        message:    `T2 会员验证通过（userid: ${userid}）`,
        expires_at: data.expires_at ?? null,
      };
    }

    return {
      verified:   false,
      tier:       'T1',
      message:    data.message ?? '验证未通过，降级为 T1',
      expires_at: null,
    };
  } catch (err) {
    // 网络不可达：降级本地判断，不阻断流程
    const cached = _readUserFile();
    if (cached?.tier && _isCachedVerifyValid(cached)) {
      return {
        verified:   true,
        tier:       cached.tier,
        message:    `网络不可达，使用缓存验证结果（${cached.tier}，${cached.verified_at}）`,
        expires_at: cached.expires_at ?? null,
      };
    }
    return {
      verified:   false,
      tier:       'T1',
      message:    `网络不可达（${err.message}），降级为 T1。联网后可重新验证。`,
      expires_at: null,
    };
  }
}

// ─────────────────────────────────────────────
// T3 激活码验证
// ─────────────────────────────────────────────

/**
 * 验证并激活 T3 企业授权码
 * 1. 本地格式校验（防无效码占位）
 * 2. 联网向服务端验证（有网时）
 * 3. 写入 .fbs/pending-activation.json
 *
 * @param {string} code - 激活码（格式：FBS-XXXX-XXXX-XXXX-XXXX）
 * @returns {Promise<{
 *   success: boolean,
 *   message: string,
 *   tier: MemberTier,
 *   expires_at: string|null
 * }>}
 */
export async function verifyActivationCode(code) {
  if (!code || typeof code !== 'string') {
    return { success: false, message: '激活码不能为空', tier: 'T1', expires_at: null };
  }

  // 本地格式预校验（FBS-XXXX-XXXX-XXXX-XXXX 或 FBS-ENT-XXXX-XXXX）
  const cleaned = code.trim().toUpperCase();
  if (!_isValidCodeFormat(cleaned)) {
    return {
      success: false,
      message: `激活码格式无效：${cleaned}。正确格式：FBS-XXXX-XXXX-XXXX-XXXX 或 FBS-ENT-XXXX-XXXX`,
      tier:    'T1',
      expires_at: null,
    };
  }

  // 联网验证
  let serverVerified = false;
  let serverData     = null;
  try {
    const url    = `${VERIFY_API_BASE}/v1/activation/verify`;
    const signal = AbortSignal.timeout ? AbortSignal.timeout(VERIFY_TIMEOUT_MS) : undefined;
    const resp   = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code: cleaned, client: 'fbs-bookwriter', version: '2.0.2' }),
      ...(signal ? { signal } : {}),
    });

    if (resp.ok) {
      serverData     = await resp.json();
      serverVerified = serverData?.verified === true;
    }
  } catch {
    // 网络不可达：允许离线暂存，联网后二次验证
    process.stderr.write(`${C.yellow}[verify-member] 网络不可达，激活码暂存本地，下次联网时自动二次验证${C.reset}\n`);
  }

  if (!serverVerified && serverData?.verified === false) {
    return {
      success:    false,
      message:    serverData?.message ?? '服务端验证未通过，激活码无效或已过期',
      tier:       'T1',
      expires_at: null,
    };
  }

  // 写入本地激活文件
  const activation = {
    code_prefix:   cleaned.slice(0, 7),    // 仅存前缀，不存完整码
    code_hash:     _hashCode(cleaned),     // 简单哈希防重放
    verified:      serverVerified,
    pending_reverify: !serverVerified,     // 离线暂存时标记待重验
    activated_at:  new Date().toISOString(),
    expires_at:    serverData?.expires_at ?? null,
    tier:          serverData?.tier ?? 'T3',
  };

  try {
    fs.mkdirSync(path.dirname(PENDING_ACTIVATION_PATH), { recursive: true });
    fs.writeFileSync(PENDING_ACTIVATION_PATH, JSON.stringify(activation, null, 2), 'utf8');
  } catch (err) {
    return {
      success:    false,
      message:    `激活码写入失败：${err.message}`,
      tier:       'T1',
      expires_at: null,
    };
  }

  return {
    success:    true,
    message:    serverVerified
      ? `T3 企业授权码激活成功！有效期：${activation.expires_at ?? '永久'}`
      : `激活码已暂存，下次联网时自动完成服务端验证（当前离线模式）`,
    tier:       activation.tier,
    expires_at: activation.expires_at,
  };
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function _readActivation() {
  if (!fs.existsSync(PENDING_ACTIVATION_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(PENDING_ACTIVATION_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function _isActivationValid(activation) {
  if (!activation?.activated_at) return false;
  if (activation.pending_reverify) return false; // 离线暂存，未完成服务端验证
  if (!activation.expires_at) return true;       // 永久激活码
  return new Date(activation.expires_at).getTime() > Date.now();
}

function _readUserFile() {
  if (!fs.existsSync(USER_FILE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(USER_FILE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function _writeUserFile(data) {
  try {
    fs.mkdirSync(path.dirname(USER_FILE_PATH), { recursive: true });
    fs.writeFileSync(USER_FILE_PATH, JSON.stringify({ ...data, _version: '1.0' }, null, 2), 'utf8');
  } catch { /* 缓存写入失败不阻断 */ }
}

function _isCachedVerifyValid(cached) {
  if (!cached?.verified_at) return false;
  if (!cached?.expires_at) return true;
  return new Date(cached.expires_at).getTime() > Date.now();
}

function _isValidCodeFormat(code) {
  // FBS-XXXX-XXXX-XXXX-XXXX（标准版）或 FBS-ENT-XXXX-XXXX（企业版短码）
  return /^FBS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)
      || /^FBS-ENT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
}

/** 简单哈希（防重放比对，非加密用途） */
function _hashCode(code) {
  let h = 5381;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) + h) ^ code.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────
// CLI 入口
// ─────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    const { tier, reason, balance } = getMemberTier();
    process.stdout.write(
      `\n${C.cyan}[会员层级]${C.reset} ${tier}\n` +
      `${C.gray}原因：${reason}${C.reset}\n` +
      `${C.gray}乐包余额：${balance} 个${C.reset}\n\n` +
      `可解锁门槛：T0=general(0) / T1≥100 / T2≥200 / T3=全部\n\n`
    );
  } else if (args.includes('--activate')) {
    const codeIdx = args.indexOf('--activate');
    const code    = args[codeIdx + 1];
    if (!code) {
      process.stderr.write(`${C.red}用法：node verify-member.mjs --activate <激活码>${C.reset}\n`);
      process.exit(1);
    }
    verifyActivationCode(code).then(result => {
      process.stdout.write(
        `\n${result.success ? C.green : C.red}[激活结果]${C.reset} ${result.message}\n` +
        `层级：${result.tier}，有效期：${result.expires_at ?? '永久'}\n\n`
      );
      process.exit(result.success ? 0 : 1);
    });
  } else {
    process.stdout.write(
      `用法：\n` +
      `  node verify-member.mjs --check              # 查询当前层级\n` +
      `  node verify-member.mjs --activate <激活码>  # 激活 T3 授权码\n`
    );
  }
}
