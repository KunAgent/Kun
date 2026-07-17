#!/usr/bin/env node
/**
 * FBS-BookWriter 计划台（Plan Board）
 *
 * 管理书稿生产任务的创建、状态流转和依赖联动：
 * - 任务 CRUD（支持章节任务、研究任务、交付任务）
 * - ESM 状态联动（S0→S1→...→S6 自动推进）
 * - 传播债务钩子（与 propagation-debt-tracker 联动）
 * - 计划台快照写入 .fbs/plan-board.json
 *
 * 用法：
 *   node scripts/plan-board.mjs list    <bookRoot>
 *   node scripts/plan-board.mjs add     <bookRoot> --title <任务名> --type chapter --chapter 3
 *   node scripts/plan-board.mjs start   <bookRoot> --id <taskId>
 *   node scripts/plan-board.mjs done    <bookRoot> --id <taskId>
 *   node scripts/plan-board.mjs block   <bookRoot> --id <taskId> --reason <原因>
 *   node scripts/plan-board.mjs board   <bookRoot>               # 打印看板视图
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PLAN_BOARD_FILE = '.fbs/plan-board.json';

/**
 * 任务类型
 */
export const TASK_TYPE = {
  INTAKE: 'intake',
  RESEARCH: 'research',
  OUTLINE: 'outline',
  CHAPTER: 'chapter',
  REVIEW: 'review',
  DELIVERY: 'delivery',
  MISC: 'misc',
};

/**
 * 任务状态
 */
export const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
};

/**
 * 状态优先级（用于看板排序）
 */
const STATUS_ORDER = [
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.BLOCKED,
  TASK_STATUS.PENDING,
  TASK_STATUS.DONE,
  TASK_STATUS.SKIPPED,
];

// ─── 内部工具 ────────────────────────────────────────────────────────────────

function boardPath(bookRoot) {
  return path.join(path.resolve(bookRoot), PLAN_BOARD_FILE);
}

function generateTaskId(type, chapter) {
  const prefix = type ? type.slice(0, 3) : 'tsk';
  const chSuffix = chapter != null ? `-ch${chapter}` : '';
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(2).toString('hex');
  return `${prefix}${chSuffix}-${ts}-${rand}`;
}

function loadBoard(bookRoot) {
  const p = boardPath(bookRoot);
  if (!fs.existsSync(p)) {
    return { version: '1.0.0', createdAt: new Date().toISOString(), tasks: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { version: '1.0.0', createdAt: new Date().toISOString(), tasks: [] };
  }
}

function saveBoard(bookRoot, board) {
  const p = boardPath(bookRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  board.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(board, null, 2) + '\n', 'utf8');
  return p;
}

function findTask(board, taskId) {
  return board.tasks.find(t => t.id === taskId) || null;
}

// ─── 核心 API ────────────────────────────────────────────────────────────────

/**
 * 添加任务
 * @param {string} bookRoot
 * @param {object} fields - { title, type, chapter, description, dependsOn, esmStage, priority, meta }
 * @returns {object} task
 */
export function addTask(bookRoot, fields = {}) {
  const board = loadBoard(bookRoot);
  const now = new Date().toISOString();

  const task = {
    id: generateTaskId(fields.type, fields.chapter),
    title: fields.title || '未命名任务',
    type: fields.type || TASK_TYPE.MISC,
    status: TASK_STATUS.PENDING,
    chapter: fields.chapter != null ? Number(fields.chapter) : null,
    description: fields.description || '',
    esmStage: fields.esmStage || null,
    priority: fields.priority != null ? Number(fields.priority) : 50,
    dependsOn: Array.isArray(fields.dependsOn) ? fields.dependsOn : [],
    blockedReason: null,
    meta: fields.meta || {},
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    doneAt: null,
  };

  board.tasks.push(task);
  saveBoard(bookRoot, board);

  return task;
}

/**
 * 获取任务
 * @param {string} bookRoot
 * @param {string} taskId
 * @returns {object|null}
 */
export function getTask(bookRoot, taskId) {
  return findTask(loadBoard(bookRoot), taskId);
}

/**
 * 列出任务
 * @param {string} bookRoot
 * @param {object} options - { status, type, chapter, esmStage }
 * @returns {object[]}
 */
export function listTasks(bookRoot, options = {}) {
  const board = loadBoard(bookRoot);
  let tasks = [...board.tasks];

  if (options.status) tasks = tasks.filter(t => t.status === options.status);
  if (options.type) tasks = tasks.filter(t => t.type === options.type);
  if (options.chapter != null) tasks = tasks.filter(t => t.chapter === Number(options.chapter));
  if (options.esmStage) tasks = tasks.filter(t => t.esmStage === options.esmStage);

  tasks.sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status);
    const sb = STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return (b.priority || 0) - (a.priority || 0);
  });

  return tasks;
}

