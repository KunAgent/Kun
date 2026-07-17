/**
 * scripts/wecom/lib/user-config.mjs
 * 用户个人配置管理（scene-packs/user-config.json）
 *
 * v2.1 变更：写书行为自动触发乐包积累
 *   - registerBook()     首次安装 +100 个乐包（first_install，幂等）；每次调用检查每日首次乐包
 *   - markChapterDone()  完成一章时 +10 个乐包（chapter_done）
 *   - markBookComplete() 完成整书时 +50 个乐包（book_complete）
 *   - markQualityPass()  章节质检通过 +3 个乐包（quality_pass）
 *
 * v2.0 职责：
 *   - 维护本机书的注册表（bookRoot → title / genre / createdAt）
 *   - 可选记录企微 userid（仅供离线识别，非写入凭证）
 *   - 提供 listBooks() 供管理命令展示
 *
 * 文件位置：scene-packs/user-config.json（与 enterprise.json 同目录）
 * 安全性：此文件已在 .gitignore 中排除（不含密钥，但含本机路径信息）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveWecomDataPaths } from './utils.mjs';
import { addCredits, checkDailyLogin, checkFirstInstall, getUpgradeHint } from './credits-ledger.mjs';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const { scenePacksDir } = resolveWecomDataPaths(ROOT);
const USER_CONFIG_PATH = path.join(scenePacksDir, 'user-config.json');
const MAX_USER_BOOKS = Number(process.env.FBS_USER_CONFIG_MAX_BOOKS || 300);


// ─────────────────────────────────────────────
// 数据结构
// ─────────────────────────────────────────────

/**
 * @typedef {object} BookRecord
 * @property {string}      bookRoot   - 书的根目录（绝对路径）
 * @property {string}      title      - 书名
 * @property {string|null} docUrl     - 主文档 URL（null=本地模式）
 * @property {string|null} docId      - 主文档 ID
 * @property {string}      genre      - 体裁
 * @property {string}      createdAt  - 创建时间 ISO8601
 * @property {string}      updatedAt  - 最后更新时间 ISO8601
 */

/**
 * @typedef {object} UserConfig
 * @property {string}       _version      - 配置格式版本
 * @property {string}       wecom_userid  - 企业微信 userid（空字符串=未登录）
 * @property {string}       wecom_corp_id - 用户所在的企业微信 corp_id（空字符串=未知）
 * @property {BookRecord[]} books         - 用户所有书的注册表
 */

// ─────────────────────────────────────────────
// 读写
// ─────────────────────────────────────────────

/**
 * 读取 user-config.json（不存在时返回默认空结构）
 * @returns {UserConfig}
 */
export function loadUserConfig() {
  if (!fs.existsSync(USER_CONFIG_PATH)) {
    return _emptyConfig();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
    // 向后兼容：确保 books 字段存在
    return { ...(_emptyConfig()), ...raw, books: raw.books ?? [] };
  } catch {
    return _emptyConfig();
  }
}

/**
 * 保存 user-config.json（原子写入）
 * @param {UserConfig} config
 */
export function saveUserConfig(config) {
  fs.mkdirSync(path.dirname(USER_CONFIG_PATH), { recursive: true });
  const normalized = normalizeUserConfig(config);
  const tmp = USER_CONFIG_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmp, USER_CONFIG_PATH);
}

// ─────────────────────────────────────────────
// 书记录管理
// ─────────────────────────────────────────────

/**
 * 注册或更新一本书的记录
 * 按 bookRoot 去重：已有记录则更新 docUrl/title/updatedAt，否则追加
 *
 * @param {string}      bookRoot
 * @param {string}      title
 * @param {string|null} docUrl
 * @param {string|null} docId
 * @param {string}      genre
 */
export function registerBook(bookRoot, title, docUrl, docId, genre) {
  const config  = loadUserConfig();
  const absRoot = path.resolve(bookRoot);
  const now     = new Date().toISOString();

  const existing = config.books.findIndex(b => path.resolve(b.bookRoot) === absRoot);
  const isNew    = existing < 0;

  const record = {
    bookRoot:  absRoot,
    title,
    docUrl:    docUrl ?? null,
    docId:     docId  ?? null,
    genre:     genre  ?? 'general',
    createdAt: isNew ? now : config.books[existing].createdAt,
    updatedAt: now,
  };

  if (!isNew) {
    config.books[existing] = record;
  } else {
    config.books.push(record);
  }

  saveUserConfig(config);

  // 首次安装奖励（全局幂等：账本 first_install_done 标记保护）
  checkFirstInstall();

  // 每日首次使用乐包（幂等，同一日只加一次）
  // 注意：不限于新书，每次 registerBook 均检查（无论新建还是更新），确保老用户也能积累每日乐包
  checkDailyLogin();
}

// ─────────────────────────────────────────────
// 乐包触发：写书行为
// ─────────────────────────────────────────────

/**
 * 完成一章 → +10 个乐包，并检查升级提醒
 * @param {string} bookRoot
 * @param {string} [chapterTitle]
 * @param {object[]} [entitlementSheet]
 * @returns {{ balance: number, upgradeHint: string|null }}
 */
export function markChapterDone(bookRoot, chapterTitle = '', entitlementSheet = null) {
  const balance = addCredits('chapter_done', undefined, chapterTitle ? `章节：${chapterTitle}` : '');
  const { hint } = getUpgradeHint(entitlementSheet);
  return { balance, upgradeHint: hint };
}

