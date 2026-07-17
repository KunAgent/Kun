#!/usr/bin/env node
/**
 * scripts/wecom/lib/scene-pack-schema.mjs
 * 场景包 Schema 定义、合并逻辑、权限门禁（评审决议 R2/R5/R8）
 *
 * 架构：主从文档模型
 *   官方文档（FBS 维护）→ registry.official_spreadsheet_id
 *   企业覆盖文档       → enterprise.json corp_spreadsheet_id
 *
 * 7 张 Sheet：meta / init / outline / quality / search / visual / entitlement
 *
 * 合并规则（R8）：
 *   - 以 rule_id / tpl_id / prompt_id 为主键
 *   - 企业覆盖文档 source 固定为 corp-custom
 *   - enabled=0 的条目从合并结果中删除
 *   - 覆盖 official must 需要 advanced_customization 权限
 */

import { WecomError, appendAuditLog, C } from './utils.mjs';

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

/** 合法体裁列表（评审决议 R2） */
export const VALID_GENRES = [
  'genealogy',      // 家谱（100 个乐包）
  'consultant',     // 创业顾问（200 个乐包）
  'ghostwriter',    // 代撰稿·章节级产品（200 个乐包，R3）
  'whitepaper',     // 白皮书（200 个乐包）
  'report',         // 报告（200 个乐包）
  'training',       // 企业培训（300 个乐包）
  'personal-book',  // 个人出书（500 个乐包）
  'general',        // 通用兜底（0 个乐包，永久免费，R1）
];

/** Sheet 名称映射 */
export const SHEET_NAMES = {
  meta:        'meta',
  init:        'init',
  outline:     'outline',
  quality:     'quality',
  search:      'search',
  visual:      'visual',
  entitlement: 'entitlement',
};

/** quality level 级别权重（用于权限检查） */
const LEVEL_WEIGHT = { 'must': 3, 'should': 2, 'must-not': 3 };

// ─────────────────────────────────────────────
// 从表格记录解析各 Sheet 数据
// ─────────────────────────────────────────────

/**
 * 从 wecomRun 返回的 records 数组解析 quality 条目
 * @param {object[]} records
 * @returns {object[]}
 */
export function parseQualitySheet(records) {
  return records
    .map(r => {
      // wecom-cli 0.1.4: get_records 返回 record.values（直接值），
      // 文本字段直接是字符串，checkbox 字段是 boolean。
      // 兼容旧格式 record.fields[k].value（防御性回退）。
      const v = r.values ?? {};
      const f = r.fields ?? {};
      const val = k => {
        if (v[k] !== undefined && v[k] !== null) return v[k];
        if (f[k] !== undefined && f[k] !== null) return f[k]?.value ?? f[k];
        return null;
      };
      return {
        rule_id: val('rule_id'),
        genre:   val('genre') ?? 'ALL',
        stage:   val('stage') ?? 'ALL',
        layer:   val('layer') ?? 'ALL',   // S/P/C/B/ALL
        level:   val('level') ?? 'should',
        content: val('content') ?? '',
        source:  val('source') ?? 'official',
        enabled: val('enabled') !== false && String(val('enabled') ?? '1') !== '0',
      };
    })
    .filter(e => e.rule_id && e.content);
}

/**
 * 从 records 解析 outline 条目
 * 注意：outline 无 stage 过滤，全量返回（R8 决议）
 * @param {object[]} records
 * @returns {object[]}
 */
export function parseOutlineSheet(records) {
  return records
    .map(r => {
      const v = r.values ?? {};
      const f = r.fields ?? {};
      const val = k => {
        if (v[k] !== undefined && v[k] !== null) return v[k];
        if (f[k] !== undefined && f[k] !== null) return f[k]?.value ?? f[k];
        return null;
      };
      return {
        tpl_id:            val('tpl_id'),
        genre:             val('genre') ?? 'ALL',
        order:             Number(val('order') ?? 999),
        name:              val('name') ?? '',
        word_min:          Number(val('word_min') ?? 0),
        word_max:          Number(val('word_max') ?? 0),
        required_elements: String(val('required_elements') ?? '').split(';').filter(Boolean),
        source:            val('source') ?? 'official',
        enabled:           val('enabled') !== false && String(val('enabled') ?? '1') !== '0',
      };
    })
    .filter(e => e.tpl_id && e.name)
    .sort((a, b) => a.order - b.order);
}

