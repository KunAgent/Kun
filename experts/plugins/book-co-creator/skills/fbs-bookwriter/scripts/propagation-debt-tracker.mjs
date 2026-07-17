#!/usr/bin/env node
/**
 * FBS-BookWriter 传播债务追踪器（Propagation Debt Tracker）
 *
 * "传播债务"：指已在某处（如大纲、术语表、风格指南）确认的变更，
 * 尚未同步到依赖它的其他产出物中。典型场景：
 *   - 修改了大纲但某章节尚未据新大纲重写
 *   - 修改了角色设定但后续章节仍使用旧名称
 *   - 更新了引用来源但引用列表未刷新
 *
 * 数据落盘：.fbs/propagation-debt.jsonl
 *
 * 用法：
 *   node scripts/propagation-debt-tracker.mjs list   <bookRoot>
 *   node scripts/propagation-debt-tracker.mjs add    <bookRoot> --source <来源> --target <目标> --desc <说明> [--priority high]
 *   node scripts/propagation-debt-tracker.mjs resolve <bookRoot> --id <debtId>
 *   node scripts/propagation-debt-tracker.mjs summary <bookRoot>
 *   node scripts/propagation-debt-tracker.mjs sweep  <bookRoot>   # 自动探测（基于文件 mtime）
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEBT_LOG_FILE = '.fbs/propagation-debt.jsonl';
export const DEBT_SNAPSHOT_FILE = '.fbs/propagation-debt-snapshot.json';

/**
 * 债务优先级
 */
export const DEBT_PRIORITY = {
  CRITICAL: 'critical',  // 阻断发布
  HIGH: 'high',          // 需在下次迭代前处理
  MEDIUM: 'medium',      // 本版本内处理
  LOW: 'low',            // 可延后
};

/**
 * 债务状态
 */
export const DEBT_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  WONTFIX: 'wontfix',
};

// ─── 内部工具 ────────────────────────────────────────────────────────────────

function debtLogPath(bookRoot) {
  return path.join(path.resolve(bookRoot), DEBT_LOG_FILE);
}

function debtSnapshotPath(bookRoot) {
  return path.join(path.resolve(bookRoot), DEBT_SNAPSHOT_FILE);
}

