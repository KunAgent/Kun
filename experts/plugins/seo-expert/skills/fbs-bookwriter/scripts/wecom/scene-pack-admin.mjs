#!/usr/bin/env node
/**
 * scripts/wecom/scene-pack-admin.mjs
 * ⚙️ 平台侧管理员工具（v2.0）
 *
 * v2.0 定位：企微智能表格为只读配置载体（企微→FBS 方向）。
 * 此工具供 FBS 项目方管理员维护平台数据，不属于用户侧或企业侧日常工具。
 * 需要 Node.js ≥18 + wecom-cli 已完成平台级授权。
 *
 * 功能：
 *   check        — 校验 registry.json + enterprise.json 配置合法性（本地只读，无需授权）
 *   status       — 查看各 pack 缓存状态（本地只读，无需授权）
 *   init         — 在企业微信智能表格中创建 7 张 Sheet 结构（需企微授权）
 *   push <genre> — 将本地 references/scene-packs/{genre}.md 推送为表格初始数据（需企微授权）
 *   corp-setup   — 为企业客户一键交付覆盖文档（需企微授权）
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { WecomError, resolveWecomDataPaths, C } from './lib/utils.mjs';

import { wecomRun } from './wecom-client.mjs';
import { assertAuthReady } from './auth-check.mjs';
import { validateCorpConfig, loadCorpConfig } from './lib/entitlement.mjs';
import { VALID_GENRES, SHEET_NAMES } from './lib/scene-pack-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const { scenePacksDir, referencesScenePacksDir } = resolveWecomDataPaths(ROOT);

const REGISTRY_PATH      = path.join(scenePacksDir, 'registry.json');
const SCHEMA_PATH        = path.join(scenePacksDir, 'official-schema.json');
const OFFLINE_CACHE_DIR  = path.join(scenePacksDir, '.offline-cache');
const COMMERCIAL_CACHE_PATH = path.join(OFFLINE_CACHE_DIR, 'commercial-hub.json');
const LOCAL_RULES_DIR    = referencesScenePacksDir;
const ADMIN_TOKEN_ENV    = 'FBS_SCENE_PACK_ADMIN_TOKEN';
const COMMERCIAL_HUB_SHEET_TITLE = 'commercial_hub';
const COMMERCIAL_HUB_COLUMNS = [
  { name: 'record_id', type: 1 },
  { name: 'record_type', type: 1 },
  { name: 'corp_id', type: 1 },
  { name: 'user_id', type: 1 },
  { name: 'genre', type: 1 },
  { name: 'event', type: 1 },
  { name: 'delta', type: 3 },
  { name: 'balance_after', type: 3 },
  { name: 'credits_required', type: 3 },
  { name: 'code_prefix', type: 1 },
  { name: 'code_hash', type: 1 },
  { name: 'code_type', type: 1 },
  { name: 'redeem_target', type: 1 },
  { name: 'request_id', type: 1 },
  { name: 'order_id', type: 1 },
  { name: 'status', type: 1 },
  { name: 'trial_allowed', type: 7 },
  { name: 'enterprise_only', type: 7 },
  { name: 'source', type: 1 },
  { name: 'operator', type: 1 },
  { name: 'risk_flag', type: 1 },
  { name: 'payload_json', type: 1 },
  { name: 'created_at', type: 1 },
  { name: 'updated_at', type: 1 },
];

function assertAdminWriteAccess(action, providedToken = '') {
  const expected = String(process.env[ADMIN_TOKEN_ENV] ?? '').trim();
  const provided = String(providedToken ?? '').trim();

  if (!expected) {
    throw new WecomError(
      'BIZ_ADMIN_TOKEN_MISSING',
      `写操作已启用管理员口令门禁。请先设置环境变量 ${ADMIN_TOKEN_ENV}`
    );
  }

  if (provided && provided !== expected) {
    throw new WecomError('BIZ_ADMIN_TOKEN_INVALID', `管理员口令校验失败（${action}）`);
  }
}


// ─────────────────────────────────────────────
// scene-pack:check（配置校验）
// ─────────────────────────────────────────────

/**
 * 校验本地配置文件合法性
 * 检查项：
 *   - registry.json schema_version 是否为 v2.0
 *   - registry.packs 是否覆盖全部 VALID_GENRES
 *   - enterprise.json（若存在）validateCorpConfig
 *   - official-schema.json 是否存在
 */
