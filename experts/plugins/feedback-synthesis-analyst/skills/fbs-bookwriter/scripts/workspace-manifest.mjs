#!/usr/bin/env node
/**
 * FBS-BookWriter 工作区统一清单（Workspace Manifest）
 *
 * 将 entry-contract、session-state、deliverables/releases 三层快照聚合为
 * 一份可机读的 workspace-manifest.json，供 Inspector、Plan Board、
 * host-bridge 及打包层统一消费。
 *
 * 用法：
 *   node scripts/workspace-manifest.mjs build <bookRoot>
 *   node scripts/workspace-manifest.mjs read  <bookRoot>
 *   node scripts/workspace-manifest.mjs diff  <bookRoot>   # 与上次快照对比
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MANIFEST_VERSION = '1.0.0';
export const MANIFEST_FILENAME = 'workspace-manifest.json';
export const MANIFEST_HISTORY_DIR = '.fbs/manifest-history';

// ─── 内部工具 ────────────────────────────────────────────────────────────────

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadLines(filePath, limit = 200) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').slice(-limit).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function safeReadMarkdownMeta(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf8');
    const tsMatch = text.match(/更新时间:\s*(.+)/);
    const stateMatch = text.match(/## 当前状态\s*```\s*(\w+)\s*```/);
    const topicMatch = text.match(/\*\*主题\*\*:\s*(.+)/);
    const wordMatch = text.match(/\*\*字数\*\*:\s*(\d+)/);
    const chapterMatch = text.match(/\*\*章节\*\*:\s*第(\d+)章/);
    return {
      timestamp: tsMatch ? tsMatch[1].trim() : null,
      esmState: stateMatch ? stateMatch[1].trim() : null,
      topic: topicMatch ? topicMatch[1].trim() : null,
      wordCount: wordMatch ? parseInt(wordMatch[1]) : null,
      chapterIndex: chapterMatch ? parseInt(chapterMatch[1]) : null,
    };
  } catch {
    return null;
  }
}

function scanDir(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => {
      try {
        const full = path.join(dir, name);
        return fs.statSync(full).isFile() && predicate(name, full);
      } catch { return false; }
    })
    .map(name => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, path: full, size: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ─── 核心构建器 ──────────────────────────────────────────────────────────────

/**
 * 构建完整的工作区清单快照
 * @param {string} bookRoot
 * @returns {object} manifest
 */
