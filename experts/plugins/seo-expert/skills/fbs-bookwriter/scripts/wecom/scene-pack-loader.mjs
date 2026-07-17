#!/usr/bin/env node
/**
 * scripts/wecom/scene-pack-loader.mjs
 * 场景包规则加载（v2.0）
 *
 * v2.0 定位：企微智能表格为只读配置载体（企微→FBS 方向），书稿落本地磁盘。
 * 场景包规则通过四级降级路径加载，不依赖企微凭证写入。
 *
 * 四级降级路径（§5.3 C2）：
 *   1   → disk_cache    书内 scenePackCache（.fbs-wecom-state.json）
 *   1.5 → offline_cache 全局离线缓存（scene-packs/.offline-cache/{genre}.json）
 *   2   → local_rule    内置规范文件（references/scene-packs/{genre}.md）
 *   3   → no_pack       无可用场景包；会写入状态文件并由 S3 门禁阻断
 *
 * 降级时：不更新 scenePackCache（保留上次成功缓存），写审计日志 scene_pack_fallback

 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WecomError, resolveBookRoot, appendAuditLog, resolveWecomDataPaths, C,
} from './lib/utils.mjs';

import { wecomRun } from './wecom-client.mjs';
import {
  parseQualitySheet,
  parseOutlineSheet,
  parseSearchSheet,
  parseInitSheet,
  parseVisualSheet,
  parseEntitlementSheet,
  mergeScenePack,
  filterByGenreAndStage,
  formatPackAsMarkdown,
} from './lib/scene-pack-schema.mjs';
import {
  checkEntitlement,
  loadCorpConfig,
} from './lib/entitlement.mjs';
import {
  registerBook,
  markChapterDone,
  markBookComplete,
  markQualityPass,
} from './lib/user-config.mjs';
import { notifyUpgradeIfNeeded } from './lib/credits-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const { scenePacksDir, referencesScenePacksDir } = resolveWecomDataPaths(ROOT);

const REGISTRY_PATH     = path.join(scenePacksDir, 'registry.json');
const OFFLINE_CACHE_DIR = path.join(scenePacksDir, '.offline-cache');
const LOCAL_RULES_DIR   = referencesScenePacksDir;

const STATE_FILE        = '.fbs-wecom-state.json';
const SCENE_PACK_STATUS_FILE = path.join('.fbs', 'scene-pack-status.json');

export function normalizeScenePackGenreAlias(input) {
  const raw = String(input || "").trim();
  if (!raw) return "general";
  const k = raw.toLowerCase();
  const map = {
    general: "general",
    "通用": "general",
    whitepaper: "whitepaper",
    "白皮书": "whitepaper",
    report: "report",
    "报告": "report",
    "深度报道": "report",
    consultant: "consultant",
    "顾问": "consultant",
    training: "training",
    "培训": "training",
    genealogy: "genealogy",
    "家谱": "genealogy",
    ghostwriter: "ghostwriter",
    "代撰": "ghostwriter",
    "代写": "ghostwriter",
    "代笔": "ghostwriter",
    "personal-book": "personal-book",
    personal_book: "personal-book",
    personalbook: "personal-book",
    "个人书": "personal-book",
  };
  return map[k] || map[raw] || k;
}


/** 书内磁盘缓存 TTL：读取 _plugin_meta.json.scene_packs.update_check_interval_hours，默认 24h（R6）
 *  FIX-P1-03: 原为硬编码 24*60*60*1000，现从配置文件读取，允许运营侧灵活调整热更新频率。
 */
const CACHE_TTL_MS = _readCacheTTL();

function _readCacheTTL() {
  try {
    const metaPath = path.join(ROOT, '_plugin_meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const hours = meta?.scene_packs?.update_check_interval_hours;
      if (typeof hours === 'number' && hours > 0) {
        return hours * 60 * 60 * 1000;
      }
    }
  } catch { /* 读取失败降级使用默认值 */ }
  return 24 * 60 * 60 * 1000; // 默认 24h
}

/** 增值体裁是否强制在线验证（默认开启：防薅羊毛） */
const PREMIUM_ONLINE_REQUIRED = process.env.FBS_PREMIUM_ONLINE_REQUIRED !== '0';

// ─────────────────────────────────────────────
// loadScenePack（主入口）
// ─────────────────────────────────────────────

/**
 * 拉取指定体裁的场景包，返回结构化多 Sheet 数据
 *
 * 调用方可通过 formatPackAsMarkdown(result, meta) 注入模型上下文。
 *
 * @param {string}      bookRoot - 书籍根目录（规范化路径）
 * @param {string}      genre    - 目标体裁（VALID_GENRES 之一）
 * @param {string|null} stage    - 阶段过滤（null=全量；outline 始终全量）
 * @returns {Promise<{
 *   data: { quality, outline, search, init, visual },
 *   meta: { genre, label, version, cachedAt, degraded, degradeReason }
 * }>}
 */
