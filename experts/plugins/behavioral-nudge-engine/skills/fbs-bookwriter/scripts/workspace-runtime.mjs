#!/usr/bin/env node
/**
 * FBS-BookWriter 统一工作区运行时（Workspace Runtime）
 *
 * 一条线串联所有运行态模块：
 *   manifest → registry → board → inspector → debt tracker → host-bridge
 *
 * 在书稿项目初始化或每次 S0 启动时调用，确保工作区状态完整、
 * 各层快照同步、计划台与传播债务已就绪。
 *
 * 用法：
 *   node scripts/workspace-runtime.mjs init  <bookRoot>   # 首次初始化工作区
 *   node scripts/workspace-runtime.mjs sync  <bookRoot>   # 全量同步快照
 *   node scripts/workspace-runtime.mjs status <bookRoot>  # 快速健康状态
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNTIME_VERSION = '1.0.0';

async function loadModules() {
  const base = __dirname;
  const [
    manifestMod,
    registryMod,
    boardMod,
    inspectorMod,
    debtMod,
  ] = await Promise.all([
    import(`file://${path.join(base, 'workspace-manifest.mjs')}`),
    import(`file://${path.join(base, 'releases-registry.mjs')}`),
    import(`file://${path.join(base, 'plan-board.mjs')}`),
    import(`file://${path.join(base, 'workspace-inspector.mjs')}`),
    import(`file://${path.join(base, 'propagation-debt-tracker.mjs')}`),
  ]);
  return { manifestMod, registryMod, boardMod, inspectorMod, debtMod };
}

/**
 * 初始化工作区（首次 S0 启动时调用）
 * @param {string} bookRoot
 * @param {object} options - { title, version, forceReinit }
 * @returns {object} initReport
 */
export async function initWorkspace(bookRoot, options = {}) {
  const root = path.resolve(bookRoot);
  const fbsDir = path.join(root, '.fbs');
  fs.mkdirSync(fbsDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'deliverables'), { recursive: true });
  fs.mkdirSync(path.join(root, 'releases'), { recursive: true });

  const { manifestMod, registryMod, boardMod, inspectorMod, debtMod } = await loadModules();

  const steps = [];

  // 1. 构建工作区清单
  const manifest = manifestMod.buildManifest(root);
  const manifestPath = manifestMod.writeManifest(root, manifest);
  steps.push({ step: 'manifest', path: manifestPath, ok: true });

  // 2. 若无发布条目且有标题，创建初始草稿
  const registry = registryMod.getRegistrySummary(root);
  if (registry.total === 0 && options.title) {
    const release = registryMod.createRelease(root, {
      title: options.title,
      version: options.version || '1.0.0',
      description: options.description || '',
    });
    steps.push({ step: 'release_draft', id: release.id, ok: true });
  }

  // 3. 若无任务，添加 S0 引导任务
  const board = boardMod.getBoardSummary(root);
  if (board.total === 0) {
    boardMod.addTask(root, {
      title: 'S0 需求 & 素材摄入',
      type: boardMod.TASK_TYPE ? boardMod.TASK_TYPE.INTAKE : 'intake',
      esmStage: 'S0',
      priority: 100,
      description: '完成读者画像、主题确认、素材上传、关键词检索',
    });
    boardMod.addTask(root, {
      title: 'S1 研究调研',
      type: 'research',
      esmStage: 'S1',
      priority: 90,
      description: '联网检索核心论据，完成研究摘要',
    });
    boardMod.addTask(root, {
      title: 'S2 大纲规划',
      type: 'outline',
      esmStage: 'S2',
      priority: 80,
      description: '生成章节大纲，确认章节数与结构',
    });
    steps.push({ step: 'board_seeded', taskCount: 3, ok: true });
  }

  // 4. 初始债务扫描
  const newDebts = debtMod.sweepPropagationDebt(root);
  steps.push({ step: 'debt_sweep', found: newDebts.length, ok: true });

  // 5. 运行 Inspector
  const report = await inspectorMod.runInspection(root, { updateManifest: false });
  steps.push({ step: 'inspector', score: report.score, passed: report.passed, ok: true });

  return {
    runtimeVersion: RUNTIME_VERSION,
    initializedAt: new Date().toISOString(),
    bookRoot: root,
    steps,
    health: { score: report.score, passed: report.passed, issueCount: report.issues.length },
  };
}

/**
 * 全量同步所有快照
 * @param {string} bookRoot
 * @returns {object} syncReport
 */