/**
 * 从 records 解析 search 条目
 * @param {object[]} records
 * @returns {object[]}
 */
export function parseSearchSheet(records) {
  return records
    .map(r => {
      const v = r.values ?? {};
      const f = r.fields ?? {};
      const val = k => {
        if (v[k] !== undefined && v[k] !== null) return v[k];
        if (f[k] !== undefined && f[k] !== null) return f[k]?.value ?? f[k];
        return null;
      };
      return {
        search_id:          val('search_id'),
        genre:              val('genre') ?? 'ALL',
        stage:              val('stage') ?? 'ALL',
        max_per_chapter:    Number(val('max_per_chapter') ?? 5),
        preferred_sources:  String(val('preferred_sources') ?? '').split(';').filter(Boolean),
        required_sources:   String(val('required_sources') ?? '').split(';').filter(Boolean),
        source:             val('source') ?? 'official',
        enabled:            val('enabled') !== false && String(val('enabled') ?? '1') !== '0',
      };
    })
    .filter(e => e.search_id);
}

/**
 * 从 records 解析 init 条目
 * @param {object[]} records
 * @returns {object[]}
 */
export function parseInitSheet(records) {
  return records
    .map(r => {
      const v = r.values ?? {};
      const f = r.fields ?? {};
      const val = k => {
        if (v[k] !== undefined && v[k] !== null) return v[k];
        if (f[k] !== undefined && f[k] !== null) return f[k]?.value ?? f[k];
        return null;
      };
      return {
        init_id:   val('init_id'),
        genre:     val('genre') ?? 'ALL',
        question:  val('question') ?? '',
        required:  val('required') !== false && String(val('required') ?? '1') !== '0',
        order:     Number(val('order') ?? 999),
        source:    val('source') ?? 'official',
        enabled:   val('enabled') !== false && String(val('enabled') ?? '1') !== '0',
      };
    })
    .filter(e => e.init_id && e.question)
    .sort((a, b) => a.order - b.order);
}

/**
 * 从 records 解析 visual 条目
 * @param {object[]} records
 * @returns {object[]}
 */
export function parseVisualSheet(records) {
  return records
    .map(r => {
      const v = r.values ?? {};
      const f = r.fields ?? {};
      const val = k => {
        if (v[k] !== undefined && v[k] !== null) return v[k];
        if (f[k] !== undefined && f[k] !== null) return f[k]?.value ?? f[k];
        return null;
      };
      return {
        visual_id:   val('visual_id'),
        genre:       val('genre') ?? 'ALL',
        chart_type:  val('chart_type') ?? '',
        trigger:     val('trigger') ?? '',
        description: val('description') ?? '',
        source:      val('source') ?? 'official',
        enabled:     val('enabled') !== false && String(val('enabled') ?? '1') !== '0',
      };
    })
    .filter(e => e.visual_id && e.chart_type);
}

/**
 * 从 records 解析 entitlement 条目
 * @param {object[]} records
 * @returns {object[]}
 */
export function parseEntitlementSheet(records) {
  return records
    .map(r => {
      const v = r.values ?? {};
      const f = r.fields ?? {};
      const val = k => {
        if (v[k] !== undefined && v[k] !== null) return v[k];
        if (f[k] !== undefined && f[k] !== null) return f[k]?.value ?? f[k];
        return null;
      };
      return {
        genre:            val('genre'),
        credits_required: Number(val('credits_required') ?? 0),
        trial_allowed:    val('trial_allowed') === true  || String(val('trial_allowed') ?? '0') !== '0',
        enterprise_only:  val('enterprise_only') === true || String(val('enterprise_only') ?? '0') !== '0',
      };
    })
    .filter(e => e.genre);
}

// ─────────────────────────────────────────────
// 主从合并逻辑（R8）
// ─────────────────────────────────────────────

function hasAdvancedCustomizationPermission(corpConfig) {
  const enabled = corpConfig?.permissions?.advanced_customization === true;
  if (!enabled) return false;
  const tokenInConfig = String(corpConfig?.permissions?.advanced_customization_token ?? '').trim();
  const tokenInEnv = String(process.env.FBS_ADVANCED_CUSTOMIZATION_TOKEN ?? '').trim();
  if (!tokenInConfig || !tokenInEnv) return false;
  return tokenInConfig === tokenInEnv;
}