/**
 * 完成整本书 → +50 个乐包，并检查升级提醒
 * @param {string} bookRoot
 * @param {string} [bookTitle]
 * @param {object[]} [entitlementSheet]
 * @returns {{ balance: number, upgradeHint: string|null }}
 */
export function markBookComplete(bookRoot, bookTitle = '', entitlementSheet = null) {
  const balance = addCredits('book_complete', undefined, bookTitle ? `书名：${bookTitle}` : '');
  const { hint } = getUpgradeHint(entitlementSheet);
  return { balance, upgradeHint: hint };
}

/**
 * 章节质检通过 → +3 个乐包
 * @param {string} bookRoot
 * @param {string} [chapterTitle]
 * @returns {{ balance: number }}
 */
export function markQualityPass(bookRoot, chapterTitle = '') {
  const balance = addCredits('quality_pass', undefined, chapterTitle ? `质检：${chapterTitle}` : '');
  return { balance };
}

/**
 * 完成 S6 转化 → +12 个乐包，并检查升级提醒
 * @param {string} bookRoot
 * @param {string} [chapterTitle]
 * @param {object[]} [entitlementSheet]
 * @returns {{ balance: number, upgradeHint: string|null }}
 */
export function markS6Transform(bookRoot, chapterTitle = '', entitlementSheet = null) {
  const balance = addCredits('s6_transform', undefined, chapterTitle ? `S6转化：${chapterTitle}` : '');
  const { hint } = getUpgradeHint(entitlementSheet);
  return { balance, upgradeHint: hint };
}

/**
 * 写入发布映射 → +8 个乐包，并检查升级提醒
 * @param {string} bookRoot
 * @param {string} [title]
 * @param {object[]} [entitlementSheet]
 * @returns {{ balance: number, upgradeHint: string|null }}
 */
export function markReleaseReady(bookRoot, title = '', entitlementSheet = null) {
  const balance = addCredits('release_ready', undefined, title ? `发布映射：${title}` : '');
  const { hint } = getUpgradeHint(entitlementSheet);
  return { balance, upgradeHint: hint };
}

/**
 * 更新某本书的 docUrl / docId（用于 wecom 模式创文档完成后回写）
 * @param {string}      bookRoot
 * @param {string|null} docUrl
 * @param {string|null} docId
 */
export function updateBookDoc(bookRoot, docUrl, docId) {
  const config  = loadUserConfig();
  const absRoot = path.resolve(bookRoot);
  const idx     = config.books.findIndex(b => path.resolve(b.bookRoot) === absRoot);
  if (idx < 0) return; // 未注册，跳过（不强制写）
  config.books[idx].docUrl    = docUrl ?? config.books[idx].docUrl;
  config.books[idx].docId     = docId  ?? config.books[idx].docId;
  config.books[idx].updatedAt = new Date().toISOString();
  saveUserConfig(config);
}

/**
 * 列出用户所有书（按 updatedAt 倒序）
 * @returns {BookRecord[]}
 */
export function listBooks() {
  const config = loadUserConfig();
  return [...config.books].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

// ─────────────────────────────────────────────
// 用户身份写入
// ─────────────────────────────────────────────

/**
 * 写入用户的企业微信 userid 和 corp_id
 * 已有相同值时跳过（避免无谓写文件）
 *
 * @param {string} userid
 * @param {string} [corpId]
 */
export function setWecomUserId(userid, corpId) {
  const config = loadUserConfig();
  let changed  = false;

  if (userid && config.wecom_userid !== userid) {
    config.wecom_userid = userid;
    changed = true;
  }
  if (corpId && config.wecom_corp_id !== corpId) {
    config.wecom_corp_id = corpId;
    changed = true;
  }

  if (changed) saveUserConfig(config);
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function _emptyConfig() {
  return {
    _version:      '2.0',
    _comment:      '用户个人配置（自动生成，勿手动编辑 books 数组）。此文件不含密钥，但含本机路径信息，已加入 .gitignore。',
    wecom_userid:  '',
    wecom_corp_id: '',
    books:         [],
  };
}

function normalizeUserConfig(config) {
  const base = { ..._emptyConfig(), ...(config || {}) };
  const books = Array.isArray(base.books) ? base.books : [];

  // 按 bookRoot 去重（保留 updatedAt 最新的一条）
  const byRoot = new Map();
  for (const item of books) {
    const root = String(item?.bookRoot || "").trim();
    if (!root) continue;
    const key = path.resolve(root);
    const prev = byRoot.get(key);
    if (!prev) {
      byRoot.set(key, item);
      continue;
    }
    const tPrev = Date.parse(String(prev.updatedAt || "")) || 0;
    const tCurr = Date.parse(String(item.updatedAt || "")) || 0;
    if (tCurr >= tPrev) byRoot.set(key, item);
  }

  // 防膨胀：默认仅保留最近 N 本，避免本地配置无限增长拖慢审计与读取。
  const deduped = [...byRoot.values()].sort(
    (a, b) => (Date.parse(String(b.updatedAt || "")) || 0) - (Date.parse(String(a.updatedAt || "")) || 0),
  );
  const cap = Number.isFinite(MAX_USER_BOOKS) && MAX_USER_BOOKS > 0 ? MAX_USER_BOOKS : 300;
  base.books = deduped.slice(0, cap);
  return base;
}