export async function syncWorkspace(bookRoot) {
  const root = path.resolve(bookRoot);
  const { manifestMod, debtMod, inspectorMod } = await loadModules();

  // 1. 重建清单
  const manifest = manifestMod.buildManifest(root);
  const manifestPath = manifestMod.writeManifest(root, manifest);

  // 2. 扫描新债务
  const newDebts = debtMod.sweepPropagationDebt(root);

  // 3. Inspector
  const report = await inspectorMod.runInspection(root, { updateManifest: false });

  return {
    syncedAt: new Date().toISOString(),
    manifestPath,
    newDebts: newDebts.length,
    health: { score: report.score, passed: report.passed, errorCount: report.errorCount, warnCount: report.warnCount },
  };
}

/**
 * 快速状态检查（不重建清单，直接读取快照）
 * @param {string} bookRoot
 * @returns {object}
 */
export function quickStatus(bookRoot) {
  const root = path.resolve(bookRoot);
  const fbsDir = path.join(root, '.fbs');

  function safeRead(p) {
    try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
  }

  function safeReadMd(p, pattern) {
    try {
      if (!fs.existsSync(p)) return null;
      const text = fs.readFileSync(p, 'utf8');
      const m = text.match(pattern);
      return m ? m[1].trim() : null;
    } catch { return null; }
  }

  const manifest = safeRead(path.join(fbsDir, 'workspace-manifest.json'));
  const inspector = safeRead(path.join(fbsDir, 'inspector-report.json'));
  const debtSnap = safeRead(path.join(fbsDir, 'propagation-debt-snapshot.json'));
  const planBoard = safeRead(path.join(fbsDir, 'plan-board.json'));

  const esmState = safeReadMd(
    path.join(fbsDir, 'esm-state.md'),
    /## 当前状态\s*```\s*(\w+)\s*```/
  ) || safeReadMd(
    path.join(fbsDir, 'session-state.md'),
    /## 当前状态\s*```\s*(\w+)\s*```/
  );

  const openTasks = (planBoard?.tasks || []).filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const openDebts = (debtSnap?.byStatus?.open || 0) + (debtSnap?.byStatus?.in_progress || 0);

  return {
    ok: true,
    esmState: esmState || manifest?.session?.esmState || 'N/A',
    health: inspector ? { score: inspector.score, passed: inspector.passed } : null,
    manifestAge: manifest ? Math.round((Date.now() - new Date(manifest.generatedAt).getTime()) / 60000) + 'm' : 'N/A',
    artifacts: manifest?.health ? {
      stage: manifest.health.stageArtifactCount,
      deliverables: manifest.health.deliverableCount,
      releases: manifest.health.releaseCount,
    } : null,
    tasks: { open: openTasks },
    debt: { open: openDebts, critical: debtSnap?.byPriority?.critical || 0 },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [action = 'status', bookRoot = process.cwd()] = args;

  function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
        flags[argv[i].slice(2)] = argv[++i];
      }
    }
    return flags;
  }
  const flags = parseFlags(args.slice(2));

  if (action === '--help') {
    console.log(`
工作区统一运行时

用法:
  node workspace-runtime.mjs init   <bookRoot> [--title <书名>] [--version 1.0.0]  初始化
  node workspace-runtime.mjs sync   <bookRoot>                                     全量同步
  node workspace-runtime.mjs status <bookRoot>                                     快速状态
`);
    process.exit(0);
  }

  (async () => {
    try {
      switch (action) {
        case 'init': {
          const report = await initWorkspace(bookRoot, { title: flags.title, version: flags.version });
          console.log(`工作区初始化完成 (${report.bookRoot})`);
          console.log(`健康分: ${report.health.score} | 问题: ${report.health.issueCount}`);
          report.steps.forEach(s => {
            const icon = s.ok ? '✅' : '❌';
            const detail = Object.entries(s).filter(([k]) => k !== 'step' && k !== 'ok').map(([k, v]) => `${k}=${v}`).join(' ');
            console.log(`  ${icon} ${s.step}  ${detail}`);
          });
          break;
        }
        case 'sync': {
          const r = await syncWorkspace(bookRoot);
          console.log(`同步完成: 健康分=${r.health.score} 新债务=${r.newDebts}`);
          break;
        }
        case 'status': {
          const s = quickStatus(bookRoot);
          console.log(`ESM: ${s.esmState}  健康: ${s.health?.score ?? 'N/A'}  清单更新: ${s.manifestAge}`);
          if (s.artifacts) console.log(`  产出物: stage=${s.artifacts.stage} deliverables=${s.artifacts.deliverables} releases=${s.artifacts.releases}`);
          console.log(`  任务: 开放=${s.tasks.open}  债务: 开放=${s.debt.open} 严重=${s.debt.critical}`);
          break;
        }
        default:
          console.error(`未知动作: ${action}`);
          process.exit(1);
      }
    } catch (err) {
      console.error('运行时错误:', err.message);
      process.exit(1);
    }
  })();
}