export function buildManifest(bookRoot) {
  const root = path.resolve(bookRoot);
  const fbsDir = path.join(root, '.fbs');
  const deliverablesDir = path.join(root, 'deliverables');
  const releasesDir = path.join(root, 'releases');

  // 1. 运行态契约快照
  const entryContract = safeReadJson(path.join(fbsDir, 'entry-contract.json'));
  const workspaceGov = safeReadJson(path.join(fbsDir, 'workspace-governance.json'));

  // 2. 会话状态
  const esmStateMd = safeReadMarkdownMeta(path.join(fbsDir, 'esm-state.md'))
    || safeReadMarkdownMeta(path.join(fbsDir, 'session-state.md'));

  // 3. 章节状态
  const chapterStatusMd = fs.existsSync(path.join(fbsDir, 'chapter-status.md'))
    ? { exists: true, path: path.join(fbsDir, 'chapter-status.md') }
    : { exists: false };

  // 4. 检索台账
  const searchLedger = safeReadLines(path.join(fbsDir, 'search-ledger.jsonl'), 50);

  // 5. 桥接事件
  const bridgeEvents = safeReadLines(path.join(fbsDir, 'host-bridge-events.jsonl'), 30);

  // 6. 展示就绪记录
  const presentationReady = safeReadJson(path.join(fbsDir, 'presentation-ready.json'));

  // 7. deliverables 层
  const deliverables = scanDir(deliverablesDir, name =>
    name.endsWith('.md') || name.endsWith('.html') || name.endsWith('-package.json')
  );

  // 8. releases 层
  const releaseManifests = scanDir(releasesDir, name => name.endsWith('-release.json'));

  // 9. stage 产出物（书稿根一层 [Sx] 前缀 .md）
  const stageArtifacts = scanDir(root, name =>
    /^\[(S0|S1|S2|S2\.5|S3-Ch\d+|S4|S5|S6)\]/.test(name) && name.endsWith('.md')
  );

  // 10. 检查点列表
  const checkpointsDir = path.join(fbsDir, 'checkpoints');
  const checkpoints = scanDir(checkpointsDir, name => name.endsWith('.checkpoint.json'))
    .map(f => {
      const data = safeReadJson(f.path);
      return data ? { id: data.id, label: data.label, timestamp: data.timestamp } : null;
    })
    .filter(Boolean);

  // 整合
  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    bookRoot: root,
    health: computeHealthSummary({
      entryContract, workspaceGov, esmStateMd,
      deliverables, releaseManifests, stageArtifacts,
    }),
    session: {
      esmState: esmStateMd?.esmState || null,
      timestamp: esmStateMd?.timestamp || null,
      topic: esmStateMd?.topic || null,
      wordCount: esmStateMd?.wordCount || null,
      chapterIndex: esmStateMd?.chapterIndex || null,
    },
    contracts: {
      entryContractExists: !!entryContract,
      workspaceGovExists: !!workspaceGov,
      wp2: entryContract?.wp2 || null,
      searchPreflightEnabled: entryContract?.searchPreflightContract?.enabled || false,
    },
    artifacts: {
      stage: stageArtifacts.map(a => ({ name: a.name, size: a.size, mtimeMs: a.mtimeMs })),
      deliverables: deliverables.map(a => ({ name: a.name, size: a.size, mtimeMs: a.mtimeMs })),
      releases: releaseManifests.map(a => ({ name: a.name, size: a.size, mtimeMs: a.mtimeMs })),
    },
    checkpoints,
    recentBridgeEvents: bridgeEvents.slice(-10),
    recentSearchLedger: searchLedger.slice(-10),
    presentationReady: presentationReady || null,
    feedback: {
      total: feedbackRecords.length,
      openCount: feedbackOpenCount,
      latest: feedbackRecords[0]
        ? {
            id: feedbackRecords[0].id,
            releaseId: feedbackRecords[0].releaseId || null,
            source: feedbackRecords[0].source || null,
            status: feedbackRecords[0].status || null,
            severity: feedbackRecords[0].severity || null,
            createdAt: feedbackRecords[0].createdAt || null,
          }
        : null,
    },
    chapterStatus: chapterStatusMd,
  };


  return manifest;
}

/**
 * 计算健康摘要（用于 Inspector 快速判断）
 */
function computeHealthSummary({ entryContract, workspaceGov, esmStateMd, deliverables, releaseManifests, stageArtifacts }) {
  const issues = [];

  if (!entryContract) issues.push({ level: 'warn', code: 'MISSING_ENTRY_CONTRACT', msg: 'entry-contract.json 缺失' });
  if (!workspaceGov) issues.push({ level: 'warn', code: 'MISSING_WORKSPACE_GOV', msg: 'workspace-governance.json 缺失' });
  if (!esmStateMd) issues.push({ level: 'warn', code: 'MISSING_ESM_STATE', msg: 'esm-state.md 缺失' });
  if (stageArtifacts.length === 0) issues.push({ level: 'info', code: 'NO_STAGE_ARTIFACTS', msg: '无 [Sx] 产出物' });

  const score = Math.max(0, 100 - issues.filter(i => i.level === 'warn').length * 15 - issues.filter(i => i.level === 'error').length * 30);

  return {
    score,
    issueCount: issues.length,
    issues,
    stageArtifactCount: stageArtifacts.length,
    deliverableCount: deliverables.length,
    releaseCount: releaseManifests.length,
  };
}

/**
 * 写入清单文件
 */