export async function loadScenePack(bookRoot, genre, stage = null) {
  const resolved = resolveBookRoot(bookRoot);
  const requestedGenre = genre;
  genre = normalizeScenePackGenreAlias(genre);

  // ── 安全：genre 白名单校验（防路径穿越）──────────

  const { VALID_GENRES } = await import('./lib/scene-pack-schema.mjs');
  if (!VALID_GENRES.includes(genre)) {
    process.stderr.write(
      `${C.yellow}[scene-pack] 无效 genre：${JSON.stringify(requestedGenre)}，降级→general${C.reset}\n`
    );
    genre = 'general';
  }

  // ── 乐包埋点①：registerBook（必经路径，幂等）──────
  // 每次加载场景包时触发：初始化账本（首次+100）+ 每日乐包（+5/日）
  // 离线/降级时同样触发，不阻断写书流程
  try {
    const _s  = _readState(resolved);
    registerBook(resolved, _s?.title ?? path.basename(resolved),
                 _s?.docUrl ?? null, _s?.docId ?? null, genre);
  } catch { /* 乐包积累失败不阻断 */ }

  // ── 步骤 1：读取注册表 + 企业配置 ───────────────
  const registry   = _loadRegistry();
  const corpConfig = loadCorpConfig();
  if (registry?._version && !registry._version.startsWith('2.')) {
    process.stderr.write(`${C.yellow}[scene-pack] registry 版本不匹配（${registry._version}），已降级本地规则${C.reset}\n`);
    return _degradeToLocal(resolved, genre, stage, `registry_version_mismatch:${registry._version}`);
  }


  // ── 步骤 2：权益检查（R1/R7） ──────────────────
  // 先做本地预检（无远端 entitlement sheet）
  const entitlementPreview = await checkEntitlement(genre, corpConfig, null, resolved);
  let effectiveGenre = entitlementPreview.genre;   // 可能降级为 'general'
  if (!entitlementPreview.allowed) {
    process.stderr.write(
      `${C.gray}[scene-pack] 体裁降级（预检）：${genre} → ${effectiveGenre}（${entitlementPreview.mode}）${C.reset}\n`
    );
  }

  // ── 步骤 3：查找注册表条目 ─────────────────────
  let packMeta = registry.packs?.[effectiveGenre] ?? registry.packs?.[registry.fallback_pack];
  if (!packMeta) {
    _writeFallbackAudit(resolved, 3, 'no_pack', effectiveGenre);
    const result = _noPackResult(effectiveGenre);
    _recordScenePackStatus(resolved, {
      requestedGenre,
      resolvedGenre: effectiveGenre,
      stage,
      source: 'no_pack',
      result,
    });

    return result;
  }


  // FIX-P1-01: 检测 PENDING 状态的 sheet_ids（服务端尚未注册），自动降级到本地规范
  const sheetIds = packMeta.sheet_ids ?? {};
  const hasPendingIds = Object.values(sheetIds).some(id => typeof id === 'string' && id.toUpperCase().includes('_PENDING'));
  if (hasPendingIds) {
    process.stderr.write(
      `${C.yellow}[scene-pack] ${effectiveGenre} 场景包服务端尚未注册（sheet_ids 含 PENDING 标记），降级→本地规范${C.reset}\n`
    );
    return _degradeToLocal(resolved, effectiveGenre, stage, 'sheet_ids_pending_registration');
  }

  // 优先用 url（智能表格 API 要求），回退到 id
  const officialSpreadsheetId = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  if (!officialSpreadsheetId) {
    if (_mustOnlineVerifyPremium(effectiveGenre)) {
      process.stderr.write(
        `${C.yellow}[scene-pack] 增值体裁需在线验证，当前未配置官方表格，降级→general${C.reset}\n`
      );
      return _degradeToLocal(resolved, 'general', stage, 'premium_online_verification_required');
    }
    return _degradeToLocal(resolved, effectiveGenre, stage, 'official_spreadsheet_id/url 未配置');
  }

  // ── 步骤 4：检查书内磁盘缓存（TTL=1天） ────────
  const state = _readState(resolved);
  const diskCache = state?.scenePackCache;
  if (
    !_mustOnlineVerifyPremium(effectiveGenre) &&
    diskCache &&
    diskCache.genre === effectiveGenre &&
    _isCacheValid(diskCache) &&
    !_needsVersionRefresh(diskCache, packMeta)
  ) {
    process.stderr.write(
      `${C.gray}[scene-pack] 使用书内磁盘缓存（${effectiveGenre}）${C.reset}\n`
    );
    return _resultFromCache(diskCache, effectiveGenre, packMeta, stage);
  }

  // ── 步骤 5：从远端拉取官方表格（7 张 Sheet） ───
  let officialSheets;
  try {
    officialSheets = await _fetchAllSheets(officialSpreadsheetId, packMeta, state, false);
  } catch (err) {
    process.stderr.write(
      `${C.yellow}[scene-pack] 官方表格暂不可用，已切换到本地/离线规则（本地模式下文稿与质检流程仍可用）。详情：${err.message}${C.reset}\n`
    );
    if (_mustOnlineVerifyPremium(effectiveGenre)) {
      process.stderr.write(
        `${C.yellow}[scene-pack] 增值体裁需在线验证，离线不可用，降级→general${C.reset}\n`
      );
      return _degradeToLocal(resolved, 'general', stage, 'premium_online_verification_required');
    }
    return _fallback(resolved, effectiveGenre, stage, 1, 'remote_error');
  }

  // 使用远端 entitlement sheet 二次校验（优先级高于本地默认阈值）
  const entitlementVerified = await checkEntitlement(genre, corpConfig, officialSheets.entitlement, resolved);
  if (entitlementVerified.genre !== effectiveGenre) {
    effectiveGenre = entitlementVerified.genre;
    packMeta = registry.packs?.[effectiveGenre] ?? registry.packs?.[registry.fallback_pack] ?? packMeta;
    process.stderr.write(
      `${C.gray}[scene-pack] 体裁降级（远端校验）：${genre} → ${effectiveGenre}（${entitlementVerified.mode}）${C.reset}\n`
    );
    if (effectiveGenre !== entitlementPreview.genre) {
      try {
        officialSheets = await _fetchAllSheets(officialSpreadsheetId, packMeta, state, false);
      } catch (err) {
        process.stderr.write(
          `${C.yellow}[scene-pack] 降级体裁重拉失败（${err.message}），使用当前数据继续${C.reset}\n`
        );
      }
    }
  }


  // ── 步骤 6：版本号校验（强制刷新） ─────────────
  const remoteVersion = officialSheets.meta?.version;
  if (remoteVersion && diskCache?.version && remoteVersion !== diskCache.version) {
    process.stderr.write(
      `${C.cyan}[scene-pack] 版本变更（${diskCache.version}→${remoteVersion}），强制刷新${C.reset}\n`
    );
  }

  // ── 步骤 7：拉取企业覆盖文档（主从合并） ────────
  let corpSheets = null;
  const corpSpreadsheetId = corpConfig?.corp_spreadsheet_url ?? corpConfig?.corp_spreadsheet_id;
  const corpSheetIds      = corpConfig?.packs?.[effectiveGenre]?.corp_sheet_ids;
  if (corpSpreadsheetId && corpSheetIds && Object.keys(corpSheetIds).length > 0) {
    try {
      const corpPackMeta = { ...packMeta, sheet_ids: { ...packMeta.sheet_ids, ...corpSheetIds } };
      corpSheets = await _fetchAllSheets(corpSpreadsheetId, corpPackMeta, state, true);
      process.stderr.write(
        `${C.cyan}[scene-pack] 企业覆盖文档已拉取（${effectiveGenre}，` +
        `sheets: ${Object.keys(corpSheetIds).join('/')}）${C.reset}\n`
      );
    } catch (err) {
      process.stderr.write(
        `${C.yellow}[scene-pack] 企业覆盖表暂不可用，已仅用官方/本地数据（本地模式正常）。详情：${err.message}${C.reset}\n`
      );
    }
  }

  // ── 步骤 8：主从合并 ────────────────────────────
  const merged = mergeScenePack(officialSheets, corpSheets, corpConfig, resolved);

  // ── 步骤 9：体裁+阶段过滤（outline 全量） ───────
  const filtered = filterByGenreAndStage(merged, effectiveGenre, stage);

  // ── 步骤 10：更新书内磁盘缓存 ───────────────────
  const now = new Date().toISOString();
  _updateStateCache(resolved, state, effectiveGenre, filtered, remoteVersion ?? packMeta.schema_version, now);

  const meta = {
    genre:     effectiveGenre,
    label:     packMeta.label ?? effectiveGenre,
    version:   remoteVersion ?? packMeta.schema_version ?? 'N/A',
    cachedAt:  now,
    degraded:  false,
  };

  // ── 乐包埋点②：熟客升级提醒（加载完成后输出，不阻断）──
  // 离线模式下同样有效：乐包账本纯本地，无需联网
  try {
    const upgradeNotify = notifyUpgradeIfNeeded(officialSheets?.entitlement ?? null);
    if (upgradeNotify.message) {
      process.stderr.write(`${C.cyan}[乐包] ${upgradeNotify.message}${C.reset}\n`);
    }
  } catch { /* 提醒失败不阻断 */ }

  const result = { data: filtered, meta };
  _recordScenePackStatus(resolved, {
    requestedGenre,
    resolvedGenre: effectiveGenre,
    stage,
    source: 'remote',
    result,
  });

  return result;
}


