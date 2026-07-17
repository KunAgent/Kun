#!/usr/bin/env node

/**
 * Phase 1 强制门控 — 落盘后必须通过此 gate 才能进入 Phase 2
 *
 * 设计依据：
 *   - plugins/cpq/skills/cpq/references/how-to-parse-product-list.md §阶段 D.4
 *   - docs/cpq/phase1-refactor/gate-script-spec.md
 *   - docs/cpq/phase1-refactor/phase1-done-fields.md
 *
 * 本 gate 是 Phase 1 重构后的第一道机审防线，覆盖 5 类历史违规模式：
 *   V1 删除产品中文全名 → 组 D.6 必含 IDENTIFIER 校验
 *   V2 地域塞进搜索关键词 → 组 D.1/D.2 LOCATION 黑名单
 *   V3 未拆伴生产品 → 组 C.2/C.3 反向印证 companion_expanded
 *   V4 凭常识默认售卖模式 → 组 B.8 ambiguity_resolved 校验
 *   V5 丢失非结构化语义列 → 组 B.9 unmapped_columns 必填
 *
 * 退出码：
 *   0 = 通过（可进 Phase 2）
 *   1 = 脚本自身错误（CPQ_SESSION_DIR 参数缺失 / 不可读等）
 *   2 = 校验失败（stderr 给出具体 finding 列表）
 *
 * 用法：
 *   node scripts/check-phase1.mjs --session-dir <CPQ_SESSION_DIR>
 *
 *   # 仅报告不阻断（debug / dry-run，不允许 AI 主流程使用）
 *   node scripts/check-phase1.mjs --session-dir <CPQ_SESSION_DIR> --report
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// ============================================================================
// 配置：黑名单词典（v1 硬编码，后续从 references/data/phase1-token-dict/ 加载）
// ============================================================================

// LOCATION 黑名单（cn 国内站常见地域）
const LOCATION_CN = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '成都',
  '重庆',
  '杭州',
  '南京',
  '武汉',
  '西安',
  '青岛',
  '天津',
  '长沙',
  '济南',
  '苏州',
  '福州',
  '厦门',
  '合肥',
  '太原',
  '郑州',
  '昆明',
  '中卫',
  '清远',
  '香港',
  '台北',
  '澳门',
  '中国香港',
];

// LOCATION 黑名单（intl 国际站 18 个地域）
const LOCATION_INTL = [
  'Singapore',
  'Tokyo',
  'Seoul',
  'Frankfurt',
  'Silicon Valley',
  'Bangkok',
  'Mumbai',
  'Hong Kong',
  'Virginia',
  'Toronto',
  'Dubai',
  'Jakarta',
  'Sao Paulo',
  'Sydney',
  'Moscow',
  'Riyadh',
  'Johannesburg',
  'Tel Aviv',
  '新加坡',
  '东京',
  '首尔',
  '法兰克福',
  '硅谷',
  '曼谷',
  '孟买',
  '弗吉尼亚',
  '多伦多',
  '迪拜',
  '雅加达',
  '圣保罗',
  '悉尼',
  '莫斯科',
];

// BILLING 黑名单
const BILLING_TOKENS = [
  '包年包月',
  '按量计费',
  '按量',
  '预付费',
  '后付费',
  '竞价',
  '竞价实例',
  '包销',
  '预留',
  '容量预留',
  '节省计划',
];

// PERFORMANCE_FILTER 模式
const PERFORMANCE_FILTER_PATTERNS = [
  /不低于/,
  /至少/,
  /≥/,
  />=/,
  /大于/,
  /不超过/,
  /至多/,
  /≤/,
  /<=/,
  /小于/,
  /及以上/,
  /及以下/,
];

// QUANTITY 模式
const QUANTITY_PATTERN = /\d+\s*(台|节点|实例|个|套|份|件)/;

// ============================================================================
// 纯校验入口（可单测）：输入 phase1.md 文本 → { ok, findings }
//   - 不含文件 I/O：A.1（文件存在性）属 CLI 职责，见下方 main()
//   - 调用方拿 findings 自行决定输出 / 退出码
// ============================================================================

export function validatePhase1(content) {
  const findings = [];

  // 组 A（内容部分）· 首行 site / version + phase1-done 标记
  if (!checkHeader(content, findings)) {
    return { ok: false, findings };
  }

  const parsed = parsePhase1Markdown(content);
  if (parsed.parseError) {
    findings.push({
      code: 'PHASE1_PARSE_ERROR',
      level: 'fail',
      message: `phase1.md 解析失败：${parsed.parseError}`,
      fix: '检查表格结构：必须有表头行 + 分隔行（|---|）+ 数据行；首行必须是 <!-- site: cn|intl version=2 -->',
    });
    return { ok: false, findings };
  }

  // 组 B · phase1-done 字段完备性
  checkGroupB(parsed, findings);
  // 组 C · 反向印证
  checkGroupC(parsed, findings);
  // 组 D · 搜索关键词白名单
  checkGroupD(parsed, findings);
  // 组 E · row_id / status 状态机
  checkGroupE(parsed, findings);

  return { ok: findings.every((f) => f.level !== 'fail'), findings };
}

// ============================================================================
// CLI 主流程（仅在脚本被直接运行时执行）
// ============================================================================

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main() {
  const ARGS = parseArgs(process.argv.slice(2));

  if (ARGS.help) {
    printUsage();
    process.exit(0);
  }

  if (!ARGS.sessionDir) {
    printUsage();
    process.exit(1);
  }

  const sessionDir = ARGS.sessionDir;
  if (!isAbsolute(sessionDir)) {
    err(`--session-dir 必须是绝对路径，收到：${sessionDir}`);
    process.exit(1);
  }
  if (!existsSync(sessionDir)) {
    err(`CPQ_SESSION_DIR 不存在：${sessionDir}`);
    err('  → 先跑：node scripts/resolve-session-dir.mjs');
    process.exit(1);
  }

  const phase1Path = join(sessionDir, 'phase1.md');

  // 组 A.1 · 文件存在性（文件 I/O，留在 CLI）
  if (!existsSync(phase1Path)) {
    emitAndExit(
      [
        {
          code: 'A.1',
          level: 'fail',
          message: `${phase1Path} 不存在 — Phase 1 解析未落盘`,
          fix: '回到 Phase 1，按 how-to-parse-product-list.md 解析输入清单并落盘 phase1.md',
        },
      ],
      sessionDir,
      ARGS,
    );
    return;
  }

  const content = readFileSync(phase1Path, 'utf-8');
  const { findings } = validatePhase1(content);
  emitAndExit(findings, sessionDir, ARGS);
}

function emitAndExit(findings, sessionDir, ARGS) {
  const failed = findings.filter((f) => f.level === 'fail');
  const warnings = findings.filter((f) => f.level === 'warn');

  if (ARGS.report) {
    printReport(findings);
    process.exit(0);
  }

  if (failed.length > 0) {
    err(`❌ phase1.md 校验未通过（${failed.length} 项违规）：\n`);
    for (const f of failed) {
      err(`  · [${f.code}] ${f.message}`);
      if (f.location) err(`    位置：${f.location}`);
      if (f.fix) err(`    修复：${f.fix}`);
    }
    err('');
    err('完整契约见：plugins/cpq/skills/cpq/references/how-to-parse-product-list.md');
    err('字段定义见：docs/cpq/phase1-refactor/phase1-done-fields.md');
    process.exit(2);
  }

  if (warnings.length > 0) {
    err(`⚠️ 通过门控但有 ${warnings.length} 项 warning：`);
    for (const w of warnings) err(`  · [${w.code}] ${w.message}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        session_dir: sessionDir,
        checks: findings.map((f) => ({ code: f.code, level: f.level, message: f.message })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ============================================================================
// 组 A（内容部分）· 首行 site / version + phase1-done 标记
// ============================================================================

function checkHeader(content, findings) {
  // A.2 + A.3 首行匹配 + version
  const headerMatch = content.match(/^<!--\s*site:\s*(cn|intl)(?:\s+version=(\d+))?\s*-->/);
  if (!headerMatch) {
    findings.push({
      code: 'A.2',
      level: 'fail',
      message: 'phase1.md 首行格式错误或缺失',
      fix: '首行必须是 <!-- site: cn|intl version=2 -->',
    });
    return false;
  }

  const version = headerMatch[2] ? parseInt(headerMatch[2], 10) : null;
  if (version === null) {
    findings.push({
      code: 'A.3',
      level: 'fail',
      message: 'phase1.md uses old format (no version field)',
      fix: '请重跑 Phase 1：本 gate 仅支持 version=2；老格式必须强制升级（决策 8）',
    });
    return false;
  }
  if (version !== 2) {
    findings.push({
      code: 'A.3',
      level: 'fail',
      message: `phase1.md version=${version}，本 gate 仅支持 version=2`,
      fix: '检查 SKILL 文档版本，按当前 v2 schema 重新落盘',
    });
    return false;
  }

  // A.4 phase1-done 标记
  if (!/<!--\s*phase1-done:/.test(content)) {
    findings.push({
      code: 'A.4',
      level: 'fail',
      message: 'phase1.md 缺少 <!-- phase1-done: ... --> 标记',
      fix: '在文件末尾追加 phase1-done 标记，字段定义见 docs/cpq/phase1-refactor/phase1-done-fields.md',
    });
    return false;
  }

  return true;
}

// ============================================================================
// Markdown 解析
// ============================================================================

function parsePhase1Markdown(content) {
  // 提取 site / version
  const headerMatch = content.match(/^<!--\s*site:\s*(cn|intl)\s+version=(\d+)\s*-->/);
  const site = headerMatch ? headerMatch[1] : null;
  const version = headerMatch ? parseInt(headerMatch[2], 10) : null;

  // 提取 phase1-done 字段
  const doneMatch = content.match(/<!--\s*phase1-done:\s*([\s\S]*?)\s*-->/);
  if (!doneMatch) {
    return { parseError: '缺少 phase1-done 标记' };
  }
  const doneFields = parseFieldsBlock(doneMatch[1]);

  // 提取 update_history 字段
  const historyMatch = content.match(/<!--\s*update_history:\s*([\s\S]*?)\s*-->/);
  const historyText = historyMatch ? historyMatch[1] : '';
  const historyEntries = parseHistoryEntries(historyText);

  // 提取表格行
  const lines = content.split('\n');
  const rows = [];
  let headers = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;

    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

    // 跳过分隔行（|---|---|）
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;

    if (!headers) {
      headers = cells;
    } else {
      const row = {};
      for (let j = 0; j < headers.length && j < cells.length; j++) {
        row[headers[j]] = cells[j];
      }
      rows.push(row);
    }
  }

  return {
    site,
    version,
    doneFields,
    historyEntries,
    rows,
  };
}

function parseFieldsBlock(text) {
  const fields = {};
  const tokens = text.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq > 0) {
      fields[tok.slice(0, eq)] = tok.slice(eq + 1);
    }
  }
  return fields;
}

function parseHistoryEntries(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 形如：2026-06-18T15:00:00 init
    // 或：2026-06-18T15:30:12 append:r004 reason="..."
    const m = trimmed.match(/^(\S+)\s+(\w+)(?::(\S+))?(?:\s+(.+))?$/);
    if (m) {
      entries.push({
        timestamp: m[1],
        action: m[2],
        rowId: m[3] || null,
        rest: m[4] || '',
      });
    }
  }
  return entries;
}

// ============================================================================
// 组 B · phase1-done 字段完备性
// ============================================================================

function checkGroupB(parsed, findings) {
  const required = [
    { key: 'total', validator: isInt, code: 'B.1' },
    { key: 'version', validator: (v) => v === '2', code: 'B.2' },
    { key: 'tencent', validator: isInt, code: 'B.3' },
    { key: 'competitor', validator: isInt, code: 'B.3' },
    { key: 'merged_flatten', validator: (v) => ['yes', 'no', 'n/a'].includes(v), code: 'B.4' },
    { key: 'source_rows', validator: isInt, code: 'B.5' },
    { key: 'region_expanded', validator: isInt, code: 'B.6' },
    { key: 'companion_expanded', validator: isInt, code: 'B.7' },
    { key: 'ambiguity_resolved', validator: (v) => ['yes', 'no'].includes(v), code: 'B.8' },
    { key: 'unmapped_columns', validator: isInt, code: 'B.9' },
    { key: 'search_keyword_lint', validator: (v) => ['pass', 'fail'].includes(v), code: 'B.10' },
    { key: 'inferred_count', validator: isInt, code: 'B.11' },
    {
      key: 'step_input_normalized',
      validator: (v) => ['yes', 'no', 'n/a'].includes(v),
      code: 'B.12',
    },
    { key: 'step_token_classified', validator: (v) => ['yes', 'no'].includes(v), code: 'B.13' },
    { key: 'step_companion_expanded', validator: (v) => ['yes', 'n/a'].includes(v), code: 'B.14' },
    { key: 'step_ambiguity_resolved', validator: (v) => ['yes', 'no'].includes(v), code: 'B.15' },
  ];

  for (const r of required) {
    const value = parsed.doneFields[r.key];
    if (value === undefined) {
      findings.push({
        code: r.code,
        level: 'fail',
        message: `phase1-done 缺少字段：${r.key}`,
        fix: '所有 phase1-done 字段必填，详见 docs/cpq/phase1-refactor/phase1-done-fields.md',
      });
    } else if (!r.validator(value)) {
      findings.push({
        code: r.code,
        level: 'fail',
        message: `phase1-done.${r.key}=${value} 取值非法`,
        fix: '取值约束见 docs/cpq/phase1-refactor/phase1-done-fields.md',
      });
    }
  }

  // B.3 计数一致性：tencent + competitor = total（不计 removed 行）
  if (parsed.doneFields.tencent && parsed.doneFields.competitor && parsed.doneFields.total) {
    const t = parseInt(parsed.doneFields.tencent, 10);
    const c = parseInt(parsed.doneFields.competitor, 10);
    const total = parseInt(parsed.doneFields.total, 10);
    if (t + c !== total) {
      findings.push({
        code: 'B.3',
        level: 'fail',
        message: `phase1-done 计数不一致：tencent(${t}) + competitor(${c}) ≠ total(${total})`,
        fix: '重新统计 tencent / competitor / total（不计入 status=removed 的行）',
      });
    }
  }

  // B.8 单次执行原则：ambiguity_resolved=no 不允许落盘
  if (parsed.doneFields.ambiguity_resolved === 'no') {
    findings.push({
      code: 'B.8',
      level: 'fail',
      message: 'phase1-done.ambiguity_resolved=no 时不允许落盘 phase1.md',
      fix: '回到阶段 D 完成歧义追问，所有歧义点用户已确认后再落盘（违反 Phase 1 单次执行原则）',
    });
  }
}

// ============================================================================
// 组 C · 反向印证（决策 9 · 防 AI 乱填 step_*）
// ============================================================================

function checkGroupC(parsed, findings) {
  const activeRows = parsed.rows.filter((r) => r.status !== 'removed');

  // C.1 step_token_classified=yes ⇒ 至少 1 行 规格/子类型 非空（或全清单本就无 SPEC 信号）
  if (parsed.doneFields.step_token_classified === 'yes') {
    const hasSpecRow = activeRows.some((r) => r['规格/子类型'] && r['规格/子类型'] !== '-');
    if (!hasSpecRow && activeRows.length > 0) {
      findings.push({
        code: 'C.1',
        level: 'warn',
        message:
          'step_token_classified=yes 但所有行 规格/子类型 列都为空 / -（可能未真正跑 A.2 token 分类）',
        fix: '确认输入是否真的没有 SPEC 信号；如有，重新跑阶段 A.2',
      });
    }
  }

  // C.2 step_companion_expanded=yes ⇒ companion_expanded > 0
  const stepCompanion = parsed.doneFields.step_companion_expanded;
  const companionExpanded = parseInt(parsed.doneFields.companion_expanded || '0', 10);
  if (stepCompanion === 'yes' && companionExpanded === 0) {
    findings.push({
      code: 'C.2',
      level: 'fail',
      message: 'step_companion_expanded=yes 但 companion_expanded=0（自相矛盾）',
      fix: '若实际未做伴生拆分，step_companion_expanded 应填 n/a；否则 companion_expanded 应 > 0',
    });
  }
  if (stepCompanion === 'n/a' && companionExpanded > 0) {
    findings.push({
      code: 'C.2',
      level: 'fail',
      message: `step_companion_expanded=n/a 但 companion_expanded=${companionExpanded}（自相矛盾）`,
      fix: 'companion_expanded > 0 时 step_companion_expanded 必须填 yes',
    });
  }

  // C.4 ambiguity_resolved 与 step_ambiguity_resolved 一致
  if (parsed.doneFields.ambiguity_resolved !== parsed.doneFields.step_ambiguity_resolved) {
    findings.push({
      code: 'C.4',
      level: 'fail',
      message: `ambiguity_resolved=${parsed.doneFields.ambiguity_resolved} 与 step_ambiguity_resolved=${parsed.doneFields.step_ambiguity_resolved} 不一致`,
      fix: '两者必须同时为 yes（落盘前提）',
    });
  }

  // C.5 inferred_count 与实际 推断标记 行数一致
  const claimedInferred = parseInt(parsed.doneFields.inferred_count || '0', 10);
  const actualInferred = activeRows.filter((r) => {
    const mark = r['推断标记'];
    return mark && mark !== '-';
  }).length;
  if (claimedInferred !== actualInferred) {
    findings.push({
      code: 'C.5',
      level: 'fail',
      message: `inferred_count 声明 ${claimedInferred}，但实际 推断标记 列非空的行数为 ${actualInferred}`,
      fix: '重新统计推断标记非空 / 非 - 的活跃行数',
    });
  }

  // C.6 region_expanded > 0 ⇒ 至少存在两行 (产品名+规格) 相同但地域不同
  const regionExpanded = parseInt(parsed.doneFields.region_expanded || '0', 10);
  if (regionExpanded > 0) {
    const productSpecMap = new Map();
    for (const r of activeRows) {
      const key = `${r['产品名'] || ''}|${r['规格/子类型'] || ''}`;
      if (!productSpecMap.has(key)) productSpecMap.set(key, new Set());
      productSpecMap.get(key).add(r['地域'] || '');
    }
    const hasMultiRegion = [...productSpecMap.values()].some((set) => set.size > 1);
    if (!hasMultiRegion) {
      findings.push({
        code: 'C.6',
        level: 'fail',
        message: `region_expanded=${regionExpanded} 但表中没有"同产品同规格不同地域"的行（反向印证不通过）`,
        fix: '检查地域笛卡尔积是否真的执行；或修正 region_expanded 计数',
      });
    }
  }
}

// ============================================================================
// 组 D · 搜索关键词白名单（决策 2）
// ============================================================================

function checkGroupD(parsed, findings) {
  const activeRows = parsed.rows.filter((r) => r.status !== 'removed');
  const locationDict = parsed.site === 'intl' ? LOCATION_INTL : LOCATION_CN;

  for (const row of activeRows) {
    const keyword = row['搜索关键词'] || '';
    const rowId = row.row_id || '?';
    const productName = row['产品名'] || '';

    if (!keyword || keyword === '-') continue;

    // D.1/D.2 LOCATION 黑名单
    for (const loc of locationDict) {
      if (keyword.includes(loc)) {
        findings.push({
          code: parsed.site === 'intl' ? 'D.2' : 'D.1',
          level: 'fail',
          message: `${rowId} 的搜索关键词含 LOCATION token: "${loc}"`,
          location: `row_id=${rowId} 关键词="${keyword}"`,
          fix: 'LOCATION 已在 地域 列承载，禁止重复进 搜索关键词',
        });
        break;
      }
    }

    // D.3 QUANTITY 模式
    if (QUANTITY_PATTERN.test(keyword)) {
      findings.push({
        code: 'D.3',
        level: 'fail',
        message: `${rowId} 的搜索关键词含 QUANTITY 模式（数字 + 量词）`,
        location: `row_id=${rowId} 关键词="${keyword}"`,
        fix: '数量信息属 QUANTITY 类，不进 搜索关键词；如有数量需求，留作 Phase 5 row add 的 count 参数',
      });
    }

    // D.4 BILLING 黑名单
    for (const tok of BILLING_TOKENS) {
      if (keyword.includes(tok)) {
        findings.push({
          code: 'D.4',
          level: 'fail',
          message: `${rowId} 的搜索关键词含 BILLING token: "${tok}"`,
          location: `row_id=${rowId} 关键词="${keyword}"`,
          fix: 'BILLING 已在 售卖模式 列承载，禁止进 搜索关键词',
        });
        break;
      }
    }

    // D.5 PERFORMANCE_FILTER 模式
    for (const pat of PERFORMANCE_FILTER_PATTERNS) {
      if (pat.test(keyword)) {
        findings.push({
          code: 'D.5',
          level: 'fail',
          message: `${rowId} 的搜索关键词含 PERFORMANCE_FILTER 模式`,
          location: `row_id=${rowId} 关键词="${keyword}" 命中正则：${pat.source}`,
          fix: 'PERFORMANCE_FILTER 已在 约束条件 列承载，搜索引擎不支持范围查询；不进 搜索关键词',
        });
        break;
      }
    }

    // D.6 必含 IDENTIFIER（产品名子串）
    if (productName && productName !== '-' && !keyword.includes(productName)) {
      // 容忍：产品名可能用空格分割成多 token，逐 token 检查至少有一个长 token 出现
      const productTokens = productName.split(/\s+/).filter((t) => t.length >= 2);
      const hasAnyToken = productTokens.some((t) => keyword.includes(t));
      if (!hasAnyToken) {
        findings.push({
          code: 'D.6',
          level: 'fail',
          message: `${rowId} 的搜索关键词缺少 IDENTIFIER（产品名 "${productName}" 完全未出现在关键词中）`,
          location: `row_id=${rowId} 关键词="${keyword}"`,
          fix: '搜索关键词必须包含产品名（含中文全名 + 缩写），禁止删除任意一部分',
        });
      }
    }
  }

  // D.7 反向印证：search_keyword_lint=pass 但实际 lint 失败
  const searchLint = parsed.doneFields.search_keyword_lint;
  const dViolations = findings.filter((f) => /^D\.[1-6]$/.test(f.code));
  if (searchLint === 'pass' && dViolations.length > 0) {
    findings.push({
      code: 'D.7',
      level: 'fail',
      message: `search_keyword_lint=pass 但实际有 ${dViolations.length} 项 D 组违规`,
      fix: 'AI 自检结论与 gate 实际校验不一致；请按 D.1-D.6 修复后把 search_keyword_lint 改为 fail（如修复未完成）或重新自检后再标 pass',
    });
  }
}

// ============================================================================
// 组 E · row_id / status 状态机（决策 partial-update）
// ============================================================================

function checkGroupE(parsed, findings) {
  const allRows = parsed.rows;
  const seenRowIds = new Set();
  let lastRowIdNum = 0;

  for (const row of allRows) {
    const rowId = row.row_id;

    // E.1 row_id 格式 r\d{3}
    if (!/^r\d{3,}$/.test(rowId || '')) {
      findings.push({
        code: 'E.1',
        level: 'fail',
        message: `行 row_id="${rowId}" 格式错误`,
        fix: 'row_id 必须形如 r001 / r002 / ...（前缀 r + 至少三位数字）',
      });
      continue;
    }

    // E.2 row_id 不重复
    if (seenRowIds.has(rowId)) {
      findings.push({
        code: 'E.2',
        level: 'fail',
        message: `重复 row_id：${rowId}`,
        fix: 'row_id 必须唯一，删除的行 row_id 不复用',
      });
    }
    seenRowIds.add(rowId);

    // E.3 status 取值
    if (!['stable', 'dirty', 'removed'].includes(row.status)) {
      findings.push({
        code: 'E.3',
        level: 'fail',
        message: `row_id=${rowId} 的 status="${row.status}" 取值非法`,
        fix: 'status ∈ {stable, dirty, removed}',
      });
    }

    // E.6 row_id 单调递增
    const num = parseInt(rowId.slice(1), 10);
    if (num <= lastRowIdNum && lastRowIdNum > 0) {
      findings.push({
        code: 'E.6',
        level: 'warn',
        message: `row_id 顺序异常：${rowId} 出现在更大 row_id 之后`,
      });
    }
    lastRowIdNum = Math.max(lastRowIdNum, num);
  }

  // E.4 update_history 至少含 init
  const hasInit = parsed.historyEntries.some((e) => e.action === 'init');
  if (!hasInit) {
    findings.push({
      code: 'E.4',
      level: 'fail',
      message: 'update_history 缺少 init 记录',
      fix: '在 update_history 块中至少添加一条 <ISO 时间> init',
    });
  }

  // E.7 status=removed 行不计入 total
  const removedCount = allRows.filter((r) => r.status === 'removed').length;
  const activeCount = allRows.length - removedCount;
  const claimedTotal = parseInt(parsed.doneFields.total || '0', 10);
  if (activeCount !== claimedTotal) {
    findings.push({
      code: 'E.7',
      level: 'fail',
      message: `phase1-done.total=${claimedTotal} 与活跃行数（${activeCount}）不一致；removed 行（${removedCount}）不应计入 total`,
      fix: '重新统计 total = 表中 status ≠ removed 的行数',
    });
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function isInt(v) {
  return /^\d+$/.test(v);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session-dir') {
      out.sessionDir = argv[++i];
    } else if (a === '--report') {
      out.report = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      err(`未知参数：${a}`);
    }
  }
  return out;
}

function err(msg) {
  process.stderr.write(msg + '\n');
}

function printUsage() {
  err('用法：');
  err('  node scripts/check-phase1.mjs --session-dir <CPQ_SESSION_DIR>');
  err('  node scripts/check-phase1.mjs --session-dir <CPQ_SESSION_DIR> --report');
  err('');
  err('退出码：');
  err('  0 = 通过');
  err('  1 = 脚本自身错误');
  err('  2 = 校验失败');
}

function printReport(findings) {
  console.log(
    JSON.stringify(
      {
        ok: findings.every((f) => f.level !== 'fail'),
        findings,
      },
      null,
      2,
    ),
  );
}
