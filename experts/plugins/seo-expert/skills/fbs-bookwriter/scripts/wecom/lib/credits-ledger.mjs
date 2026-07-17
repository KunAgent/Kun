#!/usr/bin/env node
/**
 * scripts/wecom/lib/credits-ledger.mjs
 * 本地乐包账本
 *
 * 设计原则：
 *   - 纯本地，不依赖网络；正式后端上线后可无缝替换读写层
 *   - 账本文件：scene-packs/credits-ledger.json（与 enterprise.json 同目录）
 *   - 流水记录：scene-packs/credits-ledger-log.jsonl（只追加，不修改）
 *   - 原子写入（tmp + rename）防止文件损坏
 *   - 乐包来源
 *       'book_complete'   完成一本书（+50 个乐包）
 *       'chapter_done'    完成一章      (+10 个乐包)
 *       'daily_login'     每日首次使用  (+5 个乐包)
 *       'quality_pass'    章节质检通过  (+3 个乐包)
 *       's6_transform'    完成 S6 转化  (+12 个乐包)
 *       'release_ready'   写入发布映射  (+8 个乐包)
 *       'first_install'   首次安装奖励  (+100 个乐包，幂等)
 *       'scene_pack_use'  使用付费场景包（消耗乐包）
 *       'manual'          管理员手动调整
 *   - 激活提醒阈值：距离最近可解锁体裁差距 ≤ 20 个乐包时提醒
 *
 * 对外 API：
 *   isLedgerInitialized()             → boolean（账本文件是否存在）
 *   getBalance()                      → number
 *   addCredits(source, amount, note)  → number (新余额)
 *   deductCredits(source, amount, note) → number (新余额) / throws if insufficient
 *   checkFirstInstall()               → { added: boolean, balance: number }
 *   checkDailyLogin()                 → { added: boolean, balance: number }
 *   getUpgradeHint()                  → { hint: string|null, nearestGenre, gap }
 *   notifyUpgradeIfNeeded()           → { level, message } 熟客分级提醒（闭环核心）
 *   readLedger()                      → { balance, updatedAt, ... }
 *   formatBalanceSummary()            → string Markdown
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveWecomDataPaths, C } from './utils.mjs';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '../../..');
const { scenePacksDir } = resolveWecomDataPaths(ROOT);

const LEDGER_PATH = path.join(scenePacksDir, 'credits-ledger.json');
const LOG_PATH    = path.join(scenePacksDir, 'credits-ledger-log.jsonl');

function shouldEmitCreditsLogs() {
  const level = String(process.env.FBS_CREDITS_LOG_LEVEL || '').trim().toLowerCase();
  return level === 'debug' || level === 'verbose';
}

function emitCreditsLog(message) {
  if (!shouldEmitCreditsLogs()) return;
  process.stderr.write(`${message}\n`);
}

// ─────────────────────────────────────────────
// 体裁乐包门槛（与 entitlement.mjs 保持一致）
// ─────────────────────────────────────────────
export const GENRE_THRESHOLDS = {
  'general':       0,
  'genealogy':     100,
  'consultant':    200,
  'ghostwriter':   200,
  'whitepaper':    200,
  'report':        200,
  'training':      300,
  'personal-book': 500,
};

/** 乐包来源与默认奖励值
 *  FIX-P2-06: 补全 s6_transform (+12) 和 release_ready (+8) 的 amount 字段
 */
export const CREDIT_SOURCES = {
  first_install:   { amount: 100, label: '首次安装奖励' },
  book_complete:   { amount: 50,  label: '完成一本书' },
  chapter_done:    { amount: 10,  label: '完成一章' },
  daily_login:     { amount: 5,   label: '每日首次使用' },
  quality_pass:    { amount: 3,   label: '章节质检通过' },
  s6_transform:    { amount: 12,  label: '完成 S6 转化' },
  release_ready:   { amount: 8,   label: '写入发布映射' },
  scene_pack_use:  { amount: 0,   label: '使用付费场景包（消耗）' },
  manual:          { amount: 0,   label: '手动调整' },
};