/**
 * 合并官方数据与企业覆盖数据
 *
 * @param {object} official   - 官方各 Sheet 解析结果 { quality, outline, search, init, visual }
 * @param {object} corpOverride - 企业覆盖各 Sheet（可为 null）
 * @param {object} corpConfig - enterprise.json 配置（含 permissions）
 * @param {string} bookRoot   - 用于写 audit log
 * @returns {object}          - 合并后的完整场景包数据
 */
export function mergeScenePack(official, corpOverride, corpConfig, bookRoot) {
  const hasAdvanced = hasAdvancedCustomizationPermission(corpConfig);

  return {

    quality:  _mergeByKey(official.quality,  corpOverride?.quality,  'rule_id',  hasAdvanced, bookRoot, 'quality'),
    outline:  _mergeByKey(official.outline,  corpOverride?.outline,  'tpl_id',   hasAdvanced, bookRoot, 'outline'),
    search:   _mergeByKey(official.search,   corpOverride?.search,   'search_id', hasAdvanced, bookRoot, 'search'),
    init:     _mergeByKey(official.init,     corpOverride?.init,     'init_id',   hasAdvanced, bookRoot, 'init'),
    visual:   _mergeByKey(official.visual,   corpOverride?.visual,   'visual_id', hasAdvanced, bookRoot, 'visual'),
  };
}

/**
 * 按主键合并两个条目数组
 * - 企业 enabled=0 → 从结果中删除该条目
 * - 企业同 ID → 覆盖官方（受权限限制）
 * - 企业新 ID → 追加
 */
function _mergeByKey(officialItems, corpItems, keyField, hasAdvanced, bookRoot, sheetName) {
  // 以官方为基础建 Map
  const map = new Map();
  for (const item of (officialItems ?? [])) {
    if (item.enabled !== false) {
      map.set(item[keyField], { ...item });
    }
  }

  for (const corpItem of (corpItems ?? [])) {
    const id = corpItem[keyField];
    if (!id) continue;

    // enabled=0：企业要求删除该条目
    if (corpItem.enabled === false) {
      const existing = map.get(id);
      // 官方 must 级规则：删除操作同样需要 advanced_customization 权限
      if (
        existing &&
        existing.source === 'official' &&
        existing.level &&
        (LEVEL_WEIGHT[existing.level] ?? 0) >= 3 &&
        !hasAdvanced
      ) {
        if (bookRoot) {
          appendAuditLog(bookRoot, {
            event: 'scene_pack_delete_denied',
            sheet: sheetName,
            id,
            reason: 'advanced_customization required to delete must-level official rule',
          });
        }
        process.stderr.write(
          `${C.yellow}[scene-pack] 企业删除被拒（需 advanced_customization）：${sheetName}.${id}${C.reset}\n`
        );
        continue;
      }
      map.delete(id);
      continue;
    }

    const existing = map.get(id);

    if (existing) {
      // 覆盖场景：检查 must 级别权限
      if (
        existing.source === 'official' &&
        existing.level &&
        (LEVEL_WEIGHT[existing.level] ?? 0) >= 3 &&
        !hasAdvanced
      ) {
        // 无权限：跳过覆盖，写 audit warn
        if (bookRoot) {
          appendAuditLog(bookRoot, {
            event: 'scene_pack_override_denied',
            sheet: sheetName,
            id,
            reason: 'advanced_customization required to override must-level official rule',
          });
        }
        process.stderr.write(
          `${C.yellow}[scene-pack] 企业覆盖被拒（需 advanced_customization）：${sheetName}.${id}${C.reset}\n`
        );
        continue;
      }
      // 有权限或非 must 级别：合并覆盖（企业字段覆盖官方，保留官方未覆盖字段）
      map.set(id, { ...existing, ...corpItem, source: 'corp-custom' });
    } else {
      // 新增条目
      map.set(id, { ...corpItem, source: 'corp-custom' });
    }
  }

  return Array.from(map.values());
}

// ─────────────────────────────────────────────
// 按体裁 / 阶段过滤
// ─────────────────────────────────────────────

