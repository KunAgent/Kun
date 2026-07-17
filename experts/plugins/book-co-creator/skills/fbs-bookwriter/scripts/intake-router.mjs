/**
 * intake-router.mjs — FBS 主调度入口路由器（WorkBuddy / CodeBuddy 双通道）
 * FBS-BookWriter v2.1.2
 *
 * 设计目标：
 *   - 用统一的宿主快照指导入口动作
 *   - 恢复优先：优先读取 resume.json / chapter-status.md
 *   - 画像增强：检测到 WorkBuddy 画像时，为开场提供更贴合的建议
 *   - 自动补写恢复工件：host-capability / resume / session-resume-brief
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { adaptIntakeProtocol, extractUserProfile } from './workbuddy-user-profile-bridge.mjs';
import { SCENE_PACK_TIMEOUT_MS } from './intake-runtime-hooks.mjs';
import { appendTraceEvent } from './lib/fbs-trace-logger.mjs';
import { upsertBookSnippetIndex } from './lib/fbs-book-snippet-index.mjs';
import { detectHostCapability } from './host-capability-detect.mjs';
import { generateSessionSnapshot } from './workbuddy-session-snapshot.mjs';
import { applyBookMemoryTemplate } from './apply-book-memory-template.mjs';
import { runRetroToSkillCandidates } from './retro-to-skill-candidates.mjs';
import { runRuntimeNudge } from './runtime-nudge.mjs';
import { createMemoryProvider } from './lib/memory-provider.mjs';
import { createContextEngine } from './lib/context-engine.mjs';
import {
  buildGateSummary,
  buildRetroGateState,
  readFileGrowthReport,
  readP0AuditReport,
} from './lib/intake-router-gates.mjs';
import {
  getHistoricalBookShortcuts,
  getCapabilityRefreshRecommendation,
  buildDeliveryPreviewHints,
  buildSearchStrategyHints,
  buildMemoryMigrationNudge,
  buildTeamOrchestrationNudge,
  buildPrimaryOptionsHintWithHistory,
} from './lib/intake-ux-enhancements.mjs';
import { listRegistryEntries } from './lib/fbs-book-projects-registry.mjs';
import { runFileGrowthGuard } from './file-growth-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const HOST_CACHE_TTL_MS = 60 * 60 * 1000;

function loadSkillRuntimeHints() {
  const p = path.join(SKILL_ROOT, 'fbs-runtime-hints.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 报告缺失或过期时刷新体量扫描，避免 intake 长期读陈旧 JSON */
function maybeRefreshFileGrowthReport(effectiveBookRoot, effectiveFbsDir) {
  const hints = loadSkillRuntimeHints();
  if (!hints || !fs.existsSync(effectiveFbsDir)) return;
  const px = hints.performanceUx || {};
  const maxAgeH = typeof px.fileGrowthReportMaxAgeHours === 'number' ? px.fileGrowthReportMaxAgeHours : 48;
  const reportPath = path.join(effectiveFbsDir, 'file-growth-report.json');
  let stale = true;
  if (fs.existsSync(reportPath)) {
    try {
      stale = Date.now() - fs.statSync(reportPath).mtimeMs > maxAgeH * 3600000;
    } catch {
      stale = true;
    }
  }
  if (!stale) return;
  try {
    runFileGrowthGuard({
      bookRoot: effectiveBookRoot,
      enforce: false,
      maxMb: px.fileGrowthHardSingleMb ?? 8,
      maxTotalMb: px.fileGrowthHardTotalMb ?? 64,
      softMaxMb: px.fileGrowthSoftSingleMb ?? 5,
      softTotalMb: px.fileGrowthSoftTotalMb ?? 40,
      excludeAuditJsonl: px.excludeAuditJsonlFromGrowthTrack !== false,
    });
  } catch {
    /* ignore */
  }
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--book-root' && argv[i + 1]) args.bookRoot = argv[++i];
    else if (argv[i] === '--intent' && argv[i + 1]) args.intent = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--json-out' && argv[i + 1]) args.jsonOut = path.resolve(argv[++i]);
    else if (argv[i] === '--enforce-required') args.enforceRequired = true;
    else if (argv[i] === '--fast') args.fast = true;
    else if (argv[i] === '--full') args.full = true;
    else if (argv[i] === '--search' && argv[i + 1]) args.search = argv[++i];
    else if (argv[i] === '--help') args.help = true;
    else if (argv[i] === '--with-env-preflight') args.withEnvPreflight = true;
    else if (argv[i] === '--verbose-output') args.verboseOutput = true;
  }
  return args;
}