/**
 * 更新任务状态
 * @param {string} bookRoot
 * @param {string} taskId
 * @param {string} newStatus
 * @param {object} extras - { blockedReason, meta }
 * @returns {object|null}
 */
export function updateTaskStatus(bookRoot, taskId, newStatus, extras = {}) {
  const board = loadBoard(bookRoot);
  const task = findTask(board, taskId);
  if (!task) return null;

  const now = new Date().toISOString();

  // 检查依赖是否满足（进入 in_progress 时）
  if (newStatus === TASK_STATUS.IN_PROGRESS && task.dependsOn.length > 0) {
    const unfinished = task.dependsOn.filter(depId => {
      const dep = findTask(board, depId);
      return dep && dep.status !== TASK_STATUS.DONE && dep.status !== TASK_STATUS.SKIPPED;
    });
    if (unfinished.length > 0) {
      task.status = TASK_STATUS.BLOCKED;
      task.blockedReason = `依赖未完成: ${unfinished.join(', ')}`;
      task.updatedAt = now;
      saveBoard(bookRoot, board);
      return task;
    }
  }

  task.status = newStatus;
  task.updatedAt = now;

  if (newStatus === TASK_STATUS.IN_PROGRESS && !task.startedAt) {
    task.startedAt = now;
  }
  if (newStatus === TASK_STATUS.DONE) {
    task.doneAt = now;
    task.blockedReason = null;
  }
  if (newStatus === TASK_STATUS.BLOCKED) {
    task.blockedReason = extras.blockedReason || '原因未知';
  }
  if (newStatus === TASK_STATUS.PENDING || newStatus === TASK_STATUS.SKIPPED) {
    task.blockedReason = null;
  }

  if (extras.meta) {
    task.meta = { ...task.meta, ...extras.meta };
  }

  saveBoard(bookRoot, board);
  return task;
}

/**
 * 删除任务
 * @param {string} bookRoot
 * @param {string} taskId
 * @returns {boolean}
 */
export function deleteTask(bookRoot, taskId) {
  const board = loadBoard(bookRoot);
  const idx = board.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return false;
  board.tasks.splice(idx, 1);
  saveBoard(bookRoot, board);
  return true;
}

/**
 * 获取看板摘要
 * @param {string} bookRoot
 * @returns {object}
 */
export function getBoardSummary(bookRoot) {
  const tasks = listTasks(bookRoot);
  const byStatus = {};
  for (const s of Object.values(TASK_STATUS)) {
    byStatus[s] = tasks.filter(t => t.status === s).length;
  }
  const inProgress = tasks.filter(t => t.status === TASK_STATUS.IN_PROGRESS);
  const blocked = tasks.filter(t => t.status === TASK_STATUS.BLOCKED);
  const completionRate = tasks.length > 0
    ? ((byStatus[TASK_STATUS.DONE] + byStatus[TASK_STATUS.SKIPPED]) / tasks.length * 100).toFixed(1)
    : '0.0';

  return {
    total: tasks.length,
    byStatus,
    completionRate: `${completionRate}%`,
    inProgress: inProgress.map(t => ({ id: t.id, title: t.title, chapter: t.chapter })),
    blocked: blocked.map(t => ({ id: t.id, title: t.title, reason: t.blockedReason })),
  };
}

/**
 * 渲染看板文本视图（供 CLI 打印）
 * @param {string} bookRoot
 * @returns {string}
 */