/**
 * 从合并后数据中提取指定体裁和阶段的场景包
 *
 * @param {object} merged  - mergeScenePack 返回值
 * @param {string} genre   - 目标体裁
 * @param {string|null} stage - 阶段过滤（null=全量）
 * @returns {object}       - { quality, outline, search, init, visual }
 */
export function filterByGenreAndStage(merged, genre, stage) {
  const matchGenre = item =>
    !item.genre || item.genre === genre || item.genre === 'ALL';

  const matchStage = item =>
    !stage || !item.stage || item.stage === stage || item.stage === 'ALL';

  return {
    // outline 无 stage 过滤（R8 决议：全量返回）
    outline: merged.outline.filter(matchGenre),
    quality: merged.quality.filter(matchGenre).filter(matchStage),
    search:  merged.search.filter(matchGenre).filter(matchStage),
    init:    merged.init.filter(matchGenre),
    visual:  merged.visual.filter(matchGenre),
  };
}

// ─────────────────────────────────────────────
// 格式化为 Markdown（供模型注入）
// ─────────────────────────────────────────────

/**
 * 将过滤后的场景包数据格式化为可注入 Markdown 文本
 *
 * @param {object} filtered  - filterByGenreAndStage 返回值
 * @param {object} meta      - { genre, label, version, cachedAt, degraded?, degradeReason? }
 * @returns {string}
 */
export function formatPackAsMarkdown(filtered, meta) {
  const { genre, label, version, cachedAt, degraded, degradeReason } = meta;
  const date = cachedAt
    ? new Date(cachedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const header = degraded
    ? `> **场景包**：${label}（本地内置规范）· 已降级（${degradeReason ?? '网络不可用'}）`
    : `> **场景包**：${label} · v${version ?? 'N/A'} · ${date} · 体裁：${genre}`;

  const sections = [];

  // 初始化问题（S0）
  if (filtered.init?.length) {
    const lines = filtered.init
      .map((q, i) => `${i + 1}. ${q.question}${q.required ? '（必填）' : '（可选）'}`)
      .join('\n');
    sections.push(`### 初始化收集要点\n\n${lines}`);
  }

  // 大纲结构（S2）
  if (filtered.outline?.length) {
    const lines = filtered.outline
      .map(t => {
        const wordRange = t.word_max > 0 ? `（${t.word_min}–${t.word_max}字）` : '';
        const elems = t.required_elements?.length ? `\n   必须包含：${t.required_elements.join(' / ')}` : '';
        return `- **${t.name}**${wordRange}${elems}`;
      })
      .join('\n');
    sections.push(`### 大纲结构\n\n${lines}`);
  }

  // 质量规则
  if (filtered.quality?.length) {
    const byLayer = {};
    for (const r of filtered.quality) {
      const layer = r.layer ?? 'ALL';
      (byLayer[layer] = byLayer[layer] ?? []).push(r);
    }
    const layerLines = Object.entries(byLayer).map(([layer, rules]) => {
      const ruleLines = rules
        .map(r => `  - [${r.level.toUpperCase()}] ${r.content}`)
        .join('\n');
      return `#### 审校层 ${layer}\n\n${ruleLines}`;
    }).join('\n\n');
    sections.push(`### 质量规则\n\n${layerLines}`);
  }

  // 检索策略
  if (filtered.search?.length) {
    const s = filtered.search[0]; // 取第一条（最具代表性）
    const preferred = s.preferred_sources?.join(' / ') ?? '';
    const required  = s.required_sources?.join(' / ')  ?? '';
    const lines = [
      `每章最多检索 **${s.max_per_chapter}** 次`,
      preferred ? `优先来源：${preferred}` : null,
      required  ? `必须引用：${required}`  : null,
    ].filter(Boolean).join('\n- ');
    sections.push(`### 检索策略\n\n- ${lines}`);
  }

  // 可视化建议
  if (filtered.visual?.length) {
    const lines = filtered.visual
      .map(v => `- **${v.chart_type}**：${v.description}`)
      .join('\n');
    sections.push(`### 可视化建议\n\n${lines}`);
  }

  const body = sections.join('\n\n---\n\n');
  return `${header}\n\n${body}`;
}