export function writeEnvPreflightArtifact(bookRoot) {
  const root = path.resolve(bookRoot);
  const fbsDir = path.join(root, '.fbs');
  try {
    fs.mkdirSync(fbsDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const script = path.join(SKILL_ROOT, 'scripts', 'env-preflight.mjs');
  const r = spawnSync(process.execPath, [script, '--json'], {
    encoding: 'utf8',
    cwd: SKILL_ROOT,
    windowsHide: true,
  });
  let payload;
  try {
    payload = JSON.parse(String(r.stdout || '').trim());
  } catch {
    payload = {
      timestamp: new Date().toISOString(),
      skillRoot: SKILL_ROOT,
      allOk: false,
      checks: [{ id: 'parse', ok: false, detail: 'env-preflight 输出非 JSON' }],
    };
  }
  try {
    fs.writeFileSync(path.join(fbsDir, 'env-preflight.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

export function readFreshHostCapability(hostCapCache) {
  if (!fs.existsSync(hostCapCache)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(hostCapCache, 'utf8'));
    const age = Date.now() - new Date(cached.detectedAt || 0).getTime();
    if (age < HOST_CACHE_TTL_MS) return cached;
  } catch {
    // ignore
  }
  return null;
}

function buildProfileContext(hostCap) {
  const workbuddyHome = hostCap?.workbuddy?.homeDir;
  if (!workbuddyHome || hostCap?.hostType !== 'workbuddy') return { profile: null, intakeProfile: null };

  try {
    const profile = extractUserProfile(workbuddyHome);
    const intakeProfile = adaptIntakeProtocol(profile);
    return { profile, intakeProfile };
  } catch {
    return { profile: null, intakeProfile: null };
  }
}

function readResumeCard(resolvedFbsDir) {
  const resumePath = path.join(resolvedFbsDir, 'workbuddy-resume.json');
  if (!fs.existsSync(resumePath)) return null;
  try {
    const card = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    const chapterCount = Number(card.chapterCount) || 0;
    let completedCount = Number(card.completedCount) || 0;
    if (chapterCount > 0) {
      completedCount = Math.min(completedCount, chapterCount);
    }
    return {
      path: resumePath,
      bookTitle: card.bookTitle || null,
      currentStage: card.currentStage || null,
      wordCount: card.wordCount || 0,
      targetWordCount: card.targetWordCount != null ? Number(card.targetWordCount) : null,
      chapterCount,
      completedCount,
      nextSuggested: card.nextSuggested || null,
      updatedAt: card.updatedAt || null,
    };
  } catch {
    return null;
  }
}

/**
 * 在起始目录下做有限深度扫描，查找含 `.fbs/chapter-status.md` 的书稿根（P1-01 跨目录发现）
 */
function findNestedBookRootWithChapterStatus(startDir, maxDepth, maxNodes) {
  const start = path.resolve(startDir);
  const queue = [{ dir: start, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  while (queue.length && nodes < maxNodes) {
    const { dir, depth } = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    nodes += 1;
    const marker = path.join(dir, '.fbs', 'chapter-status.md');
    if (fs.existsSync(marker)) return dir;
    if (depth >= maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === 'node_modules') continue;
      if (ent.name.startsWith('.') && ent.name !== '.') continue;
      queue.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
    }
  }
  return null;
}

function collectNestedBookRoots(startDir, maxDepth, maxNodes, maxResults = 12) {
  const start = path.resolve(startDir);
  const queue = [{ dir: start, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  const hits = [];
  while (queue.length && nodes < maxNodes && hits.length < maxResults) {
    const { dir, depth } = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    nodes += 1;
    const fbs = path.join(dir, '.fbs');
    if (fs.existsSync(path.join(fbs, 'chapter-status.md')) || fs.existsSync(path.join(fbs, 'workbuddy-resume.json'))) {
      hits.push(dir);
    }
    if (depth >= maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === 'node_modules') continue;
      if (ent.name.startsWith('.') && ent.name !== '.') continue;
      queue.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
    }
  }
  return hits;
}

function scoreProjectAnchorCandidate(bookRoot) {
  const fbsDir = path.join(bookRoot, '.fbs');
  const reasons = [];
  let score = 0;
  const push = (ok, weight, reason) => {
    if (!ok) return;
    score += weight;
    reasons.push(reason);
  };
  push(fs.existsSync(path.join(fbsDir, 'chapter-status.md')), 4, '存在 chapter-status');
  push(fs.existsSync(path.join(fbsDir, 'workbuddy-resume.json')), 3, '存在恢复卡');
  push(fs.existsSync(path.join(fbsDir, 'esm-state.md')), 2, '存在 ESM 状态');
  push(fs.existsSync(path.join(fbsDir, 'material-library.md')), 2, '存在素材库');
  push(fs.existsSync(path.join(fbsDir, 'smart-memory', 'session-resume-brief.md')), 1, '存在会话摘要');
  push(fs.existsSync(path.join(bookRoot, 'deliverables')), 1, '存在 deliverables');
  push(fs.existsSync(path.join(bookRoot, 'releases')), 1, '存在 releases');
  return { score: Math.max(score, 1), reasons };
}

function collectPathHintsFromText(text) {
  const out = new Set();
  const s = String(text || '');
  const re = /[A-Za-z]:\\[^\s"'`<>|]+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let p = m[0].replace(/[),.;]+$/g, '');
    if (/\\\.fbs$/i.test(p)) p = path.dirname(p);
    if (/\\\.fbs\\/i.test(p)) p = p.slice(0, p.toLowerCase().indexOf('\\.fbs'));
    if (p) out.add(path.resolve(p));
  }
  return [...out];
}

function collectProjectHintsFromLocalMemory(resolvedBookRoot) {
  const files = [
    path.join(resolvedBookRoot, '.fbs', 'workbuddy-resume.json'),
    path.join(resolvedBookRoot, '.fbs', 'smart-memory', 'session-resume-brief.md'),
    path.join(resolvedBookRoot, '.fbs', 'MEMORY.md'),
    path.join(resolvedBookRoot, '.fbs', 'book-context-brief.md'),
  ];
  const hints = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      for (const hit of collectPathHintsFromText(raw)) {
        if (hit && hit !== resolvedBookRoot) hints.add(hit);
      }
    } catch {
      // ignore
    }
  }
  return [...hints];
}

function listWindowsDriveRoots() {
  const roots = [];
  for (let i = 67; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      // ignore
    }
  }
  return roots;
}

function collectExternalDriveFbsRoots(resolvedBookRoot, maxResults = 8) {
  if (process.platform !== 'win32') return [];
  const currentDrive = path.parse(resolvedBookRoot).root.toLowerCase();
  const out = [];
  for (const driveRoot of listWindowsDriveRoots()) {
    if (driveRoot.toLowerCase() === currentDrive) continue;
    let lv1 = [];
    try {
      lv1 = fs.readdirSync(driveRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d1 of lv1) {
      if (!d1.isDirectory()) continue;
      const n1 = d1.name;
      if (/^(windows|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information)$/i.test(n1)) continue;
      const p1 = path.join(driveRoot, n1);
      if (fs.existsSync(path.join(p1, '.fbs', 'chapter-status.md')) || fs.existsSync(path.join(p1, '.fbs', 'workbuddy-resume.json'))) {
        out.push(path.resolve(p1));
        if (out.length >= maxResults) return out;
      }
      let lv2 = [];
      try {
        lv2 = fs.readdirSync(p1, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d2 of lv2) {
        if (!d2.isDirectory()) continue;
        const p2 = path.join(p1, d2.name);
        if (fs.existsSync(path.join(p2, '.fbs', 'chapter-status.md')) || fs.existsSync(path.join(p2, '.fbs', 'workbuddy-resume.json'))) {
          out.push(path.resolve(p2));
          if (out.length >= maxResults) return out;
        }
      }
    }
  }
  return out;
}

function detectProjectAnchor(resolvedBookRoot) {
  const candidatesMap = new Map();
  const addCandidate = (dir, source) => {
    const normalized = path.resolve(dir);
    if (!fs.existsSync(path.join(normalized, '.fbs'))) return;
    if (candidatesMap.has(normalized)) return;
    const scored = scoreProjectAnchorCandidate(normalized);
    candidatesMap.set(normalized, {
      bookRoot: normalized,
      source,
      score: scored.score,
      reasons: scored.reasons,
      label: path.basename(normalized) || normalized,
    });
  };

  addCandidate(resolvedBookRoot, 'current-book-root');
  try {
    const entries = fs.readdirSync(resolvedBookRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      addCandidate(path.join(resolvedBookRoot, entry.name), 'direct-child');
    }
  } catch {
    // ignore
  }
  for (const nested of collectNestedBookRoots(resolvedBookRoot, 2, 64, 12)) {
    addCandidate(nested, 'nested');
  }
  for (const hintedRoot of collectProjectHintsFromLocalMemory(resolvedBookRoot)) {
    addCandidate(hintedRoot, 'memory-path-hint');
  }
  const hasCurrentFbs = fs.existsSync(path.join(resolvedBookRoot, '.fbs'));
  const allowCrossRootAnchorScan =
    hasCurrentFbs &&
    (fs.existsSync(path.join(resolvedBookRoot, '.fbs', 'material-library.md')) ||
      fs.existsSync(path.join(resolvedBookRoot, '.fbs', 'MEMORY.md')));
  if (allowCrossRootAnchorScan) {
    const recentCutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const registryEntries = listRegistryEntries()
      .filter((row) => {
        if (!row || !row.bookRoot) return false;
        if (!row.lastExitAt) return true;
        const ts = new Date(row.lastExitAt).getTime();
        return Number.isFinite(ts) ? ts >= recentCutoff : true;
      })
      .slice(0, 12);
    for (const row of registryEntries) {
      const root = path.resolve(String(row.bookRoot));
      if (!root || root === resolvedBookRoot) continue;
      addCandidate(root, 'registry');
    }
    if (candidatesMap.size <= 1) {
      for (const extRoot of collectExternalDriveFbsRoots(resolvedBookRoot, 8)) {
        addCandidate(extRoot, 'external-drive-scan');
      }
    }
  }

  const candidates = [...candidatesMap.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.bookRoot.localeCompare(b.bookRoot, 'zh-Hans-CN');
  });
  if (candidates.length <= 1) {
    return {
      status: 'locked',
      selectedBookRoot: candidates[0]?.bookRoot || resolvedBookRoot,
      candidates,
      confidence: candidates.length ? 'single' : 'explicit',
    };
  }

  const [top, second] = candidates;
  if ((top?.score || 0) - (second?.score || 0) >= 2) {
    return {
      status: 'locked',
      selectedBookRoot: top.bookRoot,
      candidates,
      confidence: 'auto',
      autoSelected: true,
      autoSelectedReason: `候选评分领先（${top.score} vs ${second.score}）`,
    };
  }

  return {
    status: 'ambiguous',
    selectedBookRoot: null,
    candidates,
    confidence: 'ambiguous',
    prompt:
      '检测到多个可能的书稿根目录。请先确认当前项目路径，再继续读取 .fbs 台账与执行后续流程。',
  };
}

function resolveEffectiveBookRoot(resolvedBookRoot) {
  const rootFbs = path.join(resolvedBookRoot, '.fbs');
  if (fs.existsSync(rootFbs)) {
    return { effectiveBookRoot: resolvedBookRoot, subDirBookRoot: null };
  }

  try {
    const entries = fs.readdirSync(resolvedBookRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const subFbs = path.join(resolvedBookRoot, entry.name, '.fbs', 'chapter-status.md');
      if (fs.existsSync(subFbs)) {
        return {
          effectiveBookRoot: path.join(resolvedBookRoot, entry.name),
          subDirBookRoot: path.join(resolvedBookRoot, entry.name),
        };
      }
    }
  } catch {
    // ignore
  }

  const nested = findNestedBookRootWithChapterStatus(resolvedBookRoot, 2, 48);
  if (nested) {
    return { effectiveBookRoot: nested, subDirBookRoot: nested };
  }

  return { effectiveBookRoot: resolvedBookRoot, subDirBookRoot: null };
}

function hasMemoryBriefSource(effectiveBookRoot, effectiveFbsDir, memoryProvider) {
  const providerFiles = memoryProvider?.getMeta?.().files || {};
  return [
    path.join(effectiveFbsDir, 'chapter-status.md'),
    path.join(effectiveFbsDir, 'workbuddy-resume.json'),
    path.join(effectiveFbsDir, 'smart-memory', 'memory.json'),
    providerFiles.sessionBrief,
    providerFiles.resumeCard,
    path.join(effectiveFbsDir, 'book-context-brief.md'),
    path.join(effectiveBookRoot, 'GLOSSARY.md'),
  ].filter(Boolean).some((file) => fs.existsSync(file));
}

async function ensureRuntimeArtifacts(resolvedBookRoot, effectiveBookRoot, effectiveFbsDir, memoryProvider) {
  const hostCapCache = path.join(effectiveFbsDir, 'host-capability.json');
  let hostCap = readFreshHostCapability(hostCapCache);
  let hostCapabilityAutoRefreshed = false;
  let hostCapabilityError = null;

  if (!hostCap) {
    try {
      hostCap = await detectHostCapability({
        bookRoot: effectiveBookRoot,
        skillRoot: SKILL_ROOT,
        fbsDir: effectiveFbsDir,
      });
      hostCapabilityAutoRefreshed = true;
    } catch (error) {
      hostCapabilityError = error.message;
    }
  }

  const chapterStatus = path.join(effectiveFbsDir, 'chapter-status.md');
  const esmState = path.join(effectiveFbsDir, 'esm-state.md');
  const resumeJson = path.join(effectiveFbsDir, 'workbuddy-resume.json');
  const memoryBrief = path.join(effectiveFbsDir, 'smart-memory', 'session-resume-brief.md');

  let resumeSnapshotRegenerated = false;
  let memoryBriefRegenerated = false;
  const artifactErrors = [];

  if (!fs.existsSync(resumeJson) && (fs.existsSync(chapterStatus) || fs.existsSync(esmState))) {
    try {
      await generateSessionSnapshot({ fbsDir: effectiveFbsDir, quiet: true });
      resumeSnapshotRegenerated = fs.existsSync(resumeJson);
      if (!resumeSnapshotRegenerated) artifactErrors.push('恢复卡补写后仍未生成 workbuddy-resume.json');
    } catch (error) {
      artifactErrors.push(`恢复卡补写失败：${error.message}`);
    }
  }

  if (!fs.existsSync(memoryBrief) && hasMemoryBriefSource(effectiveBookRoot, effectiveFbsDir, memoryProvider)) {
    try {
      applyBookMemoryTemplate({ bookRoot: effectiveBookRoot, quiet: true });
      memoryBriefRegenerated = fs.existsSync(memoryBrief);
      if (!memoryBriefRegenerated) artifactErrors.push('会话摘要补写后仍未生成 session-resume-brief.md');
    } catch (error) {
      artifactErrors.push(`会话摘要补写失败：${error.message}`);
    }
  }

  const { profile, intakeProfile } = buildProfileContext(hostCap);
  const retroGate = buildRetroGateState(effectiveBookRoot);
  const retroSkillCandidates = runRetroToSkillCandidates({ bookRoot: effectiveBookRoot });
  const runtimeNudges = runRuntimeNudge({ bookRoot: effectiveBookRoot });

  return {
    hostCap,
    hostCapabilityAutoRefreshed,
    hostCapabilityError,
    resumeSnapshotRegenerated,
    memoryBriefRegenerated,
    artifactErrors,
    profile,
    intakeProfile,
    retroGate,
    retroSkillCandidates,
    runtimeNudges,
  };
}

export async function detectEnv(resolvedBookRoot, opts = {}) {
  const intakeFast = !!opts.fast;
  const projectAnchor = detectProjectAnchor(resolvedBookRoot);
  if (projectAnchor.status === 'ambiguous') {
    return {
      bookRoot: resolvedBookRoot,
      effectiveBookRoot: resolvedBookRoot,
      fbsDir: path.join(resolvedBookRoot, '.fbs'),
      hadFbsBeforeInit: fs.existsSync(path.join(resolvedBookRoot, '.fbs')),
      hasFbs: fs.existsSync(path.join(resolvedBookRoot, '.fbs')),
      hasProjectArtifacts: false,
      hasChapterStatus: false,
      hasResumeJson: false,
      hasMemoryBrief: false,
      subDirBookRoot: null,
      hostCap: null,
      hostCapabilityAutoRefreshed: false,
      hostCapabilityError: null,
      resumeSnapshotRegenerated: false,
      memoryBriefRegenerated: false,
      artifactErrors: [],
      profile: null,
      intakeProfile: null,
      retroGate: null,
      retroSkillCandidates: null,
      runtimeNudges: null,
      p0AuditReport: null,
      fileGrowthReport: null,
      memoryProvider: null,
      contextEngine: null,
      _contextEngine: null,
      resumeCard: null,
      runtimeHooks: {
        esmGenreSynced: false,
        scenePackId: 'general',
        scenePackLoaded: false,
        registerBookAttempted: false,
        notes: [],
        errors: [],
      },
      intakeFast,
      projectAnchor,
    };
  }

  const anchorRoot = projectAnchor.selectedBookRoot || resolvedBookRoot;
  const { effectiveBookRoot, subDirBookRoot } = resolveEffectiveBookRoot(anchorRoot);
  const effectiveFbsDir = path.join(effectiveBookRoot, '.fbs');
  const memoryProvider = createMemoryProvider({
    bookRoot: effectiveBookRoot,
    fbsDir: effectiveFbsDir,
    provider: 'builtin',
  });
  const hadFbsBeforeInit = fs.existsSync(effectiveFbsDir);

  const runtime = await ensureRuntimeArtifacts(resolvedBookRoot, effectiveBookRoot, effectiveFbsDir, memoryProvider);
  const p0AuditReport = readP0AuditReport(effectiveFbsDir);
  maybeRefreshFileGrowthReport(effectiveBookRoot, effectiveFbsDir);
  const fileGrowthReport = readFileGrowthReport(effectiveFbsDir);

  let runtimeHooks = {
    esmGenreSynced: false,
    scenePackId: 'general',
    scenePackLoaded: false,
    registerBookAttempted: false,
    notes: [],
    errors: [],
  };
  if (fs.existsSync(effectiveFbsDir)) {
    try {
      const { maybeSyncEsmGenreAndScenePack } = await import('./intake-runtime-hooks.mjs');
      runtimeHooks = await maybeSyncEsmGenreAndScenePack(effectiveBookRoot, effectiveFbsDir, {
        quiet: true,
        fast: intakeFast,
      });
    } catch (error) {
      runtimeHooks.errors.push(`runtime-hooks: ${error.message}`);
    }
  }

  const contextEngine = createContextEngine({
    scenePackId: runtimeHooks.scenePackId || 'general',
    bookRoot: effectiveBookRoot,
  });

  const chapterStatus = path.join(effectiveFbsDir, 'chapter-status.md');
  const resumeJson = path.join(effectiveFbsDir, 'workbuddy-resume.json');
  const memoryBrief = path.join(effectiveFbsDir, 'smart-memory', 'session-resume-brief.md');
  const resumeCard = readResumeCard(effectiveFbsDir);

  const hasProjectArtifacts = [
    chapterStatus,
    resumeJson,
    memoryBrief,
    path.join(effectiveFbsDir, 'book-context-brief.md'),
    path.join(effectiveBookRoot, 'deliverables'),
    path.join(effectiveBookRoot, 'releases'),
  ].some((target) => fs.existsSync(target));

  return {
    bookRoot: resolvedBookRoot,
    effectiveBookRoot,
    fbsDir: effectiveFbsDir,
    hadFbsBeforeInit,
    hasFbs: fs.existsSync(effectiveFbsDir),
    hasProjectArtifacts,
    hasChapterStatus: fs.existsSync(chapterStatus),
    hasResumeJson: fs.existsSync(resumeJson),
    hasMemoryBrief: fs.existsSync(memoryBrief),
    subDirBookRoot,
    hostCap: runtime.hostCap,
    hostCapabilityAutoRefreshed: runtime.hostCapabilityAutoRefreshed,
    hostCapabilityError: runtime.hostCapabilityError,
    resumeSnapshotRegenerated: runtime.resumeSnapshotRegenerated,
    memoryBriefRegenerated: runtime.memoryBriefRegenerated,
    artifactErrors: runtime.artifactErrors,
    profile: runtime.profile,
    intakeProfile: runtime.intakeProfile,
    retroGate: runtime.retroGate,
    retroSkillCandidates: runtime.retroSkillCandidates,
    runtimeNudges: runtime.runtimeNudges,
    p0AuditReport,
    fileGrowthReport,
    memoryProvider: memoryProvider.getMeta(),
    contextEngine: contextEngine.getMeta(),
    _contextEngine: contextEngine,
    resumeCard,
    runtimeHooks,
    intakeFast,
    projectAnchor,
  };
}

export function resolveIntent(intent, env) {
  if (intent !== 'auto') return normalizeIntent(intent);
  if (env.hasChapterStatus || env.hasResumeJson || env.subDirBookRoot) return 'resume';
  return 'new-session';
}

function resolveEntryState(env, intent) {
  if (intent === 'exit') return 'E7-Exit';
  if (env.projectAnchor?.status === 'ambiguous') return 'E0-ProjectAnchor';
  if (!env.hasFbs && !env.hasProjectArtifacts) return 'E1-ColdStart';
  if (env.hasResumeJson && env.resumeCard?.updatedAt) return 'E2-HotResume';
  if (env.hasChapterStatus && !env.hasResumeJson) return 'E3-StaleResume';
  if (['qc', 'rewrite', 'edit', 'inspect', 'init', 'resume', 'new-session'].includes(intent)) return 'E4-IntentRoute';
  return 'E6-Execute';
}

function resolveNextState(entryState, intent, readyToProceed) {
  if (entryState === 'E0-ProjectAnchor') return 'E0-ProjectAnchor';
  if (!readyToProceed) return 'E5-RiskGate';
  if (intent === 'exit') return 'E7-Exit';
  if (entryState === 'E1-ColdStart' || entryState === 'E2-HotResume' || entryState === 'E3-StaleResume' || entryState === 'E4-IntentRoute') {
    return 'E6-Execute';
  }
  return 'E6-Execute';
}

function normalizeIntent(intent) {
  const raw = String(intent || '').trim().toLowerCase();
  if (!raw) return intent;
  const rewriteAliases = new Set([
    'rewrite',
    'rewrite-book',
    'book-rewrite',
    'rewrite_mode',
    '拆书',
    '拆书改写',
    '改写',
  ]);
  if (rewriteAliases.has(raw)) return 'rewrite';
  return intent;
}

function formatRoutingModeLabel(mode) {
  const m = String(mode || '').trim();
  if (m === 'hybrid') return '双轨';
  if (m === 'workbuddy_only' || m === 'workbuddy') return 'WorkBuddy';
  if (m === 'codebuddy_only' || m === 'codebuddy') return 'CodeBuddy';
  return m || '—';
}

function pushHostInfo(info, hostCap) {
  if (!hostCap) return;
  info.push(`宿主模式：${formatRoutingModeLabel(hostCap.routingMode)}（原始值 ${hostCap.routingMode || '—'}，对用户的说明请用人话转述）`);

  if (hostCap.tier1?.marketplaceSummary) {
    info.push(
      `本地市场增强技能概览：${hostCap.tier1.marketplaceSummary} 项已装或可探测（未装全时按宿主能力降级，属正常）`,
    );
  }

  const tier1Available = hostCap.tier1?.relevantSkills?.available || [];
  if (tier1Available.length > 0) {
    info.push(`本地市场可用增强技能（节选）：${tier1Available.slice(0, 6).join('、')}`);
  }

  const enabledPlugins = hostCap.plugins?.available || [];
  if (enabledPlugins.length > 0) {
    info.push(`已启用插件：${enabledPlugins.join('、')}`);
  }
}

function formatWordCountCn(n) {
  const x = Number(n) || 0;
  if (x <= 0) return null;
  if (x >= 10000) {
    const w = x / 10000;
    const rounded = Math.round(w * 10) / 10;
    if (rounded >= 100) return `${Math.round(w)}万字`;
    return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)}万字`;
  }
  return `${x}字`;
}

function buildStallPreventionUserHint(env) {
  const fg = env.fileGrowthReport;
  if (!fg) return '';
  if (fg.parseError) return '书稿目录体量报告异常，建议在方便时重跑文件增长检查。';
  if ((fg.alerts || []).length > 0) {
    return '当前书稿目录里有大文件或追踪总量偏高，先整理再继续，避免越写越卡。';
  }
  if ((fg.advisoryAlerts || []).length > 0) {
    return '部分追踪文件接近体积上限，有空时建议归档或拆分，减少以后卡顿。';
  }
  return '';
}

function buildUserValueSnapshot(hints, env) {
  const p = hints?.performanceUx;
  if (!p) return null;
  const r = env.resumeCard;
  const rich =
    r &&
    (Number(r.wordCount) > 0 ||
      Number(r.chapterCount) > 0 ||
      (r.bookTitle && String(r.bookTitle).trim()));
  const intent = env._resolvedIntent;
  const show = !rich || intent === 'new-session';
  return {
    headline: p.userValueHeadlineZh || null,
    bullets: Array.isArray(p.userValueBulletsZh) ? p.userValueBulletsZh.slice(0, 4) : [],
    showAsSecondaryLine: !!show,
  };
}

function buildCognitiveAssetSnapshot(hints, env) {
  const c = hints?.cognitiveAsset;
  if (!c || typeof c !== 'object') return null;
  const intent = String(env?._resolvedIntent || '');
  const recommendedAction = intent === 'rewrite' ? '拆书式改写' : '写作主线';
  return {
    oneLiner: c.userValueOneLinerZh || null,
    threeization: Array.isArray(c.threeizationZh) ? c.threeizationZh.slice(0, 3) : [],
    commercialEngine: Array.isArray(c.commercialEngineZh) ? c.commercialEngineZh.slice(0, 3) : [],
    recommendedAction,
  };
}

function buildTermValueGlossary() {
  return [
    { term: '.fbs/workbuddy-resume.json', role: '会话恢复卡', userValue: '下次继续时不必重讲背景，直接从上次断点开工。' },
    { term: '.fbs/chapter-status.md', role: '章节进度台账', userValue: '随时看每章状态、字数和下一步，避免漏章或重复写。' },
    { term: '.fbs/material-library.md', role: '素材主仓', userValue: '把零散资料转成可复用素材池，后续写作与扩写更快更稳。' },
    { term: '.fbs/esm-state.md', role: '阶段状态机记录', userValue: '明确当前处在哪个阶段，减少“卡在某一步”或越阶段操作。' },
    { term: 'deliverables/', role: '可交付目录', userValue: '这里放给读者/客户看的最终成品，不混杂过程文件。' },
    { term: 'releases/', role: '发布目录', userValue: '集中管理对外发布版本，便于追踪历史与回滚。' },
    { term: 's0-exit-gate', role: 'S0退出门禁', userValue: '保证素材与主张达标后再推进，避免早推或无限停留。' },
    { term: 'polish-gate', role: '精修门禁', userValue: '精修前自动备份并质检，降低误改和不可逆风险。' },
    { term: 'release-governor', role: '终稿治理器', userValue: '自动保留唯一终稿并归档旧版本，减少交付版本混乱。' },
    { term: 'material-marker-governor', role: '素材标记治理器', userValue: '扫描并清理待核实/废弃标注，避免把内部标记暴露给读者。' },
    { term: 'scene-packs', role: '场景包机制', userValue: '把通用写作能力按垂直场景打包，形成可分发的专业能力层。' },
    { term: 'credits-ledger', role: '乐包机制', userValue: '记录可累计的本地激励点数，用于解锁增值场景与能力。' },
    { term: 'offline-online-upgrade', role: '离线-在线会员机制', userValue: '离线保障基础可用，在线提供增强能力与持续升级路径。' },
  ];
}

function buildClarifyContracts() {
  return {
    qualityScope: {
      question: '你要质检哪个范围？',
      options: [
        { id: 'final-manuscript', label: '终稿（合并稿）' },
        { id: 'deliverables', label: '单章（deliverables）' },
        { id: 'full', label: '全量（终稿+单章）' },
      ],
      defaultOptionId: 'full',
    },
    rewriteEntry: {
      question: '你希望采用哪种改写入口？',
      options: [
        { id: 'legacy-book-upgrade', label: '自有旧书升级' },
        { id: 'overseas-localization', label: '海外内容本地化' },
        { id: 'bestseller-remix', label: '爆款结构重构' },
      ],
      defaultOptionId: 'legacy-book-upgrade',
    },
  };
}

function buildCapabilityBudget(env) {
  const enabled = Array.isArray(env?.hostCap?.plugins?.enabled) ? env.hostCap.plugins.enabled : [];
  const stage = String(env?.resumeCard?.currentStage || 'S0');
  const light = ['find-skills', 'docx', 'pdf', 'xlsx'];
  const heavy = ['playwright-cli', 'pptx'];
  const stageTarget = /S[4-6]/i.test(stage) ? [...light, ...heavy] : [...light];
  return {
    maxPrimaryOptions: 3,
    maxPrimaryCapabilities: 3,
    stage,
    stageTargetPlugins: stageTarget,
    enabledPlugins: enabled,
    enabledTargetPlugins: stageTarget.filter((x) => enabled.includes(x)),
  };
}

function buildPluginPhaseRoutingMatrix(env) {
  const enabled = Array.isArray(env?.hostCap?.plugins?.enabled) ? env.hostCap.plugins.enabled : [];
  const matrix = {
    S0: { newSession: ['find-skills'], resume: ['find-skills'], qc: ['docx', 'pdf'], rewrite: ['find-skills'] },
    S1: { newSession: ['find-skills', 'xlsx'], resume: ['find-skills'], qc: ['docx', 'pdf'], rewrite: ['find-skills'] },
    S3: { newSession: ['find-skills', 'xlsx'], resume: ['find-skills'], qc: ['docx', 'pdf', 'playwright-cli'], rewrite: ['find-skills', 'xlsx'] },
    S4: { newSession: ['find-skills', 'xlsx'], resume: ['find-skills'], qc: ['docx', 'pdf', 'playwright-cli'], rewrite: ['find-skills', 'xlsx', 'pptx'] },
    S6: { newSession: ['find-skills'], resume: ['find-skills'], qc: ['docx', 'pdf', 'playwright-cli'], rewrite: ['find-skills'] },
  };
  const enabledMatrix = {};
  for (const [stage, intents] of Object.entries(matrix)) {
    enabledMatrix[stage] = {};
    for (const [intent, plugins] of Object.entries(intents)) {
      enabledMatrix[stage][intent] = plugins.filter((p) => enabled.includes(p));
    }
  }
  return {
    mode: 'intent-stage-matrix',
    matrix,
    enabledMatrix,
    enabledPlugins: enabled,
  };
}

function appendIntakeRoutingKpiLog(bookRoot, payload) {
  try {
    const dir = path.join(bookRoot, '.fbs', 'governance');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'intake-routing-kpi.jsonl'), `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function pickChannelSessionDefaults(hints) {
  const ch = hints?.channelSessionDefaults;
  if (!ch || typeof ch !== 'object') return null;
  return {
    recursionLimit: ch.recursionLimit,
    intakeEnforceRequiredDefault: ch.intakeEnforceRequiredDefault,
    subagentOrWorkerTasksDefault: ch.subagentOrWorkerTasksDefault,
    defaultIntakeFast: ch.defaultIntakeFast,
    thinkingHintsInAgentContextDefault: ch.thinkingHintsInAgentContextDefault,
  };
}

function buildSubTaskDecompositionContract(hints) {
  const st = hints?.subTaskContract;
  if (!st || typeof st !== 'object') return null;
  const doc = st.documentationRelativePath;
  const timeout = typeof st.defaultTimeoutSeconds === 'number' ? st.defaultTimeoutSeconds : 900;
  return {
    contractVersion: st.contractVersion || '1',
    documentationRelativePath: typeof doc === 'string' ? doc : null,
    defaultTimeoutSeconds: timeout,
    maxConcurrentHints: typeof st.maxConcurrentHints === 'number' ? st.maxConcurrentHints : 3,
    intakeJsonPath:
      typeof st.firstResponseJsonPath === 'string'
        ? st.firstResponseJsonPath
        : 'firstResponseContext.subTaskDecompositionContract',
    exampleWorkerItem: {
      id: 'example-aux-1',
      title: '（示例）后台检索或质检子任务',
      timeoutSeconds: timeout,
      outputRelativePathHint: '.fbs/auxiliary/outputs/example-result.json',
      kind: 'other',
    },
  };
}

/** 终端用户只看这一行（+3 个选项），勿堆 intake 全文 JSON / SKILL 规范（WorkBuddy 实测 P0-1） */
function buildUserFacingOneLiner(env) {
  const r = env.resumeCard;
  const fbsLine = env.hasFbs ? '书稿目录已就绪' : '书稿目录尚未初始化虚拟书房';
  if (r && (r.bookTitle || r.wordCount > 0 || r.targetWordCount > 0 || r.currentStage || r.chapterCount > 0)) {
    const title = (r.bookTitle && String(r.bookTitle).trim()) || '书稿';
    const wcNum = Math.max(Number(r.wordCount) || 0, Number(r.targetWordCount) || 0);
    const wc = formatWordCountCn(wcNum);
    const st = r.currentStage || '—';
    const nch = Number(r.chapterCount) || 0;
    const ndoneRaw = Number(r.completedCount) || 0;
    const ndone = nch > 0 ? Math.min(ndoneRaw, nch) : ndoneRaw;
    const chPart = nch > 0 ? `，进度约 ${ndone}/${nch} 章` : '';
    const wcPart = wc ? `约${wc}` : '';
    const core = [wcPart, `${st}${chPart}`].filter(Boolean).join('，');
    return `${title}已就绪（${core}）。这次想做什么？`;
  }
  return `福帮手已就绪，${fbsLine}。这次想做什么？`;
}

function buildBlockedUserDecisionHint(env) {
  const gate = env.gateSummary;
  if (!gate || gate.status !== 'blocked') return null;
  const reasonCount = Array.isArray(gate.reasons) ? gate.reasons.length : 1;
  return `书稿已就绪，但有 ${reasonCount} 项风险待处理。你可以先继续写作，我会同步提示风险与最短修复路径。`;
}

function sanitizeUserFacingLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return '福帮手已就绪。这次想做什么？';
  // 防宿主误注入内部口径：用户可见文案禁止暴露内部术语
  if (/(tier|json|schema|gate|contract|canonical|firstresponsecontext|routingmode|host[- ]?type)/i.test(raw)) {
    return '福帮手已就绪。这次想做什么？';
  }
  return raw;
}

function buildVersionObservability(env) {
  const v = env.hostCap?.skillVersion || {};
  const data = env.hostCap?.dataCompatibility || {};
  const runtime = v.runtime || null;
  const target = v.target || runtime || null;
  const needsMigration = data.status === 'needs_migration';
  return {
    runtimeSkillVersion: runtime,
    targetSkillVersion: target,
    recommendUpgrade: !!v.recommendUpgrade,
    upgradeMode: v.upgradeMode || 'overwrite-code',
    sourceMismatch: !!v.mismatch,
    dataCompatibility: {
      status: data.status || 'unknown',
      issueCount: Number(data.issueCount) || 0,
      issues: Array.isArray(data.issues) ? data.issues : [],
      mode: data.mode || (needsMigration ? 'compatibility' : 'standard'),
      note: data.note || null,
    },
    compatibilityModeEnabled: needsMigration,
  };
}

function inferGoalImpact(action, intent) {
  const text = `${action?.label || ''} ${action?.reason || ''} ${action?.action || ''} ${action?.cmd || ''}`.toLowerCase();
  if (/(质检|quality|audit|polish|去ai|全量质检|终稿|deliverables)/i.test(text)) return 'quality';
  if (/(缓存|cleanup|fbs-cleanup|门禁|gate|修复|环境|锚点|host-capability|刷新|兼容|migration|governance)/i.test(text)) {
    return 'maintenance';
  }
  if (intent === 'qc') return 'quality';
  if (intent === 'inspect') return 'maintenance';
  if (intent === 'exit') return 'maintenance';
  return 'writing';
}

function enrichActionsWithGoalImpact(actions, intent) {
  return (actions || []).map((a) => {
    const goalImpact = inferGoalImpact(a, intent);
    const hasReason = typeof a?.reason === 'string' && a.reason.trim().length > 0;
    const hasAction = typeof a?.action === 'string' && a.action.trim().length > 0;
    const normalizedReason =
      goalImpact !== 'writing' && !hasReason && !hasAction
        ? '保障流程稳定与结果可复核，处理完成后继续写作主流程。'
        : a.reason;
    return {
      ...a,
      reason: normalizedReason,
      goalImpact,
      priorityTier: goalImpact === 'writing' ? 'primary' : 'secondary',
    };
  });
}

function buildUserVisibleTechActionNarration(hints) {
  const ux = hints?.userExperience || {};
  const narration = ux?.visibleTechActionNarration || {};
  const fallback = {
    beforeAction:
      '我先做一个必要的后台处理（不影响你的书稿内容），目的是让接下来的写作更稳定、更少中断。',
    inProgress: '处理中，大约需要几十秒；完成后我会立刻回到你的写作目标。',
    afterSuccess: '处理完成。这样做的价值是减少后续卡顿和误报，我们继续写作。',
    afterFallback:
      '这个处理未完全成功，但你的写作主流程仍可继续。我会给出最短替代方案，并尽量不打断你的创作节奏。',
  };
  return {
    beforeAction: typeof narration.beforeAction === 'string' && narration.beforeAction.trim()
      ? narration.beforeAction.trim()
      : fallback.beforeAction,
    inProgress: typeof narration.inProgress === 'string' && narration.inProgress.trim()
      ? narration.inProgress.trim()
      : fallback.inProgress,
    afterSuccess: typeof narration.afterSuccess === 'string' && narration.afterSuccess.trim()
      ? narration.afterSuccess.trim()
      : fallback.afterSuccess,
    afterFallback: typeof narration.afterFallback === 'string' && narration.afterFallback.trim()
      ? narration.afterFallback.trim()
      : fallback.afterFallback,
  };
}

function buildFirstResponseContext(env) {
  const hints = env.skillRuntimeHints || loadSkillRuntimeHints() || {};
  const healthMatrix = env.healthMatrix || buildHealthMatrix(env);
  const contextEngine = env._contextEngine;
  const cap = env.hostCap;
  const plugins = cap?.plugins?.enabled?.length ? cap.plugins.enabled : cap?.plugins?.available || [];
  const routingLabel = formatRoutingModeLabel(cap?.routingMode);
  const fbsLine = env.hasFbs ? '书稿目录已就绪' : '书稿目录尚未初始化虚拟书房';
  const artifactLine = env.hasProjectArtifacts ? '检测到可续写的进度或素材线索' : '当前位置暂无可直接续写的书房台账，将进入轻量引导';
  /** 对用户转述用人话，勿照搬 Tier/插件代号；2026-04-13 WorkBuddy 实测：首屏忌冗长菜单（P0-1） */
  const retroHint = env.retroGate?.hasUnresolvedP0
    ? '检测到上次复盘仍有待处理项，首屏保持写作优先，同时给出风险提示与查看清单入口。'
    : '';
  const recommendedOneLiner = `福帮手已就绪（${routingLabel}）。${fbsLine}；${artifactLine}。首句只问「要做什么？」并最多给 3 个主选项：开始写作、继续写作、本章计划；质检/排障放二级入口，需要更多时再展开「其他」。勿首屏平铺 5 条以上同级选项。${retroHint}`;
  const userFacingOneLiner = sanitizeUserFacingLine(buildUserFacingOneLiner(env));
  const blockedDecisionHint = buildBlockedUserDecisionHint(env);
  const historicalBookShortcuts = getHistoricalBookShortcuts(env.effectiveBookRoot, 2);
  const rawPrimaryOptionsHint = buildPrimaryOptionsHintWithHistory(env, historicalBookShortcuts);
  const primaryOptionsHintRaw = contextEngine?.compressPrimaryOptions
    ? contextEngine.compressPrimaryOptions(rawPrimaryOptionsHint)
    : rawPrimaryOptionsHint;
  const primaryOptionsHint = primaryOptionsHintRaw.slice(0, 3);
  const wbHomeForCap = env.hostCap?.workbuddy?.homeDir || path.join(os.homedir(), '.workbuddy');
  const capabilityRefresh = getCapabilityRefreshRecommendation(env.fbsDir, wbHomeForCap);
  const deliveryAndPreview = buildDeliveryPreviewHints(env.effectiveBookRoot, env.hostCap?.workbuddyFeatures);
  const searchStrategyHints = buildSearchStrategyHints(env.hostCap);
  const memoryDirectoryNudge = buildMemoryMigrationNudge(env.hostCap?.markers);
  const teamOrchestrationHint = buildTeamOrchestrationNudge(env.hostCap);
  const spId = env.runtimeHooks?.scenePackId || 'general';
  const scenePackCoordinate = {
    scenePackId: spId,
    genreRuleRelative: `references/scene-packs/${spId}.md`,
    localRuleRelative: `references/scene-packs/${spId}-local-rule.md`,
    progressiveDisclosure:
      '首响不向用户朗读完整场景包正文；进入对应写作/质检阶段再 read_file 上述路径（见 references/01-core/information-ownership-and-arbitration.md）。',
  };
  const openingGuidance = {
    firstScreenQuestion: '这次想做什么？',
    maxPrimaryOptions: 3,
    primaryOptionsHint,
    deferFullMenuTo: '用户说「其他」或需要时再展开完整能力列表',
    batchConfirmHint:
      '需求信息收齐后优先「一次性汇总确认 + 用户说开始再分步执行」，避免连续多轮只让用户选「下一步选哪个」',
    /** 宿主侧：向用户只展示 userFacingOneLiner，不要把 intake JSON / SKILL 全文注入对话区 */
    hostInjectionContract: {
      showToUser: ['userFacingOneLiner', '最多3个主选项'],
      doNotShowToUser: [
        '完整 intake-router JSON',
        'SKILL 全文',
        'references 长文档',
        '元指令/自检口令（如「按 v* 规范」「JSON 输出」「不重复读文件」「干净首屏」等复述）',
      ],
    },
  };
  const maintenanceSecondaryOptionsHint = ['快速质检', '整理素材', '环境与缓存修复'];
  const capabilityBudget = buildCapabilityBudget(env);
  const pluginPhaseRoutingMatrix = buildPluginPhaseRoutingMatrix(env);
  const promptLayerCacheContract = hints?.promptLayerCache && typeof hints.promptLayerCache === 'object'
    ? {
        enabled: !!hints.promptLayerCache.enabled,
        layers: Array.isArray(hints.promptLayerCache.layers) ? hints.promptLayerCache.layers : [],
        invalidateWhen: Array.isArray(hints.promptLayerCache.invalidateWhen) ? hints.promptLayerCache.invalidateWhen : [],
      }
    : null;
  const actionSelectionPolicy = {
    primaryUserGoal: 'writing',
    primaryOptionsSource: 'openingGuidance.primaryOptionsHint',
    secondaryOptionsSource: 'maintenanceSecondaryOptionsHint',
    hideNonWritingFromPrimary: true,
  };
  const dangerousOperationPolicy = {
    strategy: 'dual-track',
    lowRisk: 'auto',
    highRisk: 'confirm',
    denyExamples: ['git reset --hard', 'rm -rf', 'del /f /s'],
    policyScript: 'scripts/command-approval-policy.mjs',
  };
  const clarifyContracts = buildClarifyContracts();
  const entryOutputProfiles = {
    interactive: 'stdout 仅展示 userFacingOneLiner + 最多3个主选项',
    machineJson: '通过 --json / --json-out 输出完整结构，供宿主消费',
  };
  const userVisibleTechActionNarration = buildUserVisibleTechActionNarration(hints);
  const versionObservability = buildVersionObservability(env);
  return {
    $schema: 'fbs-first-response-context-v1',
    hostType: cap?.hostType || null,
    routingMode: cap?.routingMode || null,
    fbsInitialized: !!env.hasFbs,
    hasProjectArtifacts: !!env.hasProjectArtifacts,
    pluginsEnabled: plugins.slice(0, 20),
    tier1MarketplaceSummary: cap?.tier1?.marketplaceSummary || null,
    binaryToolchain: cap?.binaryToolchain || null,
    workbuddyGenieVersion: cap?.workbuddyGenieVersion || null,
    recommendedOneLiner,
    userFacingOneLiner,
    blockedDecisionHint,
    versionObservability,
    openingGuidance,
    maintenanceSecondaryOptionsHint,
    capabilityBudget,
    pluginPhaseRoutingMatrix,
    promptLayerCacheContract,
    actionSelectionPolicy,
    dangerousOperationPolicy,
    clarifyContracts,
    entryOutputProfiles,
    userVisibleTechActionNarration,
    safeUserVisible: {
      oneLiner: userFacingOneLiner,
      blockedDecisionHint,
      primaryOptionsHint,
      maintenanceSecondaryOptionsHint,
      capabilityBudget,
      pluginPhaseRoutingMatrix,
      promptLayerCacheContract,
      actionSelectionPolicy,
      dangerousOperationPolicy,
      clarifyContracts,
      entryOutputProfiles,
      techActionNarration: userVisibleTechActionNarration,
      maxPrimaryOptions: capabilityBudget.maxPrimaryOptions,
    },
    retroGate: env.retroGate || null,
    gateSummary: env.gateSummary || null,
    historicalBookShortcuts,
    capabilityRefresh,
    deliveryAndPreview,
    searchStrategyHints,
    memoryDirectoryNudge,
    teamOrchestrationHint,
    scenePackCoordinate,
    healthUserHint: healthMatrix.userHint,
    channelSessionDefaults: pickChannelSessionDefaults(hints),
    subTaskDecompositionContract: buildSubTaskDecompositionContract(hints),
    executionSafetyBrief: Array.isArray(hints?.executionSafety?.userVisiblePrinciplesZh)
      ? hints.executionSafety.userVisiblePrinciplesZh
      : [],
    termValueGlossary: buildTermValueGlossary(),
    stallPreventionUserHint: buildStallPreventionUserHint(env),
    userValueSnapshot: buildUserValueSnapshot(hints, env),
    cognitiveAssetSnapshot: buildCognitiveAssetSnapshot(hints, env),
  };
}

function readGateStatusSnapshot(fbsDir, gateId) {
  const p = path.join(fbsDir, 'gates', `${gateId}.last.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function buildGateCallChecklist(env) {
  const items = [];
  const s0Gate = readGateStatusSnapshot(env.fbsDir, 's0-exit-gate');
  const expGate = readGateStatusSnapshot(env.fbsDir, 'expansion-gate');
  const polishGate = readGateStatusSnapshot(env.fbsDir, 'polish-gate');
  items.push({
    gateId: 's0-exit-gate',
    requiredWhen: 'S0 → S1 推进前',
    command: `node scripts/s0-exit-gate.mjs --book-root "${env.effectiveBookRoot}" --json --confirm-advance`,
    lastStatus: s0Gate?.code === 0 ? 'passed' : s0Gate ? 'blocked' : 'missing',
    lastRunAt: s0Gate?.updatedAt || null,
  });
  items.push({
    gateId: 'expansion-gate',
    requiredWhen: 'S3.5 扩写前/后校验',
    command: `node scripts/expansion-gate.mjs --book-root "${env.effectiveBookRoot}" --skill-root "${SKILL_ROOT}"`,
    lastStatus: expGate?.code === 0 ? 'passed' : expGate ? 'blocked' : 'missing',
    lastRunAt: expGate?.updatedAt || null,
  });
  items.push({
    gateId: 'polish-gate',
    requiredWhen: 'S3.7 精修前',
    command: `node scripts/polish-gate.mjs --book-root "${env.effectiveBookRoot}"`,
    lastStatus: polishGate?.code === 0 ? 'passed' : polishGate ? 'blocked' : 'missing',
    lastRunAt: polishGate?.updatedAt || null,
  });
  return items;
}

/** 不向 Agent warnings 堆栈原始 remote_error 技术细节（实测 P1-02） */
function sanitizeHookErrorMessage(message) {
  const s = String(message || '');
  if (/remote_error|场景包\/乐包钩子失败|__FBS_SCENE_PACK_TIMEOUT__|超时降级/.test(s)) {
    return '场景包在线链路未完全成功，已按本地规则与乐包埋点继续（细节见 JSON runtimeHooks）';
  }
  // WorkBuddy 实测：Windows / PowerShell 下缺少 Unix 命令（如 head）时向用户转述为人话（P1-3）
  if (/\bhead\b/i.test(s) && /(not found|not recognized|找不到|CommandNotFound|不是内部或外部命令)/i.test(s)) {
    return '当前终端环境与部分脚本期望不一致（例如缺少 Unix 风格命令），已跳过或改用内置方案；若反复出现，可在宿主设置中改用 Git Bash/WSL 或检查 PATH。';
  }
  if (/CommandNotFoundException|不是内部或外部命令/i.test(s) && s.length < 240) {
    return '检测到环境命令不可用，已尽力降级或跳过该步；若影响功能，请检查宿主终端与 PATH 配置。';
  }
  return s;
}

function buildProfileSuggestion(env, required = false) {
  if (!env.intakeProfile?.customGreeting) return null;
  return {
    step: 0,
    label: '按 WorkBuddy 画像开场',
    action: `优先使用这样的开场方式：${env.intakeProfile.customGreeting}`,
    reason: '检测到宿主画像，可减少重复背景收集',
    required,
  };
}

function buildHealthMatrix(env) {
  const checks = [];
  const push = (id, ok, detail, severityOnFail = 'warn', meta = null) => {
    checks.push({
      id,
      ok: !!ok,
      status: ok ? 'ok' : 'degraded',
      severity: ok ? 'info' : severityOnFail,
      detail,
      meta: meta || undefined,
    });
  };

  push(
    'host-capability',
    !env.hostCapabilityError,
    env.hostCapabilityError
      ? `宿主能力探测失败：${env.hostCapabilityError}`
      : `宿主能力探测可用（${env.hostCap?.hostType || 'unknown'}）`,
    'warn',
    { hostType: env.hostCap?.hostType || null, routingMode: env.hostCap?.routingMode || null },
  );

  const scenePackHookOk = !env.runtimeHooks?.errors?.length;
  push(
    'scene-pack-hook',
    scenePackHookOk,
    scenePackHookOk
      ? `场景包钩子正常（${env.runtimeHooks?.scenePackId || 'general'}）`
      : '场景包钩子存在降级，已回退本地规则',
    'warn',
    {
      scenePackId: env.runtimeHooks?.scenePackId || 'general',
      scenePackLoaded: !!env.runtimeHooks?.scenePackLoaded,
      timedOut: !!env.runtimeHooks?.scenePackTimedOut,
      skippedFast: !!env.runtimeHooks?.scenePackSkippedFast,
    },
  );

  const memoryArtifactsOk = !!env.hasResumeJson && !!env.hasMemoryBrief;
  push(
    'memory-artifacts',
    memoryArtifactsOk,
    memoryArtifactsOk ? '恢复卡与会话摘要就绪' : '恢复卡或会话摘要缺失（可由 session-exit/intake 补写）',
    'info',
    { hasResumeJson: !!env.hasResumeJson, hasMemoryBrief: !!env.hasMemoryBrief },
  );

  const fg = env.fileGrowthReport;
  if (!fg) {
    push('file-growth', true, '暂无体量报告或虚拟书房初建', 'info');
  } else if (fg.parseError) {
    push(
      'file-growth',
      false,
      `file-growth-report.json 不可解析：${fg.parseError}`,
      'warn',
    );
  } else if ((fg.alerts || []).length > 0) {
    push(
      'file-growth',
      false,
      `书稿追踪目录存在超大文件或总量过高（${(fg.alerts || []).join(', ')}），易拖慢检索与工具`,
      'warn',
      { alerts: fg.alerts },
    );
  } else if ((fg.advisoryAlerts || []).length > 0) {
    push(
      'file-growth',
      false,
      `接近体积软阈值（${(fg.advisoryAlerts || []).join(', ')}），建议适时归档或拆分`,
      'warn',
      { advisoryAlerts: fg.advisoryAlerts },
    );
  } else {
    push('file-growth', true, '书稿追踪体量在配置阈值内', 'info');
  }

  const okCount = checks.filter((x) => x.ok).length;
  const criticalFailed = checks.filter((x) => !x.ok && x.severity === 'critical').length;
  const warnFailed = checks.filter((x) => !x.ok && x.severity === 'warn').length;
  const degradedCount = checks.length - okCount;
  const overallSeverity = criticalFailed > 0 ? 'critical' : warnFailed > 0 ? 'warn' : 'healthy';
  const userHint =
    overallSeverity === 'critical'
      ? '当前运行环境存在关键异常，建议先修复后再继续主流程。'
      : overallSeverity === 'warn'
        ? '当前运行环境有可恢复降级，建议优先处理后再继续。'
        : degradedCount > 0
          ? '恢复信息尚未完整，系统会按降级策略继续。'
          : '运行状态正常，可直接继续。';
  return {
    summary: `${okCount}/${checks.length} checks healthy`,
    degradedCount,
    overallSeverity,
    userHint,
    checks,
    generatedAt: new Date().toISOString(),
  };
}

export function buildRecommendations(intent, env) {
  const eb = env.effectiveBookRoot;
  const actions = [];
  const warnings = [];
  const info = [];
  const blockers = [];
  const contextEngine = env._contextEngine;
  env.gateSummary = buildGateSummary(env);
  const gateChecklist = buildGateCallChecklist(env);
  const mustReport = gateChecklist.filter((x) => x.lastStatus !== 'passed').map((x) => `${x.gateId}:${x.lastStatus}`);
  if (mustReport.length > 0) {
    actions.push({
      step: actions.length + 1,
      label: '门禁执行清单回报',
      action: `先回报门禁状态（${mustReport.join('；')}），再继续主流程。`,
      reason: '避免“脚本存在但未触发”；每轮需可见化 gate 执行结果',
      required: false,
    });
  }
  if (env.projectAnchor?.status === 'ambiguous') {
    blockers.push({
      code: 'project_anchor_required',
      message: '检测到多个候选项目根目录，未确认前禁止继续读取 .fbs 台账。',
    });
    warnings.push(env.projectAnchor.prompt);
    const choices = (env.projectAnchor.candidates || []).slice(0, 5);
    actions.push({
      step: actions.length + 1,
      label: '确认当前项目锚点',
      action: choices
        .map((item, idx) => {
          const reason = item.reasons?.length ? `（${item.reasons.slice(0, 2).join('，')}）` : '';
          return `[${idx + 1}] ${item.bookRoot}${reason}`;
        })
        .join('；'),
      reason: '项目锚定完成前，不执行恢复卡、素材库、章节台账读取',
      required: true,
    });
    if (choices[0]?.bookRoot) {
      actions.push({
        step: actions.length + 1,
        label: '使用已确认项目重跑入口',
        cmd: `node scripts/intake-router.mjs --book-root "${choices[0].bookRoot}" --intent ${intent} --json --enforce-required`,
        reason: '将 bookRoot 锁定到单一项目后再继续',
        required: true,
      });
    }
  }

  if (env.runtimeHooks?.errors?.length) {
    env.runtimeHooks.errors.forEach((message) => warnings.push(sanitizeHookErrorMessage(message)));
  }
  if (env.runtimeHooks?.notes?.length) {
    env.runtimeHooks.notes.forEach((message) => info.push(message));
  }

  if (env.subDirBookRoot) {
    info.push(`在子目录 "${path.basename(env.subDirBookRoot)}" 中找到书房，已切换 bookRoot 为该目录`);
  }

  if (env.hostCapabilityError) {
    blockers.push({
      code: 'host_capability_failed',
      message: `宿主检测失败：${env.hostCapabilityError}`,
    });
    actions.push({
      step: 1,
      label: '重试宿主环境检测',
      cmd: `node scripts/host-capability-detect.mjs --book-root "${eb}" --json --force`,
      reason: '需先恢复 host-capability.json，才能进入标准入口路由',
      required: true,
    });
  } else if (env.hostCapabilityAutoRefreshed) {
    info.push('已自动执行宿主环境检测并刷新 host-capability.json');
  }

  if (env.resumeSnapshotRegenerated) {
    info.push('已自动补写 .fbs/workbuddy-resume.json');
  }
  if (env.memoryBriefRegenerated) {
    info.push('已自动补写 .fbs/smart-memory/session-resume-brief.md');
  }
  env.artifactErrors.forEach((message) => warnings.push(message));

  if (env.hostCap) {
    pushHostInfo(info, env.hostCap);
  }

  const wbHome = env.hostCap?.workbuddy?.homeDir || path.join(os.homedir(), '.workbuddy');
  const capRef = getCapabilityRefreshRecommendation(env.fbsDir, wbHome);
  if (capRef.recommended) {
    info.push(capRef.reason);
    actions.push({
      step: actions.length + 1,
      label: '刷新宿主能力快照（升级后建议）',
      cmd: `node scripts/host-capability-detect.mjs --book-root "${eb}" --json --force`,
      reason: '使已安装插件与市场技能与当前 WorkBuddy 探测结果一致',
      required: false,
    });
  }
  const versionObs = env.hostCap?.skillVersion || null;
  const dataCompatibility = env.hostCap?.dataCompatibility || null;
  let compatibilityModeActivated = false;
  let upgradePromptTriggered = false;

  if (versionObs?.mismatch) {
    warnings.push('检测到技能版本来源字段不一致（manifest/package/meta），建议先统一版本真值后再发布。');
  }

  if (versionObs?.recommendUpgrade) {
    upgradePromptTriggered = true;
    info.push(
      `当前运行版本 ${versionObs.runtime || 'unknown'}，目标版本 ${versionObs.target || 'unknown'}。建议升级以获得更稳入口、减少误触发并提升恢复效率。`,
    );
  }

  if (dataCompatibility?.status === 'needs_migration') {
    compatibilityModeActivated = true;
    warnings.push('检测到历史数据结构差异，已启用兼容模式：核心流程可继续，建议先刷新恢复数据。');
    actions.push({
      step: actions.length + 1,
      label: '执行数据兼容修复（覆盖升级后）',
      cmd: `node scripts/workbuddy-session-snapshot.mjs --fbs-dir "${env.fbsDir}" --quiet`,
      action: '刷新恢复卡字段到当前版本结构，降低后续恢复偏差。',
      reason: '覆盖升级只替换代码，历史数据需兼容修复。',
      required: false,
    });
  }

  if (env.profile?.isProfileComplete) {
    const displayName = env.profile.basicInfo.callName || env.profile.basicInfo.name;
    const currentProject = env.profile.workContext.currentProject || '当前项目';
    info.push(`已载入 WorkBuddy 用户画像：${displayName} / ${currentProject}`);
  }

  if (env.resumeCard?.updatedAt) {
    info.push(`已读取恢复卡快照：${env.resumeCard.updatedAt}`);
  }
  if (env.retroGate?.hasUnresolvedP0) {
    warnings.push(
      `检测到未修复 P0：${env.retroGate.unresolvedP0Count} 项（来源：${env.retroGate.sourceReport || '最近复盘报告'}）`,
    );
    actions.push({
      step: actions.length + 1,
      label: '复盘P0分流确认',
      cmd: `read_file "${path.join(env.fbsDir, 'retro-unresolved.md')}"`,
      action:
        '先向用户确认：A) 先修复 P0；B) 继续本轮写作（需明确接受风险并记录确认）；C) 先查看整改清单再决定。',
      reason: '避免复盘结论被忽略，降低重复故障概率',
      required: false,
    });
  }
  if (env.runtimeNudges?.totals?.all > 0) {
    info.push(`运行时提醒：${env.runtimeNudges.totals.all} 条（必做 ${env.runtimeNudges.totals.required || 0}）`);
    const firstRequired = (env.runtimeNudges.nudges || []).find((x) => x.required);
    if (firstRequired) {
      actions.push({
        step: actions.length + 1,
        label: '执行运行时必做提醒',
        action: firstRequired.text,
        cmd: firstRequired.actionCmd || null,
        reason: '阶段门禁提醒来自 runtime-nudge',
        required: false,
      });
    }
  }
  if (env.retroSkillCandidates?.candidates?.length > 0) {
    actions.push({
      step: actions.length + 1,
      label: '查看沉淀候选清单',
      cmd: `read_file "${path.join(env.fbsDir, 'retro-skill-candidates.json')}"`,
      reason: '本轮复盘已提取可复用候选，建议收尾前确认是否沉淀',
      required: false,
    });
  }
  if (env.p0AuditReport?.status === 'failed') {
    if (env.p0AuditReport?.stale) {
      warnings.push(
        `检测到过期 P0 审计缓存（${env.p0AuditReport.staleReason || 'stale'}），已降级为提醒，建议先刷新审计状态。`,
      );
      actions.push({
        step: actions.length + 1,
        label: '清理过期缓存（可选）',
        cmd: `node scripts/fbs-cleanup.mjs --book-root "${eb}" --target stale-caches --json`,
        reason: '先移除过期缓存，再重跑审计可避免误阻断。',
        required: false,
      });
      actions.push({
        step: actions.length + 1,
        label: '刷新 P0 审计状态',
        cmd: `node scripts/run-p0-audits.mjs --book-root "${eb}" --skill-root "${SKILL_ROOT}"`,
        reason: '避免使用过期缓存阻断当前会话。',
        required: false,
      });
    } else {
      warnings.push(
        `检测到最近一次 P0 审计失败（exitCode=${env.p0AuditReport.exitCode}），建议先修复门禁再继续主流程。`,
      );
    }
  } else if (env.p0AuditReport?.status === 'invalid') {
    warnings.push('最近一次 P0 审计报告不可解析，建议重跑 run-p0-audits 以恢复可观测性。');
  }
  if ((env.fileGrowthReport?.advisoryAlerts || []).length > 0 && !(env.fileGrowthReport?.alerts || []).length) {
    info.push(
      `体量提示（软阈值）：${env.fileGrowthReport.advisoryAlerts.join('；')} — 建议适时归档或拆分大文件，避免越写越卡。`,
    );
  }
  if ((env.fileGrowthReport?.alerts || []).length > 0) {
    const total = env.fileGrowthReport?.totals?.totalMb;
    warnings.push(`检测到文件增长风险告警（${env.fileGrowthReport.alerts.join(', ')}）${total ? `，当前追踪总量约 ${total}MB` : ''}`);
    actions.push({
      step: actions.length + 1,
      label: '执行文件增长治理',
      cmd: `node scripts/file-growth-guard.mjs --book-root "${eb}" --enforce --json`,
      reason: '先处理大文件/总量风险，避免后续卡顿与磁盘放大',
      required: env.fileGrowthReport.blocked === true,
    });
  }

  switch (intent) {
    case 'new-session': {
      if (!env.hasProjectArtifacts) {
        warnings.push('当前目录暂无可恢复书房记录，将进入 S0.5 轻量引导');
      }
      const profileAction = buildProfileSuggestion(env, !env.hasProjectArtifacts);
      if (profileAction) {
        profileAction.step = actions.length + 1;
        actions.push(profileAction);
      }
      actions.push({
        step: actions.length + 1,
        label: '新手引导（S0.5）',
        action: env.intakeProfile?.customGreeting
          ? `先说“${env.intakeProfile.customGreeting}”，再引导用户说明这次要继续旧项目还是开始新项目`
          : '向用户说“你想做什么？随便说说就行——写书、整理材料、还是先看看能做什么都可以”',
        reason: '先以自然语言确认目标，再进入虚拟书房初始化或续写',
        required: true,
      });
      if (env.intakeProfile?.customQuestions?.length > 0) {
        actions.push({
          step: actions.length + 1,
          label: '使用画像增强提问',
          action: `优先参考这些问题：${env.intakeProfile.customQuestions.slice(0, 3).join('；')}`,
          reason: '减少重复问答，优先沿着既有偏好继续',
          required: false,
        });
      }
      break;
    }

    case 'resume': {
      if (!env.hasResumeJson && env.hasChapterStatus) {
        blockers.push({
          code: 'missing_resume_snapshot',
          message: '缺少标准恢复卡 `.fbs/workbuddy-resume.json`，且自动补写未成功；续写前必须先生成恢复卡快照。',
        });
        actions.push({
          step: actions.length + 1,
          label: '生成恢复卡快照',
          cmd: `node scripts/workbuddy-session-snapshot.mjs --fbs-dir "${env.fbsDir}" --quiet`,
          reason: '缺少 `.fbs/workbuddy-resume.json`，需先生成标准恢复卡再进入续写',
          required: true,
        });
      }

      const resumeFile = env.hasResumeJson
        ? path.join(env.fbsDir, 'workbuddy-resume.json')
        : path.join(env.fbsDir, 'chapter-status.md');

      actions.push({
        step: actions.length + 1,
        label: '读取进度台账',
        cmd: `read_file "${resumeFile}"`,
        reason: '获取书名、当前章节、上次断点',
        required: true,
      });

      if (env.hasMemoryBrief) {
        actions.push({
          step: actions.length + 1,
          label: '读取记忆摘要',
          cmd: `read_file "${path.join(env.fbsDir, 'smart-memory', 'session-resume-brief.md')}"`,
          reason: '恢复风格、术语锁定等跨会话上下文',
          required: true,
        });
      } else {
        warnings.push('未找到 session-resume-brief.md，将按章节台账 + 恢复卡继续');
      }

      if (env.profile?.isProfileComplete) {
        actions.push({
          step: actions.length + 1,
          label: '应用 WorkBuddy 用户画像',
          action: `优先沿用默认模式：${env.intakeProfile?.defaultMode || '当前画像模式'}；默认协作：${env.intakeProfile?.defaultCollaboration || '当前画像协作方式'}`,
          reason: '恢复卡和宿主画像一起使用，减少重复确认',
          required: false,
        });
      }

      actions.push({
        step: actions.length + 1,
        label: '向用户输出恢复卡',
        action: '说明书名、当前章节、已完成字数、建议下一步，直接告知，不追问背景',
        required: true,
      });
      break;
    }

    case 'edit':
      warnings.push('编辑模式：每轮最多处理 2 个文件，处理前先向用户确认文件清单');
      actions.push({
        step: actions.length + 1,
        label: '快速扫描可改项',
        cmd: `powershell -ExecutionPolicy Bypass -File scripts/quick-scan.ps1 -BookRoot "${eb}"`,
        cmdAlt: `node scripts/quality-auditor-lite.mjs --book-root "${eb}" --standalone`,
        reason: '了解哪些章节有问题，优先改高风险项，避免盲目全量读取',
        required: false,
        tip: '若用户已明确指定文件，跳过此步直接操作',
      });
      actions.push({
        step: actions.length + 1,
        label: '向用户确认修改范围',
        action: '列出“本次建议修改的文件（最多 2 个）”，等用户确认后再 read_file',
        required: true,
      });
      actions.push({
        step: actions.length + 1,
        label: '串行修改（1 文件完成后再处理下一个）',
        action: '修改前说明“我接下来修改 [文件名]，改 [N 处]，大概需要 [X 秒]”',
        required: true,
      });
      actions.push({
        step: actions.length + 1,
        label: 'S3 记忆检测点',
        action: '完成修改后调用 update_memory，写入：书名、章节、字数、风格要点、术语锁定列表',
        required: true,
      });
      break;

    case 'rewrite':
      warnings.push('拆书式改写模式：先确认来源边界与改写目标，再进入章节级改写与质检。');
      actions.push({
        step: actions.length + 1,
        label: '确认改写模式与来源边界',
        action:
          '请用户先明确三选一：①自有旧书升级 ②海外内容本地化 ③爆款结构重构；同时确认来源范围与可改写边界（避免直接复写）。',
        reason: '先锁定边界可减少返工与合规风险',
        required: true,
      });
      actions.push({
        step: actions.length + 1,
        label: '生成最小改写计划',
        cmd: `node scripts/rewrite-plan-bootstrap.mjs --book-root "${eb}" --json`,
        action:
          '先生成 .fbs/rewrite-plan.md，再补充保留项/替换项/新增项各 3-5 条后开始正文改写；每轮最多改 2 个文件。',
        reason: '将“拆书式改写”纳入现有 S3 串行约束，降低漂移与卡顿',
        required: true,
      });
      actions.push({
        step: actions.length + 1,
        label: '改写后执行轻量质检',
        cmd: `node scripts/quality-auditor-lite.mjs --book-root "${eb}" --standalone`,
        reason: '确保改写结果在质量链内可见、可复核',
        required: true,
      });
      break;

    case 'qc':
      actions.push({
        step: actions.length + 1,
        label: '确认质检范围',
        action: '先让用户在三种范围中二选一：A) 终稿（合并稿）；B) 单章（deliverables）；C) 全量（终稿+单章）。',
        reason: '避免“终稿分数”和“单章均分”混淆，先对齐质检对象再执行',
        required: true,
      });
      actions.push({
        step: actions.length + 1,
        label: '质检终稿（合并稿）',
        cmd: `node scripts/polish-gate.mjs --book-root "${eb}" --target final-manuscript --no-source-backup --json-out "${path.join(env.fbsDir, 'polish-final-last.json')}"`,
        reason: '对最新终稿给出单文件分数与问题列表，避免被单章均分掩盖',
        required: false,
      });
      actions.push({
        step: actions.length + 1,
        label: '质检单章（deliverables）',
        cmd: `node scripts/polish-gate.mjs --book-root "${eb}" --target deliverables --no-source-backup --json-out "${path.join(env.fbsDir, 'polish-deliverables-last.json')}"`,
        reason: '查看章节级分布，定位具体未达标章节',
        required: false,
      });
      actions.push({
        step: actions.length + 1,
        label: '全量质检（终稿+单章）',
        action: '统一产出“全局结论层”，自动汇总终稿与单章结果并给出下一步建议。',
        cmd: `node scripts/fbs-quality-full.mjs --book-root "${eb}" --json-out "${path.join(env.fbsDir, 'quality-full-last.json')}"`,
        reason: '避免终稿分与单章均分混淆，直接给可执行结论',
        required: false,
      });
      actions.push({
        step: actions.length + 1,
        label: '一键链路（质检→精修→导出）',
        cmd: `node scripts/delivery-chain.mjs --book-root "${eb}" --skill-root "${env.skillRoot}"`,
        action: '若希望自动串行执行，先告知用户将按“质量门禁→精修门禁（可选）→章节合并导出”顺序执行。',
        reason: '把高价值链路模板化，减少手工切换脚本导致的断链',
        required: false,
        tip: '需要自动精修时追加 --run-refine',
      });
      break;

    case 'init':
      actions.push({
        step: actions.length + 1,
        label: '初始化虚拟书房底座',
        cmd: `node scripts/init-fbs-multiagent-artifacts.mjs --book-root "${eb}"`,
        reason: '创建 .fbs/ deliverables/ releases/ 三层目录及基础工件',
        required: true,
      });
      break;

    case 'inspect':
      actions.push({
        step: actions.length + 1,
        label: '查看项目概况',
        cmd: `node scripts/workspace-inspector.mjs --book-root "${eb}"`,
        required: false,
        cmdAlt: `node scripts/verify-chapter-status-truth.mjs --book-root "${eb}"`,
      });
      if (env.hasChapterStatus) {
        actions.push({
          step: actions.length + 1,
          label: '读取章节台账',
          cmd: `read_file "${path.join(env.fbsDir, 'chapter-status.md')}"`,
          required: true,
        });
      }
      break;

    case 'exit':
      if (!env.hasProjectArtifacts) {
        warnings.push('当前未检测到完整书稿台账；退出时将写入最小恢复信息，便于下次继续。');
      }
      actions.push({
        step: actions.length + 1,
        label: '安全退出并写入恢复摘要',
        cmd: `node scripts/session-exit.mjs --book-root "${eb}" --json`,
        reason: '默认先保存恢复卡与会话摘要，再安全退出当前会话',
        required: true,
      });
      actions.push({
        step: actions.length + 1,
        label: '向用户确认已记录',
        action: '回复“已记录当前状态。下次输入『福帮手』可从上次位置继续。”；若用户明确要求不保存，再只确认退出。',
        required: true,
      });
      break;
  }

  const actionItems = enrichActionsWithGoalImpact(actions, intent);
  const mustRunBeforeContinue = actionItems
    .filter((action) => action.required)
    .map(({ step, label, cmd, action, goalImpact }) => ({
      step,
      label,
      cmd: cmd || null,
      action: action || null,
      goalImpact,
    }));

  const skillRuntimeHints = loadSkillRuntimeHints();
  env.skillRuntimeHints = skillRuntimeHints;
  const t1 = env.hostCap?.tier1;

  const compactInfo = contextEngine?.compressInfo ? contextEngine.compressInfo(info) : info;
  const compactWarnings = contextEngine?.compressWarnings ? contextEngine.compressWarnings(warnings) : warnings;
  const healthMatrix = buildHealthMatrix(env);
  env.healthMatrix = healthMatrix;
  const hostKpiSignals = {
    resumeOneShotReady: !!env.hasResumeJson && !!env.hasMemoryBrief ? 1 : 0,
    firstRouteEffective: blockers.length === 0 ? 1 : 0,
    compatibilityModeActivated: compatibilityModeActivated ? 1 : 0,
    upgradePromptTriggered: upgradePromptTriggered ? 1 : 0,
    presentationBridgeReady: env.hostCap?.workbuddyFeatures?.presentationBridgeSupported ? 1 : 0,
    routingMode: env.hostCap?.routingMode || null,
  };
  const entryState = resolveEntryState(env, intent);
  const nextState = resolveNextState(entryState, intent, blockers.length === 0);

  return {
    intent,
    intakeRouterRunAt: new Date().toISOString(),
    compliance: {
      intakeRouterExecuted: true,
      architectureNote:
        'Skill 仅注入文档上下文时，不会自动执行本脚本；须由主 Agent 显式运行 node scripts/intake-router.mjs（audit P0-01）。宿主宜在注入技能后的首轮校验本字段或 JSON 顶层 intent 已产出，未执行则不得宣称「已进入福帮手工作流」。',
      exitReminder:
        '用户说退出/停止/退出福帮手时，须先运行 node scripts/session-exit.mjs --book-root <bookRoot> --json 并复述完整 userMessage（含第二行摘要）（audit P0-02 / P1-04）',
      bookRootResolved: eb,
      effectiveBookRoot: env.effectiveBookRoot,
      intakeFast: !!env.intakeFast,
      scenePackId: env.runtimeHooks?.scenePackId || null,
      fbsInitialized: !!env.hasFbs,
      scenePackLoaded: !!env.runtimeHooks?.scenePackLoaded,
      projectAnchorStatus: env.projectAnchor?.status || 'locked',
    },
    runtimeHooks: env.runtimeHooks || null,
    env: {
      bookRoot: eb,
      hasFbs: env.hasFbs,
      hadFbsBeforeInit: env.hadFbsBeforeInit,
      hasProjectArtifacts: env.hasProjectArtifacts,
      subDirFound: !!env.subDirBookRoot,
      hostType: env.hostCap?.hostType || null,
      routingMode: env.hostCap?.routingMode || null,
    },
    runtime: {
      memoryProvider: env.memoryProvider || null,
      contextEngine: env.contextEngine || null,
      healthMatrix,
      hostKpiSignals,
    },
    readyToProceed: blockers.length === 0,
    entryStateMachine: {
      version: 'v1.1',
      current: entryState,
      next: nextState,
      transitions: [`${entryState}->${nextState}`],
    },
    blockers,
    mustRunBeforeContinue,
    resumeCard: env.resumeCard || null,
    actions: actionItems,
    warnings: compactWarnings,
    info: compactInfo,
    skillRuntimeHints,
    tier1Marketplace: t1
      ? {
          summary: t1.marketplaceSummary,
          availableCount: t1.relevantSkills?.available?.length ?? 0,
          totalCount: t1.relevantSkills?.checked?.length ?? 0,
          note: t1.marketplaceSummaryNote,
        }
      : null,
    searchPreflightContractRelative: 'references/05-ops/search-preflight-contract.json',
    scriptBridgeDoc: 'references/01-core/skill-cli-bridge-matrix.md',
    scriptBridgeCli: 'scripts/fbs-cli-bridge.mjs',
    firstResponseContext: buildFirstResponseContext(env),
    hostKpiSignals,
    gateCallChecklist: buildGateCallChecklist(env),
    projectAnchor: env.projectAnchor || null,
    gateSummary: env.gateSummary || null,
    performance: {
      intakeFast: !!env.intakeFast,
      scenePackSkippedFast: !!env.runtimeHooks?.scenePackSkippedFast,
      scenePackTimedOut: !!env.runtimeHooks?.scenePackTimedOut,
      scenePackTimeoutMs: env.intakeFast ? null : SCENE_PACK_TIMEOUT_MS,
      hostMemoryFilesCap: 24,
      hint: env.intakeFast
        ? '默认快速开场：已跳过场景包全量联网加载；需要完整在线场景包时请对 intake-router 显式加 --full。'
        : '已使用 --full：将尝试完整加载场景包（可能较慢）；一般开场请去掉 --full 以启用默认快速模式。',
    },
    retroGate: env.retroGate || null,
    retroSkillCandidates: env.retroSkillCandidates || null,
    runtimeNudges: env.runtimeNudges || null,
    p0AuditReport: env.p0AuditReport || null,
    fileGrowthReport: env.fileGrowthReport || null,
    strategies: {
      A_truthAndContracts: 'references/01-core/memory-layer-matrix.md',
      B_hostAugmentation: 'references/05-ops/teams-inbox-mapping.md',
      C_evolution: 'references/05-ops/lexicon-governance.md',
    },
  };
}

export function formatOutput(result, useJson, jsonOutPath = null, verboseOutput = false) {
  if (useJson) {
    const payload = JSON.stringify(result, null, 2);
    if (jsonOutPath) {
      try {
        fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });
        fs.writeFileSync(jsonOutPath, payload + '\n', 'utf8');
        // Windows / PowerShell 5.x：stdout 可能被 CLIXML 污染；JSON 主结果落盘，stdout 仅一行指针
        console.log(`[intake-router] JSON written to: ${jsonOutPath}`);
      } catch (e) {
        console.error(`[intake-router] --json-out 写入失败: ${e instanceof Error ? e.message : e}`);
        console.log(payload);
      }
    } else {
      console.log(payload);
    }
    return;
  }

  const uOne = result.firstResponseContext?.userFacingOneLiner || '福帮手已就绪。这次想做什么？';
  const blockedHint = result.firstResponseContext?.blockedDecisionHint || null;
  const opts = result.firstResponseContext?.openingGuidance?.primaryOptionsHint || [];

  console.log(uOne);
  if (blockedHint) console.log(blockedHint);
  opts.slice(0, 3).forEach((o, idx) => console.log(`${idx + 1}. ${o}`));

  if (!verboseOutput) return;

  const C = {
    cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', reset: '\x1b[0m',
  };
  console.log(`\n${C.bold}${C.cyan}—— 调试扩展输出（--verbose-output）——${C.reset}`);
  console.log(`${C.bold}入口状态：${C.reset}${result.readyToProceed ? `${C.green}ready${C.reset}` : `${C.yellow}blocked${C.reset}`}`);
  if (result.warnings?.length) result.warnings.forEach((w) => console.log(`${C.yellow}⚠ ${w}${C.reset}`));
  if (result.blockers?.length) result.blockers.forEach((b) => console.log(`${C.red}✖ [${b.code}] ${b.message}${C.reset}`));
}

export async function runIntakeRouter({ bookRoot = process.cwd(), intent = 'auto', fast = true } = {}) {
  const env = await detectEnv(path.resolve(bookRoot), { fast });
  const resolvedIntent = resolveIntent(intent, env);
  env._resolvedIntent = resolvedIntent;
  return buildRecommendations(resolvedIntent, env);
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAtMs = Date.now();

  if (args.help) {
    console.log(`
intake-router.mjs — FBS 主调度入口路由器 v2.1.2（WorkBuddy / CodeBuddy 双通道）

用法：
  node scripts/intake-router.mjs --book-root <bookRoot> --intent <intent> [--json] [--enforce-required] [--fast] [--full] [--verbose-output]
           [--search <关键词>]

  默认启用快速开场（等同 --fast）：跳过场景包全量联网加载，仅乐包 registerBook，首响更快。
  --full   显式请求完整场景包加载（可能较慢，网络差时慎用）
  --fast   与默认相同，可省略（保留兼容旧脚本）
  --search 在 ~/.workbuddy/fbs-book-projects.json 索引中按书名/路径关键词检索历史书稿目录（需曾成功执行过 session-exit）
  --with-env-preflight  额外写入 .fbs/env-preflight.json（可与任意 intent 同用；inspect 时默认也会刷新）
  --json-out <path>     与 --json 同用：将完整 JSON 写入指定文件（推荐 Windows PowerShell 宿主，避免 stdout 被 CLIXML 劫持）
  --verbose-output      非 JSON 模式下输出调试扩展信息；默认仅输出用户可见一句 + 最多 3 个选项

intent 可选值：
  auto        自动检测（默认）
  new-session 新会话开场
  edit        修改/扩充/升级书稿
  rewrite     拆书式改写（自有升级 / 海外本地化 / 爆款结构重构）
  qc          质量自检/去AI味
  resume      续写/继续上次
  init        初始化书房
  inspect     查看项目状态
  exit        安全退出并写入恢复摘要
`);
    process.exit(0);
  }

  const bookRoot = args.bookRoot ? path.resolve(args.bookRoot) : process.cwd();
  const intentArg = args.intent || 'auto';
  const jsonMode = args.json || false;
  const intakeFast = args.full ? false : true;

  const result = await runIntakeRouter({ bookRoot, intent: intentArg, fast: intakeFast });
  const elapsedMs = Date.now() - startedAtMs;
  result.runtime = result.runtime || {};
  result.runtime.performance = {
    ...(result.runtime.performance || {}),
    intakeElapsedMs: elapsedMs,
    ttfwSeconds: Number((elapsedMs / 1000).toFixed(2)),
  };
  if (intentArg === 'inspect' || args.withEnvPreflight) {
    writeEnvPreflightArtifact(bookRoot);
  }
  if (args.search && String(args.search).trim()) {
    const { searchUnifiedBookRoots } = await import('./lib/fbs-book-snippet-index.mjs');
    const kw = String(args.search).trim();
    const matches = searchUnifiedBookRoots(kw);
    result.bookProjectSearch = {
      keyword: kw,
      matches,
      hint: matches.length
        ? '以下为登记 + 本书关键词索引命中的书稿目录，可请用户确认后作为 --book-root 使用'
        : '索引中暂无匹配；用户完成一次正常退出后会自动登记书稿路径',
    };
    if (matches.length) {
      result.info.push(`书名/路径索引命中 ${matches.length} 条（详见 bookProjectSearch.matches）`);
    }
  }
  formatOutput(result, jsonMode, args.jsonOut || null, !!args.verboseOutput);

  appendIntakeRoutingKpiLog(result.env?.bookRoot || bookRoot, {
    ts: new Date().toISOString(),
    intent: result.intent,
    readyToProceed: !!result.readyToProceed,
    firstRouteEffective: Number(result.hostKpiSignals?.firstRouteEffective || 0),
    presentationBridgeReady: Number(result.hostKpiSignals?.presentationBridgeReady || 0),
    ttfwSeconds: Number(result.runtime?.performance?.ttfwSeconds || 0),
    primaryOptionsCount: Array.isArray(result.firstResponseContext?.openingGuidance?.primaryOptionsHint)
      ? result.firstResponseContext.openingGuidance.primaryOptionsHint.length
      : 0,
  });

  try {
    upsertBookSnippetIndex(result.env?.bookRoot || bookRoot);
  } catch {
    /* ignore */
  }

  appendTraceEvent({
    bookRoot,
    skillRoot: SKILL_ROOT,
    script: 'intake-router.mjs',
    event: 'intake_router',
    exitCode: args.enforceRequired && !result.readyToProceed ? 1 : 0,
    payloadSummary: {
      intent: result.intent,
      readyToProceed: result.readyToProceed,
      intakeFast,
      searchKeyword: args.search || null,
    },
  });

  if (args.enforceRequired && !result.readyToProceed) {
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('intake-router.mjs')) {
  main().catch((error) => {
    console.error(`intake-router 失败: ${error.message}`);
    process.exit(1);
  });
}