// ─────────────────────────────────────────────
// formatPackForContext（向后兼容旧调用方）
// ─────────────────────────────────────────────

/**
 * 格式化场景包条目为可注入 Markdown 字符串（向后兼容接口）
 * 新代码请直接调用 formatPackAsMarkdown（来自 scene-pack-schema.mjs）
 *
 * @param {object} result   - loadScenePack 返回值 { data, meta }
 * @returns {string}
 */
export function formatPackForContext(result) {
  if (!result?.data) return '';
  return formatPackAsMarkdown(result.data, result.meta);
}

// ─────────────────────────────────────────────
// notifyBookEvent（写书阶段埋点公开 API）
// ─────────────────────────────────────────────

/**
 * 写书阶段乐包埋点入口
 *
 * AI 助手在写书流程的关键节点调用此函数，触发对应乐包奖励并输出熟客提醒。
 * 所有操作纯本地、不依赖网络，失败时静默忽略，不阻断写书流程。
 *
 * 埋点时机（最小化原则）：
 *   'chapter_done'   — 一章内容写完并输出时
 *   'quality_pass'   — 章节质检全部通过时
 *   'book_complete'  — 整本书所有章节写完时
 *
 * @param {string} bookRoot        - 书籍根目录
 * @param {'chapter_done'|'quality_pass'|'book_complete'} event - 事件类型
 * @param {object} [opts]
 * @param {string} [opts.title]    - 章节或书名（用于流水日志）
 * @param {object[]} [opts.entitlementSheet] - 远端 entitlement sheet（可选，用于精确提醒）
 * @returns {{ balance: number, upgradeHint: string|null, notify: object }}
 */