// ─────────────────────────────────────────────
// 内部：读写账本文件
// ─────────────────────────────────────────────

function _readLedgerRaw() {
  if (!fs.existsSync(LEDGER_PATH)) {
    return _emptyLedger();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    return {
      ..._emptyLedger(),
      ...raw,
      balance: typeof raw.balance === 'number' ? raw.balance : 0,
    };
  } catch {
    return _emptyLedger();
  }
}

function _writeLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  const tmp = LEDGER_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ ...ledger, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, LEDGER_PATH);
}

function _appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch { /* 流水账失败不阻断主流程 */ }
}

function _emptyLedger() {
  return {
    _version:    '1.0',
    _comment:    '本地乐包账本（自动生成）。乐包来自完书、完章、质检通过等行为，用于解锁付费场景包体裁。',
    balance:     0,
    total_earned: 0,
    total_spent:  0,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/**
 * 账本是否已初始化（文件存在且可正常解析）
 * 用于区分「账本余额=0」与「账本尚未建立」两种情况
 * @returns {boolean}
 */
export function isLedgerInitialized() {
  return fs.existsSync(LEDGER_PATH);
}

/**
 * 读取当前乐包余额
 * @returns {number}
 */
export function getBalance() {
  return _readLedgerRaw().balance;
}

/**
 * 读取完整账本
 * @returns {object}
 */
export function readLedger() {
  return _readLedgerRaw();
}

/**
 * 增加乐包
 * @param {string} source  - CREDIT_SOURCES 中的 key，或自定义字符串
 * @param {number} [amount] - 增加量，不传则取 CREDIT_SOURCES[source].amount
 * @param {string} [note]  - 备注（写流水日志）
 * @returns {number} 新余额
 */
export function addCredits(source, amount, note = '') {
  const delta = typeof amount === 'number' ? amount : (CREDIT_SOURCES[source]?.amount ?? 0);
  if (delta <= 0) return getBalance();

  const ledger = _readLedgerRaw();
  ledger.balance      += delta;
  ledger.total_earned += delta;
  _writeLedger(ledger);
  _appendLog({ event: 'add', source, amount: delta, balance_after: ledger.balance, note });

  emitCreditsLog(
    `${C.cyan}[乐包] +${delta} 个乐包 (${CREDIT_SOURCES[source]?.label ?? source}) → ${ledger.balance} 个乐包${C.reset}`,
  );
  return ledger.balance;
}

/**
 * 扣减乐包（用于兑换/解锁场景包）
 * @param {string} source
 * @param {number} amount
 * @param {string} [note]
 * @returns {number} 新余额
 * @throws {Error} 余额不足时抛出（调用方应先用 getBalance() 预检）
 */
export function deductCredits(source, amount, note = '') {
  const delta = typeof amount === 'number' ? Math.abs(amount) : 0;
  if (delta <= 0) return getBalance();

  const ledger = _readLedgerRaw();
  if (ledger.balance < delta) {
    throw new Error(`乐包不足：需要 ${delta} 个，当前余额 ${ledger.balance} 个`);
  }
  ledger.balance     -= delta;
  ledger.total_spent += delta;
  _writeLedger(ledger);
  _appendLog({ event: 'deduct', source, amount: delta, balance_after: ledger.balance, note });

  emitCreditsLog(
    `${C.yellow}[乐包] -${delta} 个乐包 (${CREDIT_SOURCES[source]?.label ?? source}) → ${ledger.balance} 个乐包${C.reset}`,
  );
  return ledger.balance;
}

/**
 * 检查每日首次使用乐包（幂等：同一日历日只加一次）
 * @returns {{ added: boolean, balance: number }}
 */
export function checkDailyLogin() {
  const ledger = _readLedgerRaw();
  const today  = new Date().toISOString().slice(0, 10);
  if (ledger.last_daily_login === today) {
    return { added: false, balance: ledger.balance };
  }
  ledger.last_daily_login = today;
  ledger.balance      += CREDIT_SOURCES.daily_login.amount;
  ledger.total_earned += CREDIT_SOURCES.daily_login.amount;
  _writeLedger(ledger);
  _appendLog({ event: 'add', source: 'daily_login', amount: CREDIT_SOURCES.daily_login.amount, balance_after: ledger.balance });
  emitCreditsLog(
    `${C.cyan}[乐包] 每日首次 +${CREDIT_SOURCES.daily_login.amount} 个乐包 → ${ledger.balance} 个乐包${C.reset}`,
  );
  return { added: true, balance: ledger.balance };
}

/**
 * 首次安装奖励（幂等：账本 first_install_done=true 后不再触发）
 * 送 100 个乐包，帮助新用户感受乐包体系价值。
 * @returns {{ added: boolean, balance: number }}
 */
export function checkFirstInstall() {
  const ledger = _readLedgerRaw();
  if (ledger.first_install_done) {
    return { added: false, balance: ledger.balance };
  }
  ledger.first_install_done = true;
  ledger.balance      += CREDIT_SOURCES.first_install.amount;
  ledger.total_earned += CREDIT_SOURCES.first_install.amount;
  _writeLedger(ledger);
  _appendLog({ event: 'add', source: 'first_install', amount: CREDIT_SOURCES.first_install.amount, balance_after: ledger.balance });
  emitCreditsLog(
    `${C.cyan}[乐包] 🎁 首次安装奖励 +${CREDIT_SOURCES.first_install.amount} 个乐包 → ${ledger.balance} 个${C.reset}`,
  );
  return { added: true, balance: ledger.balance };
}

/**
 * 获取升级提醒（距最近可解锁体裁差距 ≤ 20 时返回提醒文案）
 *
 * @param {object[]} [entitlementSheet] - 远端 sheet 覆盖阈值（可为 null，降级用本地默认）
 * @returns {{
 *   hint: string|null,       // null 表示无需提醒
 *   nearestGenre: string|null,
 *   gap: number,
 *   balance: number,
 *   thresholds: object
 * }}
 */
export function getUpgradeHint(entitlementSheet = null) {
  const balance = getBalance();

  // 合并远端阈值
  const thresholds = { ...GENRE_THRESHOLDS };
  if (Array.isArray(entitlementSheet)) {
    for (const row of entitlementSheet) {
      if (row.genre && typeof row.credits_required === 'number') {
        thresholds[row.genre] = row.credits_required;
      }
    }
  }

  // 找出"还差最少乐包可解锁"的付费体裁
  let nearestGenre = null;
  let minGap       = Infinity;

  for (const [genre, threshold] of Object.entries(thresholds)) {
    if (genre === 'general' || threshold === 0) continue;
    if (balance >= threshold) continue; // 已解锁
    const gap = threshold - balance;
    if (gap < minGap) {
      minGap       = gap;
      nearestGenre = genre;
    }
  }

  if (nearestGenre === null) {
    // 全部已解锁
    return { hint: null, nearestGenre: null, gap: 0, balance, thresholds };
  }

  // 仅在差距 ≤ 20 个乐包时触发提醒
  const HINT_THRESHOLD = 20;
  if (minGap > HINT_THRESHOLD) {
    return { hint: null, nearestGenre, gap: minGap, balance, thresholds };
  }

  const label = _genreLabel(nearestGenre);
  const hint  = `🎉 再积累 ${minGap} 个乐包即可解锁「${label}」场景包！（当前 ${balance} 个乐包，门槛 ${thresholds[nearestGenre]} 个乐包）`;
  return { hint, nearestGenre, gap: minGap, balance, thresholds };
}

/**
 * 熟客增值提醒（无摩擦闭环核心）
 *
 * 触发策略（分级，幂等——同余额区间同日最多提示一次）：
 *   gap ≤ 20   → 即将解锁提醒（标准 getUpgradeHint 已覆盖）
 *   gap ≤ 50   → 熟客中程提醒：再写 N 章可解锁
 *   全部已解锁  → 增值推荐提醒（余额已满足最高门槛，可考虑激活码增强）
 *
 * @param {object[]} [entitlementSheet]
 * @returns {{ level: 'none'|'near'|'mid'|'upsell', message: string|null }}
 */
export function notifyUpgradeIfNeeded(entitlementSheet = null) {
  const balance    = getBalance();
  const thresholds = { ...GENRE_THRESHOLDS };
  if (Array.isArray(entitlementSheet)) {
    for (const row of entitlementSheet) {
      if (row.genre && typeof row.credits_required === 'number') {
        thresholds[row.genre] = row.credits_required;
      }
    }
  }

  // 找最近未解锁体裁
  let nearestGenre = null;
  let minGap       = Infinity;
  for (const [genre, threshold] of Object.entries(thresholds)) {
    if (genre === 'general' || threshold === 0) continue;
    if (balance >= threshold) continue;
    const gap = threshold - balance;
    if (gap < minGap) { minGap = gap; nearestGenre = genre; }
  }

  // 全部已解锁 → 增值推荐
  if (nearestGenre === null) {
    return {
      level:   'upsell',
      message: `🎊 所有场景包体裁均已解锁！如需激活高级定制能力，可使用激活码升级到企业增强版。`,
    };
  }

  const label    = _genreLabel(nearestGenre);
  const chapters = Math.ceil(minGap / CREDIT_SOURCES.chapter_done.amount);  // 还需写几章

  // gap ≤ 20 → 即将解锁（已由 getUpgradeHint 处理，此处保持一致）
  if (minGap <= 20) {
    return {
      level:   'near',
      message: `🎉 再积累 ${minGap} 个乐包即可解锁「${label}」！（当前 ${balance} 个，门槛 ${thresholds[nearestGenre]} 个）`,
    };
  }

  // gap ≤ 50 → 熟客中程提醒
  if (minGap <= 50) {
    return {
      level:   'mid',
      message: `📈 再完成约 ${chapters} 章即可解锁「${label}」场景包（还差 ${minGap} 个乐包，当前 ${balance} 个）`,
    };
  }

  // gap > 50 → 不打扰
  return { level: 'none', message: null };
}

/**
 * 格式化账本摘要（供 NLU CHECK_BALANCE 意图使用）
 * @param {object[]} [entitlementSheet]
 * @returns {string}  Markdown 格式
 */
export function formatBalanceSummary(entitlementSheet = null) {
  const ledger   = readLedger();
  const balance  = ledger.balance;

  // 合并阈值
  const thresholds = { ...GENRE_THRESHOLDS };
  if (Array.isArray(entitlementSheet)) {
    for (const row of entitlementSheet) {
      if (row.genre && typeof row.credits_required === 'number') {
        thresholds[row.genre] = row.credits_required;
      }
    }
  }

  const lines = [`**当前乐包余额：${balance} 个**`, ''];
  lines.push('| 场景包体裁 | 门槛 | 状态 |');
  lines.push('|----------|------|------|');
  for (const [genre, threshold] of Object.entries(thresholds)) {
    if (genre === 'general') continue;
    const label  = _genreLabel(genre);
    const status = balance >= threshold ? '✅ 已解锁' : `🔒 还差 ${threshold - balance} 个乐包`;
    lines.push(`| ${label} | ${threshold} 个乐包 | ${status} |`);
  }

  const { hint } = getUpgradeHint(entitlementSheet);
  if (hint) {
    lines.push('');
    lines.push(`> ${hint}`);
  }

  lines.push('');
  lines.push(`_累计获得 ${ledger.total_earned} 个乐包 · 累计消耗 ${ledger.total_spent} 个乐包_`);
  lines.push('_（首次安装 +100 个乐包 · 完成一章 +10 个乐包 · 完成全书 +50 个乐包 · 每日首次使用 +5 个乐包 · 章节质检通过 +3 个乐包）_');
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// 内部：体裁名称映射
// ─────────────────────────────────────────────

function _genreLabel(genre) {
  const labels = {
    genealogy:       '家谱',
    consultant:      '创业顾问',
    ghostwriter:     '代撰稿',
    whitepaper:      '白皮书',
    report:          '报告',
    training:        '企业培训',
    'personal-book': '个人出书',
    general:         '通用',
  };
  return labels[genre] ?? genre;
}