export function writeManifest(bookRoot, manifest) {
  const fbsDir = path.join(path.resolve(bookRoot), '.fbs');
  fs.mkdirSync(fbsDir, { recursive: true });

  const manifestPath = path.join(fbsDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // 同时归档历史
  const histDir = path.join(path.resolve(bookRoot), MANIFEST_HISTORY_DIR);
  fs.mkdirSync(histDir, { recursive: true });
  const histFile = path.join(histDir, `manifest-${Date.now()}.json`);
  fs.writeFileSync(histFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // 清理超过 20 条的历史
  const histFiles = fs.readdirSync(histDir)
    .filter(f => f.startsWith('manifest-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (histFiles.length > 20) {
    histFiles.slice(20).forEach(f => {
      try { fs.unlinkSync(path.join(histDir, f)); } catch { /* ignore */ }
    });
  }

  return manifestPath;
}

/**
 * 读取已有清单
 */
export function readManifest(bookRoot) {
  const manifestPath = path.join(path.resolve(bookRoot), '.fbs', MANIFEST_FILENAME);
  return safeReadJson(manifestPath);
}

/**
 * 对比当前状态与上次清单快照
 */
export function diffManifest(bookRoot) {
  const current = buildManifest(bookRoot);
  const previous = readManifest(bookRoot);

  if (!previous) {
    return { hasPrevious: false, current };
  }

  const diffs = [];

  // ESM 状态变化
  if (previous.session?.esmState !== current.session?.esmState) {
    diffs.push({ field: 'session.esmState', from: previous.session?.esmState, to: current.session?.esmState });
  }
  // 字数变化
  if (previous.session?.wordCount !== current.session?.wordCount) {
    diffs.push({ field: 'session.wordCount', from: previous.session?.wordCount, to: current.session?.wordCount });
  }
  // 章节变化
  if (previous.session?.chapterIndex !== current.session?.chapterIndex) {
    diffs.push({ field: 'session.chapterIndex', from: previous.session?.chapterIndex, to: current.session?.chapterIndex });
  }
  // deliverables 数量变化
  const prevDelCount = previous.artifacts?.deliverables?.length || 0;
  const currDelCount = current.artifacts?.deliverables?.length || 0;
  if (prevDelCount !== currDelCount) {
    diffs.push({ field: 'artifacts.deliverables.count', from: prevDelCount, to: currDelCount });
  }
  // releases 数量变化
  const prevRelCount = previous.artifacts?.releases?.length || 0;
  const currRelCount = current.artifacts?.releases?.length || 0;
  if (prevRelCount !== currRelCount) {
    diffs.push({ field: 'artifacts.releases.count', from: prevRelCount, to: currRelCount });
  }
  // 健康分变化
  if (previous.health?.score !== current.health?.score) {
    diffs.push({ field: 'health.score', from: previous.health?.score, to: current.health?.score });
  }

  return {
    hasPrevious: true,
    diffCount: diffs.length,
    diffs,
    previous: { generatedAt: previous.generatedAt, health: previous.health, session: previous.session },
    current,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, action, bookRoot = process.cwd()] = process.argv;

  if (!action || action === '--help') {
    console.log(`
工作区统一清单工具

用法:
  node workspace-manifest.mjs build <bookRoot>   构建并写入 .fbs/workspace-manifest.json
  node workspace-manifest.mjs read  <bookRoot>   读取并打印当前清单
  node workspace-manifest.mjs diff  <bookRoot>   对比当前与上次清单差异
`);
    process.exit(0);
  }

  try {
    switch (action) {
      case 'build': {
        const manifest = buildManifest(bookRoot);
        const outPath = writeManifest(bookRoot, manifest);
        console.log(`清单已写入: ${outPath}`);
        console.log(`健康分: ${manifest.health.score} | 问题: ${manifest.health.issueCount}`);
        console.log(`ESM状态: ${manifest.session.esmState || 'N/A'} | 产出物: ${manifest.health.stageArtifactCount} | 交付: ${manifest.health.deliverableCount} | 发布: ${manifest.health.releaseCount}`);
        if (manifest.health.issues.length > 0) {
          console.log('问题列表:');
          manifest.health.issues.forEach(i => console.log(`  [${i.level.toUpperCase()}] ${i.msg}`));
        }
        break;
      }
      case 'read': {
        const manifest = readManifest(bookRoot);
        if (!manifest) {
          console.log('清单不存在，请先执行 build');
        } else {
          console.log(JSON.stringify(manifest, null, 2));
        }
        break;
      }
      case 'diff': {
        const result = diffManifest(bookRoot);
        if (!result.hasPrevious) {
          console.log('无历史清单，这是首次快照');
        } else {
          console.log(`差异项: ${result.diffCount}`);
          result.diffs.forEach(d => console.log(`  ${d.field}: ${d.from} → ${d.to}`));
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