export function notifyBookEvent(bookRoot, event, opts = {}) {
  try {
    const resolved = resolveBookRoot(bookRoot);
    const { title = '', entitlementSheet = null } = opts;
    let result = { balance: 0, upgradeHint: null };

    if (event === 'chapter_done') {
      result = markChapterDone(resolved, title, entitlementSheet);
    } else if (event === 'quality_pass') {
      result = markQualityPass(resolved, title);
    } else if (event === 'book_complete') {
      result = markBookComplete(resolved, title, entitlementSheet);
    } else if (event === 's6_transform') {
      result = markS6Transform(resolved, title, entitlementSheet);
    } else if (event === 'release_ready') {
      result = markReleaseReady(resolved, title, entitlementSheet);
    }

    // 熟客提醒：每次写书事件后检查
    const notify = notifyUpgradeIfNeeded(entitlementSheet);
    if (notify.message) {
      process.stderr.write(`${C.cyan}[乐包] ${notify.message}${C.reset}\n`);
    }
    return { ...result, notify };
  } catch {
    return { balance: 0, upgradeHint: null, notify: { level: 'none', message: null } };
  }
}

// ─────────────────────────────────────────────
// pingScenePackTable（§7.3，wecom:ping 诊断）
// ─────────────────────────────────────────────

export async function pingScenePackTable() {
  const registry = _loadRegistry();
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  const firstPack = Object.values(registry.packs ?? {})[0];
  const sheetId = firstPack?.sheet_ids?.quality ?? firstPack?.sheet_id;
  if (!spreadsheet || !sheetId) {
    throw new WecomError('BIZ_PING_NO_CONFIG', '注册表未配置 official_spreadsheet_url 或 sheet_id');
  }
  const isUrl = spreadsheet.startsWith('http');
  await wecomRun('doc', 'smartsheet_get_records',
    { ...(isUrl ? { url: spreadsheet } : { docid: spreadsheet }), sheet_id: sheetId, with_record_field_data: true, limit: 1 }
  );
}

// ─────────────────────────────────────────────
// syncAllPacks（预缓存全部场景包到 offline-cache）
// ─────────────────────────────────────────────

/**
 * 批量拉取所有 pack 写入 .offline-cache/{genre}.json（全局离线缓存）
 * 用于管理员预热缓存；网络不可用时 warn + exit(0)
 */
export async function syncAllPacks() {
  const registry = _loadRegistry();
  const corpConfig = loadCorpConfig();
  fs.mkdirSync(OFFLINE_CACHE_DIR, { recursive: true });
  const failedGenres = [];

  for (const [genre, packMeta] of Object.entries(registry.packs ?? {})) {
    process.stderr.write(`${C.cyan}[wecom:sync-packs] 同步 ${genre}…${C.reset}\n`);
    try {
      const officialSheets = await _fetchAllSheets(
        registry.official_spreadsheet_url ?? registry.official_spreadsheet_id, packMeta, null, false
      );
      let corpSheets = null;
      const corpUrl      = corpConfig?.corp_spreadsheet_url ?? corpConfig?.corp_spreadsheet_id;
      const corpSheetIds = corpConfig?.packs?.[genre]?.corp_sheet_ids;
      if (corpUrl && corpSheetIds && Object.keys(corpSheetIds).length > 0) {
        const corpPackMeta = { ...packMeta, sheet_ids: { ...packMeta.sheet_ids, ...corpSheetIds } };
        corpSheets = await _fetchAllSheets(corpUrl, corpPackMeta, null, true).catch(() => null);
      }

      const merged   = mergeScenePack(officialSheets, corpSheets, corpConfig, null);
      const filtered = filterByGenreAndStage(merged, genre, null);

      const cacheFile = path.join(OFFLINE_CACHE_DIR, `${genre}.json`);
      fs.writeFileSync(cacheFile, JSON.stringify({
        genre,
        cachedAt: new Date().toISOString(),
        version:  officialSheets.meta?.version ?? packMeta.schema_version,
        data: filtered,
      }, null, 2), 'utf8');

      const totalItems = Object.values(filtered).reduce((s, arr) => s + (arr?.length ?? 0), 0);
      process.stderr.write(`${C.green}  ✅ ${genre}：${totalItems} 条，写入 ${cacheFile}${C.reset}\n`);
    } catch (err) {
      if (err instanceof WecomError && err.code.startsWith('NET_')) {
        process.stderr.write(
          `${C.yellow}[wecom:sync-packs] 网络不可用，跳过同步（${err.code}）${C.reset}\n`
        );
        // 不立即 exit，继续尝试其他 genre（使用离线降级路径）
        failedGenres.push(genre);
        continue;
      }
      process.stderr.write(`${C.yellow}  ⚠️  ${genre} 同步失败：${err.message}${C.reset}\n`);
      failedGenres.push(genre);
    }
  }
  if (failedGenres.length > 0) {
    process.stderr.write(
      `${C.yellow}[wecom:sync-packs] ${failedGenres.length} 个体裁同步失败：${failedGenres.join(', ')}${C.reset}\n`
    );
    process.exit(1);
  }
  process.stderr.write(`${C.green}[wecom:sync-packs] 全部同步完成${C.reset}\n`);
}