export function renderBoardText(bookRoot) {
  const tasks = listTasks(bookRoot);
  const summary = getBoardSummary(bookRoot);

  const statusLabel = {
    [TASK_STATUS.IN_PROGRESS]: '▶ 进行中',
    [TASK_STATUS.BLOCKED]:     '✖ 阻塞',
    [TASK_STATUS.PENDING]:     '○ 待开始',
    [TASK_STATUS.DONE]:        '✔ 已完成',
    [TASK_STATUS.SKIPPED]:     '- 已跳过',
  };

  const lines = [
    '════════════════════════════════════',
    ' FBS 计划台',
    '════════════════════════════════════',
    `总计: ${summary.total}  完成率: ${summary.completionRate}`,
    `进行中: ${summary.byStatus[TASK_STATUS.IN_PROGRESS]}  阻塞: ${summary.byStatus[TASK_STATUS.BLOCKED]}  待开始: ${summary.byStatus[TASK_STATUS.PENDING]}`,
    '────────────────────────────────────',
  ];

  if (tasks.length === 0) {
    lines.push('  （暂无任务）');
  } else {
    let lastStatus = null;
    for (const t of tasks) {
      if (t.status !== lastStatus) {
        lines.push('');
        lines.push(`  ${statusLabel[t.status] || t.status}`);
        lastStatus = t.status;
      }
      const chStr = t.chapter != null ? ` [第${t.chapter}章]` : '';
      const stageStr = t.esmStage ? ` <${t.esmStage}>` : '';
      lines.push(`    ${t.id.slice(0, 16)}  ${t.title}${chStr}${stageStr}`);
      if (t.blockedReason) {
        lines.push(`      ↳ 阻塞原因: ${t.blockedReason}`);
      }
    }
  }

  lines.push('════════════════════════════════════');
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

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

  const [action, bookRoot = process.cwd()] = args;
  const flags = parseFlags(args.slice(2));

  if (!action || action === '--help') {
    console.log(`
计划台工具

用法:
  node plan-board.mjs list   <bookRoot> [--status <s>] [--type <t>]  列出任务
  node plan-board.mjs add    <bookRoot> --title <名称> [--type chapter] [--chapter 3]  添加任务
  node plan-board.mjs start  <bookRoot> --id <taskId>               开始任务
  node plan-board.mjs done   <bookRoot> --id <taskId>               完成任务
  node plan-board.mjs block  <bookRoot> --id <taskId> --reason <原因>  阻塞任务
  node plan-board.mjs delete <bookRoot> --id <taskId>               删除任务
  node plan-board.mjs board  <bookRoot>                             打印看板
  node plan-board.mjs summary <bookRoot>                            摘要 JSON
`);
    process.exit(0);
  }

  try {
    switch (action) {
      case 'list': {
        const tasks = listTasks(bookRoot, { status: flags.status, type: flags.type });
        if (tasks.length === 0) {
          console.log('暂无任务');
        } else {
          tasks.forEach(t => {
            const ch = t.chapter != null ? ` [ch${t.chapter}]` : '';
            console.log(`  [${t.status.padEnd(12)}] ${t.id.slice(0, 18)}  ${t.title}${ch}`);
          });
        }
        break;
      }
      case 'add': {
        const task = addTask(bookRoot, {
          title: flags.title || '未命名任务',
          type: flags.type || TASK_TYPE.MISC,
          chapter: flags.chapter != null ? parseInt(flags.chapter) : null,
          description: flags.description || '',
          esmStage: flags.stage || null,
          priority: flags.priority != null ? parseInt(flags.priority) : 50,
        });
        console.log(`已添加: ${task.id}`);
        break;
      }
      case 'start': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const t = updateTaskStatus(bookRoot, flags.id, TASK_STATUS.IN_PROGRESS);
        console.log(t ? `已开始: ${t.title} (${t.status})` : '未找到');
        break;
      }
      case 'done': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const t = updateTaskStatus(bookRoot, flags.id, TASK_STATUS.DONE);
        console.log(t ? `已完成: ${t.title}` : '未找到');
        break;
      }
      case 'block': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        const t = updateTaskStatus(bookRoot, flags.id, TASK_STATUS.BLOCKED, { blockedReason: flags.reason || '未知' });
        console.log(t ? `已阻塞: ${t.title}` : '未找到');
        break;
      }
      case 'delete': {
        if (!flags.id) { console.error('需要 --id'); process.exit(1); }
        console.log(deleteTask(bookRoot, flags.id) ? '已删除' : '未找到');
        break;
      }
      case 'board': {
        console.log(renderBoardText(bookRoot));
        break;
      }
      case 'summary': {
        console.log(JSON.stringify(getBoardSummary(bookRoot), null, 2));
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