export function checkConfig() {
  let hasError = false;
  const warn = (msg) => {
    process.stderr.write(`${C.yellow}  ⚠️  ${msg}${C.reset}\n`);
    hasError = true;
  };
  const ok   = (msg) => process.stderr.write(`${C.green}  ✅ ${msg}${C.reset}\n`);
  const info = (msg) => process.stderr.write(`${C.cyan}  ℹ  ${msg}${C.reset}\n`);

  process.stderr.write(`\n${C.cyan}=== scene-pack:check ===${C.reset}\n\n`);

  // 1. registry.json
  if (!fs.existsSync(REGISTRY_PATH)) {
    warn('registry.json 不存在');
  } else {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    if (!reg._version?.startsWith('2.')) warn(`registry.json _version 应为 2.x（当前：${reg._version}）`);
    else ok(`registry.json _version = ${reg._version}`);

    if (!reg.official_spreadsheet_id || reg.official_spreadsheet_id.startsWith('FILL_')) {
      warn('registry.json official_spreadsheet_id 未填写真实值');
    } else {
      ok(`official_spreadsheet_id = ${reg.official_spreadsheet_id.slice(0, 8)}…`);
    }

    for (const genre of VALID_GENRES) {
      if (reg.packs?.[genre]) {
        const hasSheetIds = reg.packs[genre].sheet_ids &&
          Object.keys(reg.packs[genre].sheet_ids).length >= 2;
        if (hasSheetIds) ok(`packs.${genre} 已配置（含 sheet_ids）`);
        else warn(`packs.${genre} sheet_ids 未配置或不完整`);
      } else {
        warn(`packs 缺少体裁：${genre}`);
      }
    }

    if (reg.cache_ttl_days !== 1) warn(`cache_ttl_days 应为 1（R6 决议），当前：${reg.cache_ttl_days}`);
    else ok('cache_ttl_days = 1');
  }

  // 2. enterprise.json（可选）
  const corpConfig = loadCorpConfig();
  if (!corpConfig) {
    info('enterprise.json 不存在（单机/个人模式，跳过企业配置校验）');
  } else {
    const { valid, errors, warnings } = validateCorpConfig(corpConfig);
    if (valid) ok('enterprise.json 配置合法');
    else errors.forEach(e => warn(`enterprise.json: ${e}`));
    (warnings ?? []).forEach(w => info(`enterprise.json: ${w}`));
  }

  // 3. official-schema.json
  if (!fs.existsSync(SCHEMA_PATH)) {
    warn('official-schema.json 不存在（建议运行 scene-pack:init 生成）');
  } else {
    ok('official-schema.json 存在');
  }

  // 4. 内置规范文件
  for (const genre of VALID_GENRES) {
    const localFile = path.join(LOCAL_RULES_DIR, `${genre}.md`);
    if (fs.existsSync(localFile)) ok(`内置规范存在：${genre}.md`);
    else warn(`内置规范缺失：references/scene-packs/${genre}.md`);
  }

  // 5. 离线缓存状态
  for (const genre of VALID_GENRES) {
    const cacheFile = path.join(OFFLINE_CACHE_DIR, `${genre}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        const age = Math.round((Date.now() - new Date(cache.cachedAt).getTime()) / 3600000);
        info(`离线缓存：${genre}（${age}h 前`);
      } catch {
        warn(`离线缓存损坏：${genre}.json`);
      }
    }
  }

  process.stderr.write('\n');
  if (hasError) {
    process.stderr.write(`${C.yellow}[scene-pack:check] 存在警告，请修复后再上线${C.reset}\n\n`);
    return false;
  }
  process.stderr.write(`${C.green}[scene-pack:check] 全部通过${C.reset}\n\n`);
  return true;
}

// ─────────────────────────────────────────────
// scene-pack:init（表格结构初始化）
// ─────────────────────────────────────────────

/**
 * 在企业微信智能表格中创建场景包所需的 7 张 Sheet
 * 模式：
 *   --official  对官方表格操作（需 FBS 项目方权限）
 *   --corp      对企业覆盖文档操作（需 enterprise.json corp_spreadsheet_id）
 *
 * 注意：此命令只建 Sheet 框架，不写入数据行。数据通过 scene-pack:push 推送。
 */
export async function initSheets(opts = {}) {
  assertAdminWriteAccess('init', opts.adminToken);

  const { mode } = await assertAuthReady();
  if (mode === 'local') {
    throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法操作远端表格');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  let spreadsheetId;

  if (opts.corp) {
    const corpConfig = loadCorpConfig();
    if (!corpConfig?.corp_spreadsheet_id) {
      throw new WecomError('BIZ_NO_CORP_ID', 'enterprise.json 中缺少 corp_spreadsheet_id');
    }
    spreadsheetId = corpConfig.corp_spreadsheet_id;
    process.stderr.write(`${C.cyan}[scene-pack:init] 初始化企业覆盖文档：${spreadsheetId}${C.reset}\n`);
  } else {
    spreadsheetId = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
    if (!spreadsheetId || String(spreadsheetId).startsWith('FILL_')) {
      throw new WecomError('BIZ_NO_SPREADSHEET_ID', 'registry.json official_spreadsheet_url / official_spreadsheet_id 未配置');
    }
    process.stderr.write(`${C.cyan}[scene-pack:init] 初始化官方场景包表格：${spreadsheetId}${C.reset}\n`);
  }

  // 加载 official-schema.json 获取列定义
  let schema = null;
  if (fs.existsSync(SCHEMA_PATH)) {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }

  // 逐个创建 Sheet
  const sheetResults = {};
  for (const [sheetKey, sheetName] of Object.entries(SHEET_NAMES)) {
    process.stderr.write(`${C.cyan}  → 创建 Sheet：${sheetName}${C.reset}\n`);
    try {
      // 企业微信 API：创建子表（smartsheet_add_sheet），用 url 参数
      const isUrl = spreadsheetId.startsWith('http');
      const result = await wecomRun('doc', 'smartsheet_add_sheet', {
        ...(isUrl ? { url: spreadsheetId } : { docid: spreadsheetId }),
        properties: { title: sheetName },
      });
      const sheetId = result?.sheet_id ?? result?.properties?.sheet_id;
      sheetResults[sheetKey] = sheetId;
      process.stderr.write(`${C.green}    ✅ ${sheetName} → sheet_id: ${sheetId}${C.reset}\n`);

      // 若有 schema 定义，添加列（传入 url/id）
      if (schema?.sheets?.[sheetKey]) {
        await _addColumns(spreadsheetId, sheetId, schema.sheets[sheetKey].columns);
      }
    } catch (err) {
      process.stderr.write(`${C.yellow}    ⚠️  ${sheetName} 创建失败：${err.message}${C.reset}\n`);
      sheetResults[sheetKey] = null;
    }
  }

  process.stderr.write(`\n${C.green}[scene-pack:init] Sheet 初始化完成${C.reset}\n`);
  process.stderr.write(`请将以下 sheet_id 填入 ${opts.corp ? 'enterprise.json' : 'registry.json'}：\n`);
  process.stderr.write(JSON.stringify(sheetResults, null, 2) + '\n');

  return sheetResults;
}

/**
 * 初始化商业化单表 commercial_hub（同一文档内）
 * - 创建 Sheet
 * - 写入统一列定义
 */
export async function initCommercialHub(opts = {}) {
  assertAdminWriteAccess('commercial-init', opts.adminToken);

  const { mode } = await assertAuthReady();
  if (mode === 'local') {
    throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法操作远端表格');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  if (!spreadsheet || String(spreadsheet).startsWith('FILL_')) {
    throw new WecomError('BIZ_NO_SPREADSHEET_ID', 'registry.json official_spreadsheet_url / official_spreadsheet_id 未配置');
  }

  process.stderr.write(`${C.cyan}[commercial:init] 初始化商业化单表：${spreadsheet}${C.reset}\n`);
  const isUrl = String(spreadsheet).startsWith('http');
  const created = await wecomRun('doc', 'smartsheet_add_sheet', {
    ...(isUrl ? { url: spreadsheet } : { docid: spreadsheet }),
    properties: { title: COMMERCIAL_HUB_SHEET_TITLE },
  });

  const sheetId = created?.sheet_id ?? created?.properties?.sheet_id;
  if (!sheetId) {
    throw new WecomError('BIZ_COMMERCIAL_SHEET_CREATE_FAILED', 'commercial_hub 创建失败，未返回 sheet_id');
  }

  await _addColumns(spreadsheet, sheetId, COMMERCIAL_HUB_COLUMNS);

  process.stderr.write(`${C.green}[commercial:init] ✅ commercial_hub 已创建：${sheetId}${C.reset}\n`);
  process.stderr.write(`${C.cyan}请将以下字段写入 registry.json：commercial_hub_sheet_id${C.reset}\n`);
  process.stderr.write(JSON.stringify({ commercial_hub_sheet_id: sheetId }, null, 2) + '\n');

  return { sheetId, title: COMMERCIAL_HUB_SHEET_TITLE };
}

/**
 * 写入商业化单表种子数据（ENTITLEMENT_RULE）
 */
export async function seedCommercialHub(opts = {}) {
  assertAdminWriteAccess('commercial-seed', opts.adminToken);

  const { mode } = await assertAuthReady();
  if (mode === 'local') {
    throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法操作远端表格');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  const sheetId = opts.sheetId || registry.commercial_hub_sheet_id;
  if (!spreadsheet) {
    throw new WecomError('BIZ_NO_SPREADSHEET_ID', 'registry.json official_spreadsheet_url / official_spreadsheet_id 未配置');
  }
  if (!sheetId) {
    throw new WecomError('BIZ_NO_COMMERCIAL_SHEET_ID', '缺少 commercial_hub_sheet_id，请先 commercial-init 或通过 --sheet-id 传入');
  }

  const now = new Date().toISOString();
  const base = { source: 'official', operator: 'system', risk_flag: 'none', created_at: now, updated_at: now };
  const records = [
    { record_id: `rule_general_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'general', credits_required: 0, trial_allowed: true, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_genealogy_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'genealogy', credits_required: 100, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_consultant_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'consultant', credits_required: 200, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_ghostwriter_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'ghostwriter', credits_required: 200, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_whitepaper_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'whitepaper', credits_required: 200, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_report_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'report', credits_required: 200, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_training_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'training', credits_required: 300, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
    { record_id: `rule_personal_book_${Date.now()}`, record_type: 'ENTITLEMENT_RULE', genre: 'personal-book', credits_required: 500, trial_allowed: false, enterprise_only: false, status: 'active', event: 'entitlement_rule', ...base },
  ];

  const isUrl = String(spreadsheet).startsWith('http');
  await wecomRun('doc', 'smartsheet_add_records', {
    ...(isUrl ? { url: spreadsheet } : { docid: spreadsheet }),
    sheet_id: sheetId,
    key_type: 'field_title',
    records: records.map(r => ({ values: r })),
  });
  _appendCommercialCache(records);

  process.stderr.write(`${C.green}[commercial:seed] ✅ 已写入 ${records.length} 条规则到 commercial_hub(${sheetId})${C.reset}\n`);
  return { sheetId, count: records.length };
}

/**
 * 商业化单表健康检查（只读）
 * - 验证 sheet 是否可访问
 * - 输出记录总数与 record_type 分布（若 API 可读文本字段）
 */
export async function checkCommercialHub(opts = {}) {
  const { mode } = await assertAuthReady();
  if (mode === 'local') {
    throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法读取远端商业化单表');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  const sheetId = opts.sheetId || registry.commercial_hub_sheet_id;
  if (!spreadsheet) {
    throw new WecomError('BIZ_NO_SPREADSHEET_ID', 'registry.json official_spreadsheet_url / official_spreadsheet_id 未配置');
  }
  if (!sheetId) {
    throw new WecomError('BIZ_NO_COMMERCIAL_SHEET_ID', '缺少 commercial_hub_sheet_id');
  }

  const isUrl = String(spreadsheet).startsWith('http');
  const result = await wecomRun('doc', 'smartsheet_get_records', {
    ...(isUrl ? { url: spreadsheet } : { docid: spreadsheet }),
    sheet_id: sheetId,
    with_record_field_data: true,
    limit: 1000,
  });

  const records = result?.records ?? [];
  const typeCounter = {};
  let readableTypeCount = 0;
  for (const r of records) {
    const values = r?.values ?? {};
    const t = values.record_type;
    if (typeof t === 'string' && t) {
      readableTypeCount++;
      typeCounter[t] = (typeCounter[t] ?? 0) + 1;
    }
  }

  process.stderr.write(`${C.cyan}[commercial:check] sheet=${sheetId} total=${records.length}${C.reset}\n`);
  if (readableTypeCount > 0) {
    process.stderr.write(`${C.green}[commercial:check] record_type 分布：${JSON.stringify(typeCounter)}${C.reset}\n`);
  } else {
    process.stderr.write(`${C.yellow}[commercial:check] 当前 API 未返回可读文本字段，已确认连通性与记录数${C.reset}\n`);
  }

  return { sheetId, total: records.length, typeCounter, readableTypeCount };
}

function _newRecordId(prefix = 'rec') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _hashActivationCode(code) {
  return createHash('sha256').update(String(code ?? '').trim()).digest('hex');
}

function _readCommercialCache() {
  if (!fs.existsSync(COMMERCIAL_CACHE_PATH)) {
    return { _version: '1.0', updatedAt: new Date().toISOString(), records: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(COMMERCIAL_CACHE_PATH, 'utf8'));
    return { _version: '1.0', updatedAt: new Date().toISOString(), records: raw.records ?? [] };
  } catch {
    return { _version: '1.0', updatedAt: new Date().toISOString(), records: [] };
  }
}

function _writeCommercialCache(cache) {
  fs.mkdirSync(path.dirname(COMMERCIAL_CACHE_PATH), { recursive: true });
  fs.writeFileSync(COMMERCIAL_CACHE_PATH, JSON.stringify({ ...cache, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

function _normalizeCommercialRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== '')
  );
}

function _appendCommercialCache(records) {
  const cache = _readCommercialCache();
  cache.records.push(...records.map(_normalizeCommercialRow));
  _writeCommercialCache(cache);
}

async function _writeCommercialRows(spreadsheet, sheetId, rows) {
  const isUrl = String(spreadsheet).startsWith('http');
  const normalizedRows = rows.map(_normalizeCommercialRow);
  await wecomRun('doc', 'smartsheet_add_records', {
    ...(isUrl ? { url: spreadsheet } : { docid: spreadsheet }),
    sheet_id: sheetId,
    key_type: 'field_title',
    records: normalizedRows.map(values => ({ values })),
  });
}


/**
 * 导入/发放激活码（ACTIVATION_CODE）
 */
export async function addCommercialCode(opts = {}) {
  assertAdminWriteAccess('commercial-add-code', opts.adminToken);

  const { mode } = await assertAuthReady();
  if (mode === 'local') throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法写入商业化单表');

  const rawCode = String(opts.code ?? '').trim();
  if (!rawCode) throw new WecomError('BIZ_NO_CODE', '--code 不能为空');

  const codeType = String(opts.codeType ?? 'CRD').trim().toUpperCase();
  const allowedTypes = ['CRD', 'SCN', 'ENT', 'TRL'];
  if (!allowedTypes.includes(codeType)) {
    throw new WecomError('BIZ_INVALID_CODE_TYPE', `--code-type 非法，合法值：${allowedTypes.join('/')}`);
  }

  const redeemTarget = String(opts.redeemTarget ?? '').trim();
  if (!redeemTarget) {
    throw new WecomError('BIZ_NO_REDEEM_TARGET', '--redeem-target 不能为空，例如 credits:500 / genre:report');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  const sheetId = opts.sheetId || registry.commercial_hub_sheet_id;
  if (!spreadsheet || !sheetId) throw new WecomError('BIZ_NO_COMMERCIAL_SHEET_ID', '缺少 commercial_hub 配置');

  const cache = _readCommercialCache();
  const codeHash = _hashActivationCode(rawCode);
  const force = !!opts.force;

  const existsActive = cache.records.some(r =>
    r.record_type === 'ACTIVATION_CODE' &&
    r.code_hash === codeHash &&
    r.status !== 'expired' &&
    r.status !== 'used'
  );
  if (existsActive && !force) {
    throw new WecomError('BIZ_CODE_ALREADY_EXISTS', '激活码已存在（可用状态），如需覆盖请加 --force');
  }

  const now = new Date().toISOString();
  const row = {
    record_id: _newRecordId('code'),
    record_type: 'ACTIVATION_CODE',
    corp_id: String(opts.corpId ?? ''),
    user_id: '',
    event: 'issue_code',
    code_prefix: rawCode.slice(0, 6),
    code_hash: codeHash,
    code_type: codeType,
    redeem_target: redeemTarget,
    status: String(opts.status ?? 'active'),
    source: String(opts.source ?? 'admin'),
    operator: String(opts.operator ?? 'admin'),
    risk_flag: 'none',
    payload_json: String(opts.note ?? ''),
    created_at: now,
    updated_at: now,
  };

  await _writeCommercialRows(spreadsheet, sheetId, [row]);
  _appendCommercialCache([row]);

  process.stderr.write(`${C.green}[commercial:add-code] ✅ code_type=${codeType} target=${redeemTarget} 已写入 commercial_hub(${sheetId})${C.reset}\n`);
  return { codeType, redeemTarget, sheetId };
}

/**
 * 写入一条乐包流水（LEDGER）
 */
export async function addCommercialLedger(opts = {}) {
  assertAdminWriteAccess('commercial-add-ledger', opts.adminToken);

  const { mode } = await assertAuthReady();
  if (mode === 'local') throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法写入商业化单表');

  const userId = String(opts.userId ?? '').trim();
  if (!userId) throw new WecomError('BIZ_NO_USER_ID', '--user-id 不能为空');

  const delta = Number(opts.delta ?? 0);
  if (!Number.isFinite(delta) || delta === 0) throw new WecomError('BIZ_INVALID_DELTA', '--delta 必须为非0数字');

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  const sheetId = opts.sheetId || registry.commercial_hub_sheet_id;
  if (!spreadsheet || !sheetId) throw new WecomError('BIZ_NO_COMMERCIAL_SHEET_ID', '缺少 commercial_hub 配置');

  const cache = _readCommercialCache();
  const requestId = String(opts.requestId ?? '').trim();
  if (requestId && cache.records.some(r => r.record_type === 'LEDGER' && r.user_id === userId && r.request_id === requestId)) {
    return { duplicated: true, requestId };
  }

  const currentBalance = cache.records
    .filter(r => r.record_type === 'LEDGER' && r.user_id === userId)
    .reduce((sum, r) => sum + Number(r.delta ?? 0), 0);

  const balanceAfter = currentBalance + delta;
  if (balanceAfter < 0) {
    throw new WecomError('BIZ_INSUFFICIENT_BALANCE', `余额不足：当前 ${currentBalance}，变动 ${delta}`);
  }

  const now = new Date().toISOString();
  const row = {
    record_id: _newRecordId('ledger'),
    record_type: 'LEDGER',
    corp_id: String(opts.corpId ?? ''),
    user_id: userId,
    genre: String(opts.genre ?? ''),
    event: String(opts.event ?? 'manual_adjust'),
    delta,
    balance_after: balanceAfter,
    request_id: requestId,
    status: 'active',
    source: String(opts.source ?? 'admin'),
    operator: String(opts.operator ?? 'admin'),
    risk_flag: 'none',
    payload_json: String(opts.note ?? ''),
    created_at: now,
    updated_at: now,
  };

  await _writeCommercialRows(spreadsheet, sheetId, [row]);
  _appendCommercialCache([row]);

  process.stderr.write(`${C.green}[commercial:add-ledger] ✅ ${userId} ${delta > 0 ? '+' : ''}${delta}，余额 ${balanceAfter}${C.reset}\n`);
  return { userId, delta, balanceAfter, requestId };
}

/**
 * 查询用户乐包余额（仅基于本地商业化缓存）
 */
export async function getCommercialBalance(opts = {}) {
  const userId = String(opts.userId ?? '').trim();
  if (!userId) throw new WecomError('BIZ_NO_USER_ID', '--user-id 不能为空');

  const cache = _readCommercialCache();
  const ledgerRows = cache.records.filter(r => r.record_type === 'LEDGER' && r.user_id === userId);
  const balance = ledgerRows.reduce((sum, r) => sum + Number(r.delta ?? 0), 0);

  process.stderr.write(`${C.cyan}[commercial:get-balance] user=${userId} balance=${balance} ledger_count=${ledgerRows.length}${C.reset}\n`);
  return { userId, balance, ledgerCount: ledgerRows.length };
}

/**
 * 激活码核销（本地缓存驱动，写入 commercial_hub）
 */
export async function redeemCommercialCode(opts = {}) {
  assertAdminWriteAccess('commercial-redeem-code', opts.adminToken);

  const { mode } = await assertAuthReady();
  if (mode === 'local') throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法写入商业化单表');

  const userId = String(opts.userId ?? '').trim();
  const rawCode = String(opts.code ?? '').trim();
  if (!userId) throw new WecomError('BIZ_NO_USER_ID', '--user-id 不能为空');
  if (!rawCode) throw new WecomError('BIZ_NO_CODE', '--code 不能为空');

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const spreadsheet = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  const sheetId = opts.sheetId || registry.commercial_hub_sheet_id;
  if (!spreadsheet || !sheetId) throw new WecomError('BIZ_NO_COMMERCIAL_SHEET_ID', '缺少 commercial_hub 配置');

  const cache = _readCommercialCache();
  const requestId = String(opts.requestId ?? '').trim();
  if (requestId && cache.records.some(r => r.user_id === userId && r.request_id === requestId)) {
    return { duplicated: true, requestId };
  }

  const codeHash = _hashActivationCode(rawCode);
  const codeHistory = cache.records.filter(r => r.record_type === 'ACTIVATION_CODE' && r.code_hash === codeHash);
  if (codeHistory.length === 0) {
    throw new WecomError('BIZ_CODE_NOT_FOUND', '未在 commercial-hub 本地缓存找到激活码，请先导入 ACTIVATION_CODE 记录');
  }
  const latest = codeHistory[codeHistory.length - 1];
  if (latest.status === 'used') throw new WecomError('BIZ_CODE_USED', '激活码已使用');
  if (latest.status === 'expired') throw new WecomError('BIZ_CODE_EXPIRED', '激活码已过期');

  const target = String(latest.redeem_target ?? '');
  const now = new Date().toISOString();
  const rows = [];

  rows.push({
    record_id: _newRecordId('code_use'),
    record_type: 'ACTIVATION_CODE',
    corp_id: String(opts.corpId ?? latest.corp_id ?? ''),
    user_id: userId,
    event: 'redeem_code',
    code_prefix: String(latest.code_prefix ?? ''),
    code_hash: codeHash,
    code_type: String(latest.code_type ?? ''),
    redeem_target: target,
    request_id: requestId,
    status: 'used',
    source: 'admin',
    operator: String(opts.operator ?? 'admin'),
    risk_flag: 'none',
    created_at: now,
    updated_at: now,
  });

  if (target.startsWith('credits:')) {
    const amount = Number(target.slice('credits:'.length));
    if (!Number.isFinite(amount) || amount <= 0) throw new WecomError('BIZ_INVALID_REDEEM_TARGET', `无效兑换目标：${target}`);

    const currentBalance = cache.records
      .filter(r => r.record_type === 'LEDGER' && r.user_id === userId)
      .reduce((sum, r) => sum + Number(r.delta ?? 0), 0);

    rows.push({
      record_id: _newRecordId('ledger'),
      record_type: 'LEDGER',
      corp_id: String(opts.corpId ?? latest.corp_id ?? ''),
      user_id: userId,
      event: 'redeem_code',
      delta: amount,
      balance_after: currentBalance + amount,
      request_id: requestId,
      status: 'active',
      source: 'admin',
      operator: String(opts.operator ?? 'admin'),
      risk_flag: 'none',
      payload_json: `code_type=${latest.code_type ?? ''}`,
      created_at: now,
      updated_at: now,
    });
  } else if (target.startsWith('genre:')) {
    const genre = target.slice('genre:'.length);
    rows.push({
      record_id: _newRecordId('pack_access'),
      record_type: 'PACK_ACCESS',
      corp_id: String(opts.corpId ?? latest.corp_id ?? ''),
      user_id: userId,
      genre,
      event: 'redeem_code',
      request_id: requestId,
      status: 'active',
      source: 'admin',
      operator: String(opts.operator ?? 'admin'),
      risk_flag: 'none',
      payload_json: `code_type=${latest.code_type ?? ''}`,
      created_at: now,
      updated_at: now,
    });
  } else {
    throw new WecomError('BIZ_INVALID_REDEEM_TARGET', `不支持的兑换目标：${target}`);
  }

  await _writeCommercialRows(spreadsheet, sheetId, rows);
  _appendCommercialCache(rows);
  process.stderr.write(`${C.green}[commercial:redeem-code] ✅ ${userId} 已核销，写入 ${rows.length} 条记录${C.reset}\n`);
  return { userId, requestId, wrote: rows.length };
}

// API 字段类型枚举（来自 smartsheet_get_fields 实测）
const FIELD_TYPE_MAP = {
  1: 'FIELD_TYPE_TEXT',    // 单行文本
  2: 'FIELD_TYPE_TEXT',    // 多行文本（API 无区分）
  3: 'FIELD_TYPE_NUMBER',  // 数字
  5: 'FIELD_TYPE_TEXT',    // 单选（简化为文本）
  7: 'FIELD_TYPE_CHECKBOX',// 复选框
};

/**
 * 向 Sheet 添加列定义（正确字段类型枚举 + url 参数）
 */
async function _addColumns(spreadsheetIdOrUrl, sheetId, columns) {
  if (!Array.isArray(columns) || !columns.length) return;
  const isUrl = spreadsheetIdOrUrl.startsWith('http');
  try {
    // 先获取默认字段，重命名第1列；再添加其余列
    const fr = await wecomRun('doc', 'smartsheet_get_fields', {
      ...(isUrl ? { url: spreadsheetIdOrUrl } : { docid: spreadsheetIdOrUrl }),
      sheet_id: sheetId,
    });
    const existing = fr?.fields ?? [];
    const defaultId = existing[0]?.field_id;
    const defaultType = existing[0]?.field_type ?? 'FIELD_TYPE_TEXT';

    if (defaultId && existing[0]?.field_title !== columns[0].name) {
      await wecomRun('doc', 'smartsheet_update_fields', {
        ...(isUrl ? { url: spreadsheetIdOrUrl } : { docid: spreadsheetIdOrUrl }),
        sheet_id: sheetId,
        fields: [{ field_id: defaultId, field_title: columns[0].name, field_type: defaultType }],
      });
    }

    const restCols = columns.slice(1);
    if (restCols.length) {
      await wecomRun('doc', 'smartsheet_add_fields', {
        ...(isUrl ? { url: spreadsheetIdOrUrl } : { docid: spreadsheetIdOrUrl }),
        sheet_id: sheetId,
        fields: restCols.map(col => ({
          field_title: col.name,
          field_type:  FIELD_TYPE_MAP[col.type] ?? 'FIELD_TYPE_TEXT',
        })),
      });
    }
  } catch (err) {
    process.stderr.write(`${C.yellow}    ⚠️  添加列失败（${sheetId}）：${err.message}${C.reset}\n`);
  }
}

// ─────────────────────────────────────────────
// scene-pack:push（本地规范推送到表格）
// ─────────────────────────────────────────────

/**
 * 解析 references/scene-packs/{genre}.md → 结构化多 Sheet 数据
 *
 * 返回：{ init[], outline[], quality[], search[], visual[] }
 *
 * 解析规则：
 *   init    ← "## S0" 节下的编号列表（★=required）
 *   outline ← "## S2" 节下的 Markdown 表格（序/章节/字数/必须包含）
 *   quality ← "## S/P/C/B" 节下各 "### X 层" 的 [MUST]/[SHOULD]/[MUST-NOT] 条目
 *   search  ← "## 检索策略" 节下的内容（单行汇总）
 *   visual  ← "## 可视化" 节下的 Markdown 表格（图表类型/适用位置/说明）
 */
function _parseLocalMd(genre, content) {
  // 统一换行符（Windows \r\n → \n），避免行尾 \r 干扰正则
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ── 工具：提取指定标题后的内容直到下一个同级/上级标题 ──
  const sectionRe = (heading) =>
    new RegExp(`(?:^|\\n)${heading}[\\s\\S]*?(?=\\n##\\s|$)`, 'i');

  const getSection = (re) => {
    const m = content.match(re);
    return m ? m[0] : '';
  };

  // ─── init Sheet ───────────────────────────────────────────────────────────
  const initRows = [];
  const initSection = getSection(sectionRe('## S0'));
  if (initSection) {
    let order = 0;
    for (const line of initSection.split('\n')) {
      // 匹配编号列表：1. ★ xxx  或  1. xxx
      const m = line.match(/^\d+\.\s+(★\s+)?(.+)$/);
      if (!m) continue;
      order++;
      const required = !!m[1];
      const question = m[2].trim();
      initRows.push({
        init_id:  `${genre}_q${String(order).padStart(2, '0')}`,
        genre,
        question,
        required,
        order,
        source:   'official',
        enabled:  true,
      });
    }
  }

  // ─── outline Sheet ────────────────────────────────────────────────────────
  const outlineRows = [];
  const outlineSection = getSection(sectionRe('## S2'));
  if (outlineSection) {
    for (const line of outlineSection.split('\n')) {
      // 匹配 Markdown 表格数据行（跳过表头 | 序 | ... 和分隔行 |---|）
      if (!line.startsWith('|') || line.match(/^\|[\s\-:|]+\|/)) continue;
      const cols = line.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length < 2) continue;
      const orderNum = parseInt(cols[0], 10);
      if (isNaN(orderNum) && cols[0] !== '附') continue;  // 跳过标题行
      const order    = isNaN(orderNum) ? 99 : orderNum;
      const name     = cols[1] ?? '';
      const wordRange = cols[2] ?? '';
      const required  = cols[3] ?? '';

      // 解析字数范围 "2000–5000字" → min/max
      const wm = wordRange.match(/(\d[\d,]*)\s*[–\-~]\s*(\d[\d,]*)/);
      const word_min = wm ? parseInt(wm[1].replace(',', ''), 10) : null;
      const word_max = wm ? parseInt(wm[2].replace(',', ''), 10) : null;

      outlineRows.push({
        tpl_id:            `${genre}_ch${String(order).padStart(2, '0')}`,
        genre,
        order,
        name,
        word_min,
        word_max,
        required_elements: required,
        source:            'official',
        enabled:           true,
      });
    }
  }

  // ─── quality Sheet ────────────────────────────────────────────────────────
  const qualityRows = [];
  // 匹配整个 S/P/C/B 质量规则大节
  const qualSection = getSection(sectionRe('## S/P/C/B'));
  if (qualSection) {
    let currentLayer = 'ALL';
    const layerMap = { 'S 层': 'S', 'P 层': 'P', 'C 层': 'C', 'B 层': 'B' };
    const counters  = {};

    for (const line of qualSection.split('\n')) {
      // 识别 ### X 层 子节
      const layerM = line.match(/^###\s+(.+)/);
      if (layerM) {
        const key = Object.keys(layerMap).find(k => layerM[1].includes(k.split(' ')[0]));
        currentLayer = key ? layerMap[key] : 'ALL';
        continue;
      }
      // 识别规则条目：- **[MUST]** 内容  or  - **[SHOULD]** 内容  or  - **[MUST-NOT]** 内容
      const ruleM = line.match(/^-\s+\*\*\[(MUST(?:-NOT)?|SHOULD)\]\*\*\s+(.+)/i);
      if (!ruleM) continue;

      const levelRaw = ruleM[1].toUpperCase();
      const level    = levelRaw === 'MUST-NOT' ? 'must-not' : levelRaw === 'MUST' ? 'must' : 'should';
      const text     = ruleM[2].trim();
      const key      = `${genre}_${currentLayer}_${level}`;
      counters[key]  = (counters[key] ?? 0) + 1;
      const idx      = String(counters[key]).padStart(2, '0');

      qualityRows.push({
        rule_id: `${genre}_${currentLayer.toLowerCase()}_${level}_${idx}`,
        genre,
        stage:   'ALL',
        layer:   currentLayer,
        level,
        content: text,
        source:  'official',
        enabled: true,
      });
    }
  }

  // ─── search Sheet ─────────────────────────────────────────────────────────
  const searchRows = [];
  const searchSection = getSection(sectionRe('## 检索策略'));
  if (searchSection) {
    let max_per_chapter   = null;
    const preferred = [];
    const required  = [];

    for (const line of searchSection.split('\n')) {
      // "每章最多检索 **5 次**"
      const maxM = line.match(/每章最多检索\s+\**(\d+)\**\s*次/);
      if (maxM) { max_per_chapter = parseInt(maxM[1], 10); continue; }
      // "优先来源：..."
      const prefM = line.match(/优先来源[：:]\s*(.+)/);
      if (prefM) { preferred.push(prefM[1].trim()); continue; }
      // "必须引用：..."
      const reqM = line.match(/必须引用[：:]\s*(.+)/);
      if (reqM) { required.push(reqM[1].trim()); continue; }
    }

    searchRows.push({
      search_id:          `${genre}_search_01`,
      genre,
      stage:              'ALL',
      max_per_chapter:    max_per_chapter ?? 3,
      preferred_sources:  preferred.join('; '),
      required_sources:   required.join('; '),
      source:             'official',
      enabled:            true,
    });
  }

  // ─── visual Sheet ─────────────────────────────────────────────────────────
  const visualRows = [];
  const visualSection = getSection(sectionRe('## (?:可视化|视觉)'));
  if (visualSection) {
    let vIdx = 0;
    for (const line of visualSection.split('\n')) {
      if (!line.startsWith('|') || line.match(/^\|[\s\-:|]+\|/)) continue;
      const cols = line.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length < 2) continue;
      // 跳过标题行（第一列是 "图表类型" 这类中文表头）
      if (cols[0] === '图表类型' || cols[0] === '类型') continue;
      vIdx++;
      const chart_type  = cols[0] ?? '';
      const trigger     = cols[1] ?? '';
      const description = cols[2] ?? trigger;  // 部分文件只有2列

      visualRows.push({
        visual_id:   `${genre}_visual_${String(vIdx).padStart(2, '0')}`,
        genre,
        chart_type,
        trigger,
        description,
        source:      'official',
        enabled:     true,
      });
    }
  }

  return { init: initRows, outline: outlineRows, quality: qualityRows, search: searchRows, visual: visualRows };
}

/**
 * 将 references/scene-packs/{genre}.md 按结构化行推送到官方表格 5 个 Sheet
 *
 * 说明：wecom-cli smartsheet_get_records 只能读 checkbox 字段，
 * 文本字段无法从 API 读回。push 成功后同步写入 offline_cache JSON，
 * 作为运行时加载的本地 source of truth。
 *
 * @param {string} genre - 目标体裁（VALID_GENRES 之一）
 * @param {object} opts  - { dryRun: boolean }
 */
export async function pushLocalRules(genre, opts = {}) {
  assertAdminWriteAccess('push', opts.adminToken);

  if (!VALID_GENRES.includes(genre)) {
    throw new WecomError('BIZ_INVALID_GENRE', `无效体裁：${genre}，合法值：${VALID_GENRES.join(' / ')}`);
  }

  const localFile = path.join(LOCAL_RULES_DIR, `${genre}.md`);
  if (!fs.existsSync(localFile)) {
    throw new WecomError('BIZ_NO_LOCAL_RULE', `内置规范文件不存在：${localFile}`);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const packMeta = registry.packs?.[genre];
  if (!packMeta) {
    throw new WecomError('BIZ_NO_PACK_META', `registry.json 中未找到体裁：${genre}`);
  }

  const spreadsheetUrl = registry.official_spreadsheet_url ?? registry.official_spreadsheet_id;
  if (!spreadsheetUrl) {
    throw new WecomError('BIZ_NO_SPREADSHEET', 'registry.json 未配置 official_spreadsheet_url 或 official_spreadsheet_id');
  }

  const content = fs.readFileSync(localFile, 'utf8');
  const parsed  = _parseLocalMd(genre, content);

  // Sheet 名 → 数据行 映射（仅推送有数据的 Sheet）
  const SHEET_DATA = {
    init:    { rows: parsed.init,    idField: 'init_id' },
    outline: { rows: parsed.outline, idField: 'tpl_id'  },
    quality: { rows: parsed.quality, idField: 'rule_id' },
    search:  { rows: parsed.search,  idField: 'search_id' },
    visual:  { rows: parsed.visual,  idField: 'visual_id' },
  };

  process.stderr.write(`${C.cyan}[scene-pack:push] 解析 ${genre}.md…${C.reset}\n`);
  for (const [sheet, { rows }] of Object.entries(SHEET_DATA)) {
    process.stderr.write(`  ${sheet.padEnd(8)} → ${rows.length} 条\n`);
  }

  if (opts.dryRun) {
    process.stderr.write(`${C.gray}  [dry-run] 跳过实际写入${C.reset}\n`);
    return;
  }

  const { mode } = await assertAuthReady();
  if (mode === 'local') {
    throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法推送到远端表格');
  }

  const isUrl = spreadsheetUrl.startsWith('http');
  const results = {};

  for (const [sheet, { rows, idField }] of Object.entries(SHEET_DATA)) {
    const sheetId = packMeta.sheet_ids?.[sheet];
    if (!sheetId) {
      process.stderr.write(`${C.yellow}  ⚠️  跳过 ${sheet}：registry.json sheet_ids.${sheet} 未配置${C.reset}\n`);
      results[sheet] = [];
      continue;
    }
    if (rows.length === 0) {
      process.stderr.write(`${C.gray}  — 跳过 ${sheet}：解析结果为空${C.reset}\n`);
      results[sheet] = [];
      continue;
    }

    process.stderr.write(`${C.cyan}  → 写入 ${sheet}（${sheetId}，${rows.length} 行）…${C.reset}\n`);
    try {
      await wecomRun('doc', 'smartsheet_add_records', {
        ...(isUrl ? { url: spreadsheetUrl } : { docid: spreadsheetUrl }),
        sheet_id: sheetId,
        key_type: 'field_title',
        records:  rows.map(r => ({ values: r })),
      });
      process.stderr.write(`${C.green}    ✅ ${sheet} 写入成功（${rows.length} 行）${C.reset}\n`);
      results[sheet] = rows;
    } catch (err) {
      process.stderr.write(`${C.yellow}    ⚠️  ${sheet} 写入失败：${err.message}${C.reset}\n`);
      results[sheet] = [];
    }
  }

  // ── 同步写入 offline_cache（API 读取受限，本地缓存为 source of truth）──
  _writeOfflineCache(genre, packMeta, results, registry);
}

/**
 * 将场景包数据写入 offline_cache JSON（多 Sheet 全量版本）
 * 因 wecom-cli get_records 无法读回文本字段，offline_cache 在 push 时由管理员工具维护
 *
 * @param {object} results - { init[], outline[], quality[], search[], visual[] }
 */
function _writeOfflineCache(genre, packMeta, results, registry) {
  fs.mkdirSync(OFFLINE_CACHE_DIR, { recursive: true });
  const cacheFile = path.join(OFFLINE_CACHE_DIR, `${genre}.json`);

  // 读取已有缓存（按 idField 去重合并）
  let existing = null;
  if (fs.existsSync(cacheFile)) {
    try { existing = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* 损坏则重建 */ }
  }

  // 合并各 Sheet：新数据按 id 覆盖旧数据
  const merge = (sheetKey, idField) => {
    const old  = existing?.data?.[sheetKey] ?? [];
    const fresh = results[sheetKey] ?? [];
    if (fresh.length === 0) return old;
    const map = new Map(old.map(r => [r[idField], r]));
    for (const r of fresh) map.set(r[idField], r);
    return Array.from(map.values());
  };

  const data = {
    quality: merge('quality', 'rule_id'),
    outline: merge('outline', 'tpl_id'),
    init:    merge('init',    'init_id'),
    search:  merge('search',  'search_id'),
    visual:  merge('visual',  'visual_id'),
  };

  const cache = {
    genre,
    cachedAt: new Date().toISOString(),
    version:  packMeta.schema_version ?? registry?._version ?? '2.0',
    data,
  };

  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  process.stderr.write(`${C.green}  ✅ offline_cache 已更新：${cacheFile}${C.reset}\n`);

  const counts = Object.entries(data).map(([k, v]) => `${k}:${v.length}`).join('  ');
  const total  = Object.values(data).reduce((s, a) => s + a.length, 0);
  process.stderr.write(`${C.gray}     ${counts}  总计 ${total} 条${C.reset}\n`);
}

// ─────────────────────────────────────────────
// scene-pack:status（缓存状态查看）
// ─────────────────────────────────────────────

export function showStatus() {
  process.stderr.write(`\n${C.cyan}=== scene-pack:status ===${C.reset}\n\n`);

  const registry = fs.existsSync(REGISTRY_PATH)
    ? JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    : null;

  if (registry) {
    process.stderr.write(`注册表版本：${registry._version}（${registry._updated ?? ''}）\n`);
    process.stderr.write(`官方表格 ID：${registry.official_spreadsheet_id ?? '(未配置)'}\n`);
    process.stderr.write(`cache_ttl_days：${registry.cache_ttl_days ?? '(未配置)'}\n\n`);
  }

  // 离线缓存状态
  process.stderr.write('离线缓存（scene-packs/.offline-cache/）：\n');
  for (const genre of VALID_GENRES) {
    const cacheFile = path.join(OFFLINE_CACHE_DIR, `${genre}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        const ageH  = Math.round((Date.now() - new Date(cache.cachedAt).getTime()) / 3600000);
        const totalItems = cache.data
          ? Object.values(cache.data).reduce((s, a) => s + (a?.length ?? 0), 0)
          : (cache.entries?.length ?? 0);
        process.stderr.write(
          `  ${C.green}✅${C.reset} ${genre.padEnd(16)} v${cache.version ?? '?'} ` +
          `${totalItems}条 ${ageH}h前\n`
        );
      } catch {
        process.stderr.write(`  ${C.yellow}⚠️${C.reset}  ${genre.padEnd(16)} 缓存文件损坏\n`);
      }
    } else {
      process.stderr.write(`  ${C.gray}—${C.reset}  ${genre.padEnd(16)} 无离线缓存\n`);
    }
  }

  // 内置规范状态
  process.stderr.write('\n内置规范（references/scene-packs/）：\n');
  for (const genre of VALID_GENRES) {
    const localFile = path.join(LOCAL_RULES_DIR, `${genre}.md`);
    if (fs.existsSync(localFile)) {
      const stat = fs.statSync(localFile);
      const sizeKB = Math.round(stat.size / 1024 * 10) / 10;
      process.stderr.write(`  ${C.green}✅${C.reset} ${genre.padEnd(16)} ${sizeKB}KB\n`);
    } else {
      process.stderr.write(`  ${C.yellow}⚠️${C.reset}  ${genre.padEnd(16)} 缺失\n`);
    }
  }
  process.stderr.write('\n');
}

// ─────────────────────────────────────────────
// scene-pack:corp-setup（企业客户一键交付）
// ─────────────────────────────────────────────

/**
 * 为一个企业客户一键完成场景包交付：
 *   1. 创建企业覆盖文档（企业微信文档）
 *   2. 建 7 张 Sheet 结构（meta/init/outline/quality/search/visual/entitlement）
 *   3. 向每个 Sheet 写入样板行（让管理员看懂列结构）
 *   4. 生成 enterprise.json 内容（含 corp_spreadsheet_id + packs 配置）
 *   5. 输出文档链接 + enterprise.json，供 FBS 直接交付给客户
 *
 * 用法：
 *   node scene-pack-admin.mjs corp-setup --corp-id ww_xxx --name "XX科技" --genres "genealogy,training"
 *
 * @param {object} opts
 * @param {string}   opts.corpId   - 企业微信 corp_id
 * @param {string}   opts.corpName - 企业显示名称（用于文档标题和日志）
 * @param {string[]} opts.genres   - 启用的体裁列表（不含 general，general 始终启用）
 * @param {boolean}  [opts.dryRun] - 预览模式，不实际创建
 */
export async function corpSetup(opts = {}) {
  assertAdminWriteAccess('corp-setup', opts.adminToken);

  const { corpId, corpName = '企业客户', genres = [], dryRun = false } = opts;

  if (!corpId) throw new WecomError('BIZ_NO_CORP_ID', '--corp-id 不能为空');

  // 合法性校验
  const invalidGenres = genres.filter(g => g !== 'general' && !VALID_GENRES.includes(g));
  if (invalidGenres.length > 0) {
    throw new WecomError('BIZ_INVALID_GENRE',
      `无效体裁：${invalidGenres.join(', ')}，合法值：${VALID_GENRES.join(' / ')}`);
  }

  // general 始终启用，不重复添加
  const enabledGenres = [...new Set(['general', ...genres])];

  process.stderr.write(`\n${C.cyan}=== scene-pack:corp-setup ===${C.reset}\n`);
  process.stderr.write(`${C.cyan}企业：${corpName}（${corpId}）${C.reset}\n`);
  process.stderr.write(`${C.cyan}启用体裁：${enabledGenres.join(', ')}${C.reset}\n\n`);

  if (dryRun) {
    process.stderr.write(`${C.gray}[dry-run] 预览模式，不实际创建文档${C.reset}\n\n`);
  }

  // ── Step 1：创建企业覆盖文档 ──────────────────────
  const docTitle = `${corpName}-FBS场景包覆盖文档`;
  let docId = null, docUrl = null;

  if (!dryRun) {
    const { mode } = await assertAuthReady();
    if (mode === 'local') {
      throw new WecomError('BIZ_LOCAL_MODE', '本地模式无法创建企业微信文档，请先完成 wecom-cli init 授权');
    }

    process.stderr.write(`${C.cyan}Step 1：创建企业覆盖文档「${docTitle}」…${C.reset}\n`);
    const docResult = await wecomRun('doc', 'create_doc', {
      doc_type: 4,          // 4 = 智能表格（smartsheet）
      doc_name: docTitle,
    });
    docId  = docResult?.docid  ?? docResult?.doc_id ?? docResult?.id;
    docUrl = docResult?.url    ?? docResult?.doc_url ?? docResult?.share_url;

    if (!docId) {
      throw new WecomError('BIZ_CREATE_DOC_FAILED', '创建企业覆盖文档失败，未返回 docid');
    }
    process.stderr.write(`${C.green}  ✅ 文档已创建：${docUrl ?? docId}${C.reset}\n\n`);
  } else {
    docId  = 'DRY_RUN_DOC_ID';
    docUrl = 'https://doc.weixin.qq.com/smartsheet/DRY_RUN';
    process.stderr.write(`  ✅ [dry-run] 文档标题：${docTitle}\n\n`);
  }

  // ── Step 2：建 7 张 Sheet 结构 ────────────────────
  process.stderr.write(`${C.cyan}Step 2：初始化 Sheet 结构（7 张）…${C.reset}\n`);
  const sheetResults = {};   // { sheetKey: sheet_id }

  if (!dryRun) {
    const schema = fs.existsSync(SCHEMA_PATH)
      ? JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'))
      : null;

    for (const [sheetKey, sheetName] of Object.entries(SHEET_NAMES)) {
      process.stderr.write(`  → 创建 Sheet：${sheetName}… `);
      try {
        const r = await wecomRun('doc', 'smartsheet_add_sheet', {
          docid: docId,
          properties: { title: sheetName },
        });
        const sheetId = r?.sheet_id ?? r?.properties?.sheet_id;
        sheetResults[sheetKey] = sheetId;
        process.stderr.write(`${C.green}✅ ${sheetId}${C.reset}\n`);

        // 添加列定义
        if (schema?.sheets?.[sheetKey]?.columns) {
          await _addColumns(docId, sheetId, schema.sheets[sheetKey].columns);
        }
      } catch (err) {
        process.stderr.write(`${C.yellow}⚠️  失败：${err.message}${C.reset}\n`);
        sheetResults[sheetKey] = null;
      }
    }
  } else {
    for (const sheetKey of Object.keys(SHEET_NAMES)) {
      sheetResults[sheetKey] = `DRY_${sheetKey.toUpperCase()}_SHEET_ID`;
    }
    process.stderr.write(`  ✅ [dry-run] 7 张 Sheet 已规划\n`);
  }
  process.stderr.write('\n');

  // ── Step 3：向每张 Sheet 写入样板行 ─────────────
  process.stderr.write(`${C.cyan}Step 3：写入样板行（帮助管理员理解列结构）…${C.reset}\n`);
  if (!dryRun && sheetResults.quality) {
    await _writeCorpSampleRows(docId, sheetResults);
  } else {
    process.stderr.write(`  ✅ [dry-run] 将写入样板行\n`);
  }
  process.stderr.write('\n');

  // ── Step 4：生成 enterprise.json ─────────────────
  process.stderr.write(`${C.cyan}Step 4：生成 enterprise.json…${C.reset}\n`);

  const packsConfig = {};
  for (const genre of VALID_GENRES) {
    const enabled = enabledGenres.includes(genre);
    const entry = { enabled };
    // 为启用的非 general 体裁配置 corp_sheet_ids 占位
    if (enabled && genre !== 'general') {
      entry.corp_sheet_ids = {};
      for (const sheetKey of ['quality', 'outline', 'search', 'init', 'visual']) {
        entry.corp_sheet_ids[sheetKey] = sheetResults[sheetKey] ?? `FILL_${genre.toUpperCase()}_${sheetKey.toUpperCase()}_SHEET_ID`;
      }
    }
    if (genre === 'general') {
      entry._comment = 'general 永久免费，无需乐包（R1 决议）';
    }
    if (!enabled) {
      entry._comment = `未启用，访问时静默降级到 general`;
    }
    packsConfig[genre] = entry;
  }

  const enterpriseJson = {
    _comment:  `企业版配置文件（corp-setup 自动生成，${new Date().toISOString().slice(0,10)}）`,
    _version:  '2.0',
    corp_id:   corpId,
    corp_name: corpName,
    corp_spreadsheet_id:  docId,
    corp_spreadsheet_url: docUrl,
    permissions: {
      advanced_customization: false,
      advanced_customization_token: '',
      _comment_advanced: '设为 true 可覆盖官方 must 级规则，且 advanced_customization_token 必须与环境变量 FBS_ADVANCED_CUSTOMIZATION_TOKEN 一致',
    },

    packs: packsConfig,
  };

  const enterpriseJsonStr = JSON.stringify(enterpriseJson, null, 2);
  process.stderr.write(`${C.green}  ✅ enterprise.json 已生成${C.reset}\n\n`);

  // ── Step 5：输出交付物 ────────────────────────────
  process.stdout.write([
    '',
    `${'='.repeat(60)}`,
    `✅  ${corpName} 企业覆盖文档交付物`,
    `${'='.repeat(60)}`,
    '',
    `【1】企业微信表格链接（转发给企业管理员，用企业微信账号打开）：`,
    `    ${docUrl ?? docId}`,
    '',
    `【2】enterprise.json（放入 FBS 插件目录 scene-packs/ 下）：`,
    '',
    enterpriseJsonStr,
    '',
    `${'='.repeat(60)}`,
    `📌 企业管理员操作指南：`,
    `   1. 用企业微信账号打开上方表格链接`,
    `   2. 在 quality Sheet 中添加/修改规则行`,
    `      - enabled 列不勾选 = 禁用该规则`,
    `      - level 填 must/should/must-not`,
    `      - stage 填 S0/S1/S2/S3/ALL`,
    `   3. 修改后下次写书时自动生效（缓存 TTL=1天）`,
    `   4. 如需立即生效：删除书目录下 .fbs-wecom-state.json 的 scenePackCache 字段`,
    `${'='.repeat(60)}`,
    '',
  ].join('\n'));

  return { docId, docUrl, enterpriseJson };
}

/**
 * 向企业覆盖文档各 Sheet 写入样板行（让管理员看懂列结构）
 */
async function _writeCorpSampleRows(docId, sheetResults) {
  const samples = {
    quality: {
      sheetId: sheetResults.quality,
      rows: [
        {
          rule_id: 'corp_example_q01',
          genre:   'general',
          stage:   'ALL',
          layer:   'ALL',
          level:   'should',
          content: '（示例）请在此填写企业定制质量规则描述，删除本行后添加真实规则',
          source:  'corp-custom',
          enabled: false,   // 示例行默认禁用
        },
      ],
    },
    outline: {
      sheetId: sheetResults.outline,
      rows: [
        {
          tpl_id:            'corp_example_ch01',
          genre:             'general',
          order:             99,
          name:              '（示例）企业定制章节模板',
          word_min:          1000,
          word_max:          3000,
          required_elements: '（示例）必要元素1；必要元素2',
          source:            'corp-custom',
          enabled:           false,
        },
      ],
    },
    init: {
      sheetId: sheetResults.init,
      rows: [
        {
          init_id:  'corp_example_q01',
          genre:    'general',
          question: '（示例）企业定制收集问题，删除本行后添加真实问题',
          required: false,
          order:    99,
          source:   'corp-custom',
          enabled:  false,
        },
      ],
    },
    search: {
      sheetId: sheetResults.search,
      rows: [
        {
          search_id:         'corp_example_s01',
          genre:             'general',
          stage:             'ALL',
          max_per_chapter:   3,
          preferred_sources: '（示例）企业内部知识库；行业报告',
          required_sources:  '',
          source:            'corp-custom',
          enabled:           false,
        },
      ],
    },
    visual: {
      sheetId: sheetResults.visual,
      rows: [
        {
          visual_id:   'corp_example_v01',
          genre:       'general',
          chart_type:  '（示例）企业定制图表类型',
          trigger:     '（示例）触发条件描述',
          description: '（示例）图表用途说明',
          source:      'corp-custom',
          enabled:     false,
        },
      ],
    },
  };

  for (const [sheetKey, { sheetId, rows }] of Object.entries(samples)) {
    if (!sheetId) continue;
    process.stderr.write(`  → 写入 ${sheetKey} 样板行… `);
    try {
      await wecomRun('doc', 'smartsheet_add_records', {
        docid:    docId,
        sheet_id: sheetId,
        key_type: 'field_title',
        records:  rows.map(values => ({ values })),
      });
      process.stderr.write(`${C.green}✅${C.reset}\n`);
    } catch (err) {
      process.stderr.write(`${C.yellow}⚠️  ${err.message}${C.reset}\n`);
    }
  }
}



if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args  = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--') && !a.includes('=')));
  const kvs   = Object.fromEntries(
    args.filter(a => a.startsWith('--') && a.includes('=')).map(a => {
      const raw = a.replace(/^--/, '');
      const eq  = raw.indexOf('=');
      return [raw.slice(0, eq), raw.slice(eq + 1)];
    })
  );
  const pos = args.filter(a => !a.startsWith('--'));
  const cmd = pos[0];

  const run = async () => {
    switch (cmd) {
      case 'check':
        if (!checkConfig()) {
          process.exit(1);
        }
        break;

      case 'init':
        await initSheets({
          official: flags.has('--official'),
          corp:     flags.has('--corp'),
          adminToken: kvs['admin-token'] ?? '',
        });
        break;

      case 'push': {
        const genre = pos[1];
        if (!genre) {
          process.stderr.write(`${C.red}用法：scene-pack-admin.mjs push <genre> [--dry-run]${C.reset}\n`);
          process.exit(1);
        }
        await pushLocalRules(genre, {
          dryRun: flags.has('--dry-run'),
          adminToken: kvs['admin-token'] ?? '',
        });
        break;
      }

      case 'status':
        showStatus();
        break;

      case 'commercial-init':
        await initCommercialHub({
          adminToken: kvs['admin-token'] ?? '',
        });
        break;

      case 'commercial-seed':
        await seedCommercialHub({
          sheetId: kvs['sheet-id'] ?? '',
          adminToken: kvs['admin-token'] ?? '',
        });
        break;

      case 'commercial-check':
        await checkCommercialHub({
          sheetId: kvs['sheet-id'] ?? '',
        });
        break;

      case 'commercial-get-balance':
        await getCommercialBalance({
          userId: kvs['user-id'] ?? '',
        });
        break;

      case 'commercial-add-code':
        await addCommercialCode({
          code: kvs['code'] ?? '',
          codeType: kvs['code-type'] ?? 'CRD',
          redeemTarget: kvs['redeem-target'] ?? '',
          corpId: kvs['corp-id'] ?? '',
          force: flags.has('--force'),
          status: kvs['status'] ?? 'active',
          source: kvs['source'] ?? 'admin',
          operator: kvs['operator'] ?? 'admin',
          note: kvs['note'] ?? '',
          sheetId: kvs['sheet-id'] ?? '',
          adminToken: kvs['admin-token'] ?? '',
        });
        break;

      case 'commercial-add-ledger':
        await addCommercialLedger({
          userId: kvs['user-id'] ?? '',
          corpId: kvs['corp-id'] ?? '',
          genre: kvs['genre'] ?? '',
          event: kvs['event'] ?? 'manual_adjust',
          delta: kvs['delta'] ?? '0',
          requestId: kvs['request-id'] ?? '',
          note: kvs['note'] ?? '',
          operator: kvs['operator'] ?? 'admin',
          sheetId: kvs['sheet-id'] ?? '',
          adminToken: kvs['admin-token'] ?? '',
        });
        break;

      case 'commercial-redeem-code':
        await redeemCommercialCode({
          userId: kvs['user-id'] ?? '',
          code: kvs['code'] ?? '',
          corpId: kvs['corp-id'] ?? '',
          requestId: kvs['request-id'] ?? '',
          operator: kvs['operator'] ?? 'admin',
          sheetId: kvs['sheet-id'] ?? '',
          adminToken: kvs['admin-token'] ?? '',
        });
        break;

      case 'corp-setup': {
        const corpId   = kvs['corp-id'];
        const corpName = kvs['name'] ?? '企业客户';
        const genreStr = kvs['genres'] ?? '';
        const genres   = genreStr ? genreStr.split(',').map(s => s.trim()).filter(Boolean) : [...VALID_GENRES];
        if (!corpId) {
          process.stderr.write(
            `${C.red}用法：scene-pack-admin.mjs corp-setup --corp-id=ww_xxx [--name="企业名称"] [--genres="genealogy,training"] [--dry-run]${C.reset}\n`
          );
          process.exit(1);
        }
        await corpSetup({
          corpId,
          corpName,
          genres,
          dryRun: flags.has('--dry-run'),
          adminToken: kvs['admin-token'] ?? '',
        });
        break;
      }

      default:
        process.stderr.write([
          '',
          `${C.cyan}FBS 场景包管理工具${C.reset}`,
          '',
          '用法：',
          '  node scripts/wecom/scene-pack-admin.mjs check                          校验本地配置',
          '  node scripts/wecom/scene-pack-admin.mjs init --official [--admin-token=***]  初始化官方表格 Sheet 结构',
          '  node scripts/wecom/scene-pack-admin.mjs init --corp [--admin-token=***]      初始化企业覆盖文档 Sheet 结构',
          '  node scripts/wecom/scene-pack-admin.mjs push <genre> [--admin-token=***]      推送内置规范到官方表格',
          '  node scripts/wecom/scene-pack-admin.mjs push <genre> --dry-run [--admin-token=***]  预览推送内容',
          '  node scripts/wecom/scene-pack-admin.mjs status                              查看缓存状态',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-init [--admin-token=***]  初始化商业化单表 commercial_hub',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-seed [--sheet-id=xxxx] [--admin-token=***]  写入商业化种子规则',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-check [--sheet-id=xxxx]  商业化单表健康检查（只读）',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-get-balance --user-id=u1  查询用户余额（基于本地缓存）',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-add-code --code=XXXX --code-type=CRD --redeem-target=credits:500 [--force] [--admin-token=***]',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-add-ledger --user-id=u1 --delta=10 [--event=manual_adjust] [--request-id=req1] [--admin-token=***]',
          '  node scripts/wecom/scene-pack-admin.mjs commercial-redeem-code --user-id=u1 --code=XXXX [--request-id=req1] [--admin-token=***]',
          '  node scripts/wecom/scene-pack-admin.mjs corp-setup --corp-id=ww_xxx [--admin-token=***]  为企业一键交付覆盖文档',
          '    [--name="企业名称"] [--genres="genealogy,training"] [--dry-run]',
          `  写操作口令环境变量：${ADMIN_TOKEN_ENV}`, 
          '',
          `合法体裁：${VALID_GENRES.join(' / ')}`,
          '',
        ].join('\n'));
    }
  };

  run().catch(err => {
    process.stderr.write(`${C.red}[ERROR] ${err.message}${C.reset}\n`);
    process.exit(1);
  });
}