// ─────────────────────────────────────────────
// 内部：拉取全部 Sheet
// ─────────────────────────────────────────────

/**
 * 从指定表格拉取 7 张 Sheet（按 packMeta.sheet_ids 映射）
 * @returns {{ meta, quality, outline, search, init, visual, entitlement }}
 */
async function _fetchAllSheets(spreadsheetIdOrUrl, packMeta, state, isCorp) {
  const sheetIds = packMeta.sheet_ids ?? {};

  // 支持 url 或 docid 两种方式（优先 url，智能表格 API 用 url 更可靠）
  const isUrl  = spreadsheetIdOrUrl?.startsWith('http');
  const param  = isUrl ? { url: spreadsheetIdOrUrl } : { docid: spreadsheetIdOrUrl };

  /**
   * 拉取单张 Sheet 的 records，sheetId 为空时返回 []
   */
  async function fetchSheet(sheetId) {
    if (!sheetId) return [];
    const inner = await wecomRun(
      'doc', 'smartsheet_get_records',
      {
        ...param,
        sheet_id:               sheetId,
        with_record_field_data: true,
        limit:                  1000,
      },
      {
        sessionId: state?.session_id?.slice(0, 8),
        source:    isCorp ? 'corp' : 'official',
      }
    );
    return inner?.records ?? [];
  }

  // 并行拉取各 Sheet
  const [
    metaRec,
    qualityRec,
    outlineRec,
    searchRec,
    initRec,
    visualRec,
    entitlementRec,
  ] = await Promise.all([
    fetchSheet(sheetIds.meta),
    fetchSheet(sheetIds.quality),
    fetchSheet(sheetIds.outline),
    fetchSheet(sheetIds.search),
    fetchSheet(sheetIds.init),
    fetchSheet(sheetIds.visual),
    fetchSheet(sheetIds.entitlement),
  ]);

  // 解析 meta（取第一条）
  // wecom-cli 0.1.4: get_records 只在 record.values 返回 checkbox，文本字段为空。
  // meta 文本字段（version/label 等）通过 push 时写入 offline_cache，
  // 此处仅尝试读取 checkbox，文本字段在 syncAllPacks 中从 offline_cache 补充。
  const metaValues = metaRec[0]?.values ?? {};
  const metaFields = metaRec[0]?.fields ?? {};
  const metaVal    = k => metaValues[k] ?? metaFields[k]?.value ?? metaFields[k] ?? null;
  const meta = {
    version:    metaVal('version'),
    label:      metaVal('label'),
    genre:      metaVal('genre'),
    updated_at: metaVal('updated_at'),
  };

  return {
    meta,
    quality:     parseQualitySheet(qualityRec),
    outline:     parseOutlineSheet(outlineRec),
    search:      parseSearchSheet(searchRec),
    init:        parseInitSheet(initRec),
    visual:      parseVisualSheet(visualRec),
    entitlement: parseEntitlementSheet(entitlementRec),
  };
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function _mustOnlineVerifyPremium(genre) {
  return PREMIUM_ONLINE_REQUIRED && genre !== 'general';
}

function _loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function _readState(bookRoot) {
  const stateFile = path.join(bookRoot, STATE_FILE);
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

/** 检查 TTL（R6：1天） */
function _isCacheValid(cache) {
  if (!cache?.cachedAt) return false;
  return Date.now() - new Date(cache.cachedAt).getTime() < CACHE_TTL_MS;
}

/** 检查版本号是否需要强制刷新（L1 策略） */
function _needsVersionRefresh(diskCache, packMeta) {
  // 注册表内有明确版本，且与缓存不符时强制刷新
  const registryVersion = packMeta?.schema_version;
  if (registryVersion && diskCache?.version && registryVersion !== diskCache.version) {
    return true;
  }
  return false;
}

function _updateStateCache(bookRoot, state, genre, filtered, version, now) {
  const stateFile = path.join(bookRoot, STATE_FILE);
  const updated = {
    ...(state ?? {}),
    scenePackCache: {
      genre,
      version,
      cachedAt: now,
      data: filtered,
    },
  };
  fs.writeFileSync(stateFile, JSON.stringify(updated, null, 2), 'utf8');
}

function _countEntries(data) {
  return Object.fromEntries(
    Object.entries(data || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
  );
}

function _writeScenePackStatus(bookRoot, status) {
  if (!bookRoot) return null;
  try {
    const statusPath = path.join(bookRoot, SCENE_PACK_STATUS_FILE);
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
    return statusPath;
  } catch {
    return null;
  }
}

function _recordScenePackStatus(bookRoot, {
  requestedGenre,
  resolvedGenre,
  stage,
  source,
  result,
}) {
  return _writeScenePackStatus(bookRoot, {
    $schema: 'fbs-scene-pack-status-v1',
    requestedGenre,
    resolvedGenre,
    stage: stage || 'ALL',
    source,
    readyForS3: source !== 'no_pack',
    degraded: !!result?.meta?.degraded,
    degradeReason: result?.meta?.degradeReason || null,
    version: result?.meta?.version || null,
    cachedAt: result?.meta?.cachedAt || null,
    userNotice: result?.meta?.userNotice || null,
    entryCounts: _countEntries(result?.data),
    updatedAt: new Date().toISOString(),
  });
}

/** 从缓存构造返回值 */
function _resultFromCache(diskCache, genre, packMeta, stage) {

  // 缓存可能是 v2 格式（含 data 字段）或 v1 格式（含 entries）
  let data = diskCache.data;
  if (!data && Array.isArray(diskCache.entries)) {
    // v1 缓存兼容：包装为 quality 数组
    data = { quality: diskCache.entries, outline: [], search: [], init: [], visual: [] };
  }
  if (stage && data) {
    // quality/search 阶段过滤（outline 全量）
    const matchStage = item => !stage || !item.stage || item.stage === stage || item.stage === 'ALL';
    data = {
      ...data,
      quality: (data.quality ?? []).filter(matchStage),
      search:  (data.search  ?? []).filter(matchStage),
    };
  }
  return {
    data: data ?? { quality: [], outline: [], search: [], init: [], visual: [] },
    meta: {
      genre,
      label:    packMeta.label ?? genre,
      version:  diskCache.version ?? 'cached',
      cachedAt: diskCache.cachedAt,
      degraded: false,
    },
  };
}

/** 四级降级路由 */
async function _fallback(bookRoot, genre, stage, startLevel, reason) {
  // 级别 1：书内磁盘缓存（不校验 TTL，只要有就用）
  if (startLevel <= 1) {
    const state    = _readState(bookRoot);
    const cache    = state?.scenePackCache;
    if (cache && cache.genre === genre && (cache.data || cache.entries)) {
      _writeFallbackAudit(bookRoot, 1, 'disk_cache', genre);
      process.stderr.write(`${C.yellow}[scene-pack] 降级→磁盘缓存（${genre}）${C.reset}\n`);
      const result = _resultFromCache(cache, genre, {}, stage);
      _recordScenePackStatus(bookRoot, {
        requestedGenre: genre,
        resolvedGenre: genre,
        stage,
        source: 'disk_cache',
        result,
      });
      return result;
    }
  }


  // 级别 1.5：全局离线缓存
  const offlinePath = path.join(OFFLINE_CACHE_DIR, `${genre}.json`);
  if (fs.existsSync(offlinePath)) {
    try {
      const offline = JSON.parse(fs.readFileSync(offlinePath, 'utf8'));
      if (offline.data || offline.entries) {
        _writeFallbackAudit(bookRoot, 1.5, 'offline_cache', genre);
        process.stderr.write(`${C.yellow}[scene-pack] 降级→全局离线缓存（${genre}）${C.reset}\n`);
        const result = _resultFromCache(offline, genre, {}, stage);
        _recordScenePackStatus(bookRoot, {
          requestedGenre: genre,
          resolvedGenre: genre,
          stage,
          source: 'offline_cache',
          result,
        });
        return result;
      }
    } catch { /* 解析失败，继续降级 */ }
  }


  // 级别 2：内置规范文件（.md）
  return _degradeToLocal(bookRoot, genre, stage, reason);
}

/**
 * FIX-P1-06: 从 md 文件解析结构化数据，不再仅填充 quality 数组。
 * 解析规则：
 *   - S0 / ## S0 节         → init 问题列表
 *   - S2 / ## S2 节（表格） → outline 章节列表
 *   - S/P/C/B / ## S/P/C/B  → quality 规则列表（保留全文作为一条兜底 + 分层解析）
 *   - 检索策略 / ## 检索     → search 策略列表
 *   - 视觉 / 可视化          → visual 建议列表
 */
function _mergeStructuredPackData(base, extra) {
  return {
    quality: [...(base?.quality ?? []), ...(extra?.quality ?? [])],
    outline: [...(base?.outline ?? []), ...(extra?.outline ?? [])],
    search: [...(base?.search ?? []), ...(extra?.search ?? [])],
    init: [...(base?.init ?? []), ...(extra?.init ?? [])],
    visual: [...(base?.visual ?? []), ...(extra?.visual ?? [])],
  };
}

export function loadLocalFallbackData(localRulesDir, genre) {
  const localRuleFile = path.join(localRulesDir, `${genre}-local-rule.md`);
  const primaryFile = path.join(localRulesDir, `${genre}.md`);
  const sourceFiles = [localRuleFile, primaryFile].filter(fs.existsSync);
  if (sourceFiles.length === 0) return null;

  let data = { quality: [], outline: [], search: [], init: [], visual: [] };
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    data = _mergeStructuredPackData(data, _parseMdToStructured(content, genre));
  }

  return { data, sourceFiles };
}

function _degradeToLocal(bookRoot, genre, stage, reason) {
  const localBundle = loadLocalFallbackData(LOCAL_RULES_DIR, genre);
  if (localBundle) {
    _writeFallbackAudit(bookRoot, 2, 'local_rule', genre);
    process.stderr.write(`${C.yellow}[scene-pack] 降级→内置规范（${genre}）：${reason}${C.reset}\n`);

    const data = stage ? filterByGenreAndStage(localBundle.data, genre, stage) : localBundle.data;

    // FIX-P1-02: userNotice 字段供 AI 响应层展示给用户，不依赖 stderr
    const userNotice =
      `当前网络不可用或在线规则暂无法拉取，写作仍可按内置体裁指引继续；部分需要联网的高级能力会稍后再试。` +
      `恢复网络后会自动尝试同步最新规则。`;

    const result = {
      data,
      meta: {
        genre,
        label: `${genre}（内置规范）`,
        version: 'local',
        cachedAt: new Date().toISOString(),
        degraded: true,
        degradeReason: reason,
        sourceFiles: localBundle.sourceFiles.map(file => path.basename(file)),
        userNotice,
      },
    };
    _recordScenePackStatus(bookRoot, {
      requestedGenre: genre,
      resolvedGenre: genre,
      stage,
      source: 'local_rule',
      result,
    });
    return result;
  }

  // 级别 3：跳过
  _writeFallbackAudit(bookRoot, 3, 'no_pack', genre);
  process.stderr.write(`${C.yellow}[scene-pack] 降级→跳过场景包注入（${genre}，无内置规范）${C.reset}\n`);
  const result = _noPackResult(genre);
  _recordScenePackStatus(bookRoot, {
    requestedGenre: genre,
    resolvedGenre: genre,
    stage,
    source: 'no_pack',
    result,
  });
  return result;
}



/**
 * 解析场景包 md 文件为结构化数据
 * 支持 quality / outline / search / init / visual 五个维度
 */
function _parseMdToStructured(content, genre) {
  const lines   = content.split('\n');
  const quality = [];
  const outline = [];
  const search  = [];
  const init    = [];
  const visual  = [];

  let section = null; // 当前解析区段

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 区段识别
    if (/^#+\s*(S0|初始素材|初始化|init)/i.test(line))             { section = 'init';    continue; }
    if (/^#+\s*(S2|大纲|outline)/i.test(line))                     { section = 'outline'; continue; }
    if (/^#+\s*(S\/P\/C\/B|质量规则|质检|quality|L3 降级时的体裁感知规则|结构规则|内容质量规则|风格规则)/i.test(line)) { section = 'quality'; continue; }
    if (/^#+\s*(检索策略|检索|search)/i.test(line))                 { section = 'search';  continue; }
    if (/^#+\s*(视觉|可视化|visual)/i.test(line))                   { section = 'visual';  continue; }

    if (/^#+\s/.test(line))                                          { section = null;      continue; }

    if (!line || line.startsWith('---') || line.startsWith('>')) continue;

    switch (section) {
      case 'init': {
        // 列表项：数字列表或 ▶ / ★ 标记
        const m = line.match(/^(?:\d+\.\s*[▶★]?\s*|[-*]\s*[▶★]?\s*)(.+)/);
        if (m) init.push({ question_id: `${genre}_q${init.length + 1}`, text: m[1].trim(), required: /▶|★/.test(line), genre });
        break;
      }
      case 'outline': {
        // 表格行（| 序 | 章节 | ...）
        if (line.startsWith('|') && !line.startsWith('|---') && !/序|章节|section/i.test(line)) {
          const cells = line.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length >= 2) {
            outline.push({
              seq:      cells[0],
              title:    cells[1],
              word_range: cells[2] ?? '',
              must_include: cells[3] ?? '',
              genre,
            });
            break;
          }
        }

        if (!/^```/.test(line) && !/^[├└│]/.test(line) && /(前言|序言|第一章|第.+章|后记|结语|附录)/.test(line)) {
          outline.push({
            seq: String(outline.length + 1),
            title: line,
            word_range: '',
            must_include: '',
            genre,
          });
        }
        break;
      }

      case 'quality': {
        // 子标题识别层级（### S层 / ### P层 等）
        const layerMatch = line.match(/^#+\s*([SPCB])\s*层/);
        if (layerMatch) { section = `quality_${layerMatch[1]}`; continue; }

        if (line.startsWith('|') && !line.startsWith('|---')) {
          const cells = line.split('|').map(c => c.trim()).filter(Boolean);
          const isHeader = cells[0] && /^(ID|规则ID|规则|检查项)$/i.test(cells[0]);
          if (!isHeader && cells.length >= 2) {
            quality.push({
              rule_id: cells[0] || `${genre}_q${quality.length + 1}`,
              level: 'must',
              content: [cells[1], cells[2]].filter(Boolean).join('｜'),
              stage: 'ALL',
              layer: 'ALL',
              genre,
            });
            break;
          }
        }

        // [MUST] / [SHOULD] / [MUST-NOT] 规则
        const ruleMatch = line.match(/^\*?\*?\[?(MUST(?:-NOT)?|SHOULD)\]?\*?\*?\s*(.+)/i);
        if (ruleMatch) {
          quality.push({
            rule_id: `${genre}_q${quality.length + 1}`,
            level:   ruleMatch[1].toLowerCase().replace('-', '_'),
            content: ruleMatch[2].trim(),
            stage:   'ALL',
            layer:   'ALL',
            genre,
          });
        }
        break;
      }

      case 'quality_S':
      case 'quality_P':
      case 'quality_C':
      case 'quality_B': {
        const layer     = section.split('_')[1];
        const ruleMatch = line.match(/^\*?\*?\[?(MUST(?:-NOT)?|SHOULD)\]?\*?\*?\s*(.+)/i);
        if (ruleMatch) {
          quality.push({
            rule_id: `${genre}_${layer}${quality.length + 1}`,
            level:   ruleMatch[1].toLowerCase().replace('-', '_'),
            content: ruleMatch[2].trim(),
            stage:   'ALL',
            layer,
            genre,
          });
        }
        break;
      }
      case 'search': {
        // 列表项或表格行
        if (line.match(/^[-*]\s+/) || /^每章|优先|必须|禁止/.test(line)) {
          search.push({ strategy_id: `${genre}_s${search.length + 1}`, content: line.replace(/^[-*]\s+/, ''), genre });
        }
        break;
      }
      case 'visual': {
        // 表格行
        if (line.startsWith('|') && !line.startsWith('|---') && !/图表类型|类型|type/i.test(line)) {
          const cells = line.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length >= 2) {
            visual.push({ chart_type: cells[0], trigger: cells[1] ?? '', note: cells[2] ?? '', genre });
          }
        }
        break;
      }
    }
  }

  // 质量规则兜底：若解析为空，把全文作为一条 should 规则（保持向后兼容）
  if (quality.length === 0) {
    quality.push({ rule_id: `${genre}_local`, level: 'should', content, stage: 'ALL', layer: 'ALL', genre });
  }

  return { quality, outline, search, init, visual };
}

function _noPackResult(genre) {
  return {
    data: { quality: [], outline: [], search: [], init: [], visual: [] },
    meta: { genre, label: genre, version: 'N/A', cachedAt: null, degraded: true, degradeReason: 'no_pack' },
  };
}


/** 全局审计日志路径（bookRoot=null 时的降级写入目标，FIX-P2-05）*/
const GLOBAL_AUDIT_LOG = path.join(ROOT, '.fbs', 'audit-runs', 'fallback-audit.jsonl');

/**
 * FIX-P2-05: bookRoot=null 时（如 syncAllPacks 调用）不再静默跳过，
 * 改为写入全局审计日志 .fbs/audit-runs/fallback-audit.jsonl
 */
function _writeFallbackAudit(bookRoot, level, reason, genre) {
  if (bookRoot) {
    appendAuditLog(bookRoot, { event: 'scene_pack_fallback', level, reason, genre });
  } else {
    // syncAllPacks 无 bookRoot：写全局审计日志
    try {
      fs.mkdirSync(path.dirname(GLOBAL_AUDIT_LOG), { recursive: true });
      const entry = JSON.stringify({ ts: new Date().toISOString(), event: 'scene_pack_fallback', level, reason, genre, context: 'sync_all_packs' });
      fs.appendFileSync(GLOBAL_AUDIT_LOG, entry + '\n', 'utf8');
    } catch { /* 全局审计写入失败不阻断流程 */ }
  }
}


// ─────────────────────────────────────────────
// CLI 入口（npm run wecom:sync-packs）
// ─────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.includes('--sync-all')) {
    syncAllPacks().catch(err => {
      process.stderr.write(`${C.red}[ERROR] ${err.message}${C.reset}\n`);
      process.exit(1);
    });
  }
}