function generateDebtId(source, target) {
  const slug = `${source}-${target}`.replace(/[^\w]/g, '-').slice(0, 20);
  return `debt-${slug}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * 读取全部债务条目（从 JSONL）
 */
function readAllDebts(bookRoot) {
  const logPath = debtLogPath(bookRoot);
  if (!fs.existsSync(logPath)) return [];

  const raw = fs.readFileSync(logPath, 'utf8').trim();
  if (!raw) return [];

  const entries = raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  // 以最后一条同 id 的记录为准（JSONL append-only + tombstone 模式）
  const debtMap = new Map();
  for (const e of entries) {
    if (e.id) debtMap.set(e.id, e);
  }

  return [...debtMap.values()];
}

/**
 * 追加一条债务记录（append-only）
 */
function appendDebt(bookRoot, debt) {
  const logPath = debtLogPath(bookRoot);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(debt) + '\n', 'utf8');
}

/**
 * 更新快照文件（供 Inspector 快速读取）
 */
function updateSnapshot(bookRoot, debts) {
  const snapshot = {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    total: debts.length,
    byStatus: {},
    byPriority: {},
    open: debts.filter(d => d.status === DEBT_STATUS.OPEN || d.status === DEBT_STATUS.IN_PROGRESS),
  };

  for (const s of Object.values(DEBT_STATUS)) {
    snapshot.byStatus[s] = debts.filter(d => d.status === s).length;
  }
  for (const p of Object.values(DEBT_PRIORITY)) {
    snapshot.byPriority[p] = debts.filter(d => d.priority === p).length;
  }

  fs.mkdirSync(path.dirname(debtSnapshotPath(bookRoot)), { recursive: true });
  fs.writeFileSync(debtSnapshotPath(bookRoot), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  return snapshot;
}

// ─── 核心 API ─────────────────────────────────────────────────────────────────

/**
 * 添加传播债务
 * @param {string} bookRoot
 * @param {object} fields - { source, target, description, priority, sourceFile, targetFile, esmStage, chapter }
 * @returns {object} debt entry
 */
export function addDebt(bookRoot, fields = {}) {
  const now = new Date().toISOString();
  const debt = {
    id: generateDebtId(fields.source || 'unknown', fields.target || 'unknown'),
    status: DEBT_STATUS.OPEN,
    priority: fields.priority || DEBT_PRIORITY.MEDIUM,
    source: fields.source || '',
    target: fields.target || '',
    description: fields.description || '',
    sourceFile: fields.sourceFile || null,
    targetFile: fields.targetFile || null,
    esmStage: fields.esmStage || null,
    chapter: fields.chapter != null ? Number(fields.chapter) : null,
    meta: fields.meta || {},
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolveNote: null,
  };

  appendDebt(bookRoot, debt);

  const allDebts = readAllDebts(bookRoot);
  updateSnapshot(bookRoot, allDebts);

  return debt;
}

/**
 * 列出债务条目
 * @param {string} bookRoot
 * @param {object} options - { status, priority, chapter }
 * @returns {object[]}
 */
export function listDebts(bookRoot, options = {}) {
  let debts = readAllDebts(bookRoot);

  if (options.status) debts = debts.filter(d => d.status === options.status);
  if (options.priority) debts = debts.filter(d => d.priority === options.priority);
  if (options.chapter != null) debts = debts.filter(d => d.chapter === Number(options.chapter));

  // 只返回未关闭的（默认）
  if (!options.includeResolved) {
    debts = debts.filter(d => d.status !== DEBT_STATUS.RESOLVED && d.status !== DEBT_STATUS.WONTFIX);
  }

  // 按优先级排序
  const priorityOrder = [DEBT_PRIORITY.CRITICAL, DEBT_PRIORITY.HIGH, DEBT_PRIORITY.MEDIUM, DEBT_PRIORITY.LOW];
  debts.sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));

  return debts;
}

/**
 * 解决传播债务
 * @param {string} bookRoot
 * @param {string} debtId
 * @param {object} options - { note, wontfix }
 * @returns {object|null}
 */
export function resolveDebt(bookRoot, debtId, options = {}) {
  const allDebts = readAllDebts(bookRoot);
  const debt = allDebts.find(d => d.id === debtId);
  if (!debt) return null;

  const now = new Date().toISOString();
  const resolved = {
    ...debt,
    status: options.wontfix ? DEBT_STATUS.WONTFIX : DEBT_STATUS.RESOLVED,
    resolvedAt: now,
    resolveNote: options.note || null,
    updatedAt: now,
  };

  appendDebt(bookRoot, resolved);

  const updated = readAllDebts(bookRoot);
  updateSnapshot(bookRoot, updated);

  return resolved;
}

/**
 * 获取债务摘要（供 Inspector 消费）
 * @param {string} bookRoot
 * @returns {object}
 */
export function getDebtSummary(bookRoot) {
  const snapshotPath = debtSnapshotPath(bookRoot);
  if (fs.existsSync(snapshotPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      return {
        total: snap.total || 0,
        open: snap.byStatus?.[DEBT_STATUS.OPEN] || 0,
        inProgress: snap.byStatus?.[DEBT_STATUS.IN_PROGRESS] || 0,
        resolved: snap.byStatus?.[DEBT_STATUS.RESOLVED] || 0,
        critical: snap.byPriority?.[DEBT_PRIORITY.CRITICAL] || 0,
        high: snap.byPriority?.[DEBT_PRIORITY.HIGH] || 0,
        medium: snap.byPriority?.[DEBT_PRIORITY.MEDIUM] || 0,
        low: snap.byPriority?.[DEBT_PRIORITY.LOW] || 0,
        updatedAt: snap.updatedAt,
      };
    } catch { /* fall through */ }
  }

  // 没有快照时实时计算
  const debts = readAllDebts(bookRoot);
  updateSnapshot(bookRoot, debts);
  return getDebtSummary(bookRoot);
}

/**
 * 自动扫描潜在传播债务（基于文件 mtime 关系）
 *
 * 策略：如果"来源文件"的 mtime 比"依赖它的目标文件"更新，
 * 则可能存在传播债务。
 *
 * @param {string} bookRoot
 * @returns {object[]} 新发现的潜在债务
 */
export function sweepPropagationDebt(bookRoot) {
  const root = path.resolve(bookRoot);
  const found = [];

  // 规则表：[来源文件glob类型, 目标文件glob类型, 优先级, 描述模板]
  const rules = [
    {
      sourcePattern: /^\[S2\].*outline.*\.md$/i,
      targetPattern: /^\[S3-Ch\d+\].*\.md$/i,
      priority: DEBT_PRIORITY.HIGH,
      makeDesc: (src, tgt) => `大纲 ${src} 比章节 ${tgt} 更新，可能需要重写`,
    },
    {
      sourcePattern: /^\[S1\].*research.*\.md$/i,
      targetPattern: /^\[S2\].*outline.*\.md$/i,
      priority: DEBT_PRIORITY.MEDIUM,
      makeDesc: (src, tgt) => `研究素材 ${src} 比大纲 ${tgt} 更新，大纲可能需要补充`,
    },
    {
      sourcePattern: /^\[S4\].*review.*\.md$/i,
      targetPattern: /^\[S3-Ch\d+\].*\.md$/i,
      priority: DEBT_PRIORITY.MEDIUM,
      makeDesc: (src, tgt) => `评审意见 ${src} 比章节 ${tgt} 更新，章节可能需要按评审修订`,
    },
  ];

  // 扫描书稿根目录一层
  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(root)
      .filter(name => name.endsWith('.md'))
      .map(name => {
        const full = path.join(root, name);
        try {
          return { name, full, mtimeMs: fs.statSync(full).mtimeMs };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }

  const existingDebts = readAllDebts(bookRoot);
  const existingKeys = new Set(
    existingDebts
      .filter(d => d.status === DEBT_STATUS.OPEN || d.status === DEBT_STATUS.IN_PROGRESS)
      .map(d => `${d.sourceFile}|${d.targetFile}`)
  );

  for (const rule of rules) {
    const sources = dirEntries.filter(e => rule.sourcePattern.test(e.name));
    const targets = dirEntries.filter(e => rule.targetPattern.test(e.name));

    for (const src of sources) {
      for (const tgt of targets) {
        if (src.mtimeMs > tgt.mtimeMs + 60_000) { // 超过 1 分钟的差距
          const key = `${src.full}|${tgt.full}`;
          if (existingKeys.has(key)) continue;

          const debt = addDebt(bookRoot, {
            source: src.name,
            target: tgt.name,
            description: rule.makeDesc(src.name, tgt.name),
            priority: rule.priority,
            sourceFile: src.full,
            targetFile: tgt.full,
            meta: {
              sourceMtimeMs: src.mtimeMs,
              targetMtimeMs: tgt.mtimeMs,
              detectedBy: 'sweep',
            },
          });
          found.push(debt);
        }
      }
    }
  }

  return found;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [action, bookRoot = process.cwd()] = args;

  function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
        flags[argv[i].slice(2)] = argv[++i];
      } else if (argv[i].startsWith('--')) {
        flags[argv[i].slice(2)] = true;
      }
    }
    return flags;
  }

  const flags = parseFlags(args.slice(2));

  if (!action || action === '--help') {
    console.log(`
传播债务追踪器

用法:
  node propagation-debt-tracker.mjs list    <bookRoot> [--priority high]    列出债务
  node propagation-debt-tracker.mjs add     <bookRoot> --source <来源> --target <目标> --desc <说明>  添加债务
  node propagation-debt-tracker.mjs resolve <bookRoot> --id <debtId> [--note <备注>]  解决债务
  node propagation-debt-tracker.mjs wontfix <bookRoot> --id <debtId>        标记 wontfix
  node propagation-debt-tracker.mjs summary <bookRoot>                      摘要
  node propagation-debt-tracker.mjs sweep   <bookRoot>                      自动扫描
`);
    process.exit(0);
  }

  try {
    switch (action) {
      case 'list': {
        const debts = listDebts(bookRoot, {
          priority: flags.priority,
          includeResolved: flags['include-resolved'] === true,
        });
        if (debts.length === 0) {
          console.log('暂无未解决的传播债务');
        } else {
          console.log(`传播债务（${debts.length} 条）:`);
          const pIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
          debts.forEach(d => {
            console.log(`  ${pIcon[d.priority] || '?'} [${d.priority.padEnd(8)}] ${d.id.slice(0, 20)}  ${d.description.slice(0, 60)}`);
          });
        }
        break;
      }
      case 'add': {
        const debt = addDebt(bookRoot, {
          source: flags.source || '',
          target: flags.target || '',
          description: flags.desc || flags.description || '',
          priority: flags.priority || DEBT_PRIORITY.MEDIUM,
          esmStage: flags.stage || null,
          chapter: flags.chapter != null ? parseInt(flags.chapter) : null,
        });
        console.log(`已添加: ${debt.id}`);
        break;
      }
      case 'resolve': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const resolved = resolveDebt(bookRoot, flags.id, { note: flags.note });
        console.log(resolved ? `已解决: ${resolved.id}` : '未找到');
        break;
      }
      case 'wontfix': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const wf = resolveDebt(bookRoot, flags.id, { wontfix: true, note: flags.note });
        console.log(wf ? `已标记 wontfix: ${wf.id}` : '未找到');
        break;
      }
      case 'summary': {
        const summary = getDebtSummary(bookRoot);
        console.log(JSON.stringify(summary, null, 2));
        break;
      }
      case 'sweep': {
        const found = sweepPropagationDebt(bookRoot);
        if (found.length === 0) {
          console.log('未发现新的传播债务');
        } else {
          console.log(`发现 ${found.length} 条新传播债务:`);
          found.forEach(d => console.log(`  [${d.priority}] ${d.description}`));
        }
        break;
      }
      default:
        console.error(`未知动作: ${action}`);
        process.exit(1);
    }
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}
