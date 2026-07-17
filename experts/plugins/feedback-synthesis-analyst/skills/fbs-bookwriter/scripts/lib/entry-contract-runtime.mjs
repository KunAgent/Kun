import fs from 'fs';
import path from 'path';

const DEFAULT_POLICY_RELATIVE_PATH = ['references', '05-ops', 'search-policy.json'];
const DEFAULT_FIRST_USABLE_SURFACE = {
  id: 'WP2',
  label: '书稿工作面',
  authorityDirs: ['.fbs', 'deliverables', 'releases'],
  stateFiles: ['.fbs/esm-state.md', '.fbs/规范执行状态.md', '.fbs/chapter-status.md'],
};

export function normalizeStage(value) {
  return String(value || '').trim().toUpperCase().replace(/_/g, '.');
}

export function resolvePolicyPath(skillRoot = process.cwd()) {
  return path.join(path.resolve(skillRoot), ...DEFAULT_POLICY_RELATIVE_PATH);
}

export function loadEntryContractPolicy(skillRoot = process.cwd()) {
  const policyPath = resolvePolicyPath(skillRoot);
  if (!fs.existsSync(policyPath)) {
    throw new Error(`missing_search_policy:${policyPath}`);
  }
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

export function resolveEntryContractBundle(policy = {}) {
  return {
    entryWorkplanes: policy?.entryWorkplanes || {},
    searchPreflightContract: policy?.searchPreflightContract || {},
    workspaceGovernance: policy?.workspaceGovernance || {},
  };
}

export function resolveFirstUsableSurface(policy = {}) {
  const { entryWorkplanes, workspaceGovernance } = resolveEntryContractBundle(policy);
  const wp2 = entryWorkplanes?.wp2 || {};
  const workspace = workspaceGovernance?.firstUsableWorkspace || {};

  return {
    id: wp2.id || workspace.id || DEFAULT_FIRST_USABLE_SURFACE.id,
    label: wp2.name || DEFAULT_FIRST_USABLE_SURFACE.label,
    authorityDirs: wp2.firstUsableWorkspaceDirs || workspace.requiredDirs || DEFAULT_FIRST_USABLE_SURFACE.authorityDirs,
    stateFiles: wp2.stateFiles || workspaceGovernance.projectTruthStateFiles || DEFAULT_FIRST_USABLE_SURFACE.stateFiles,
  };
}

function fillTemplate(template, data) {
  return String(template || '')
    .replaceAll('{whyNow}', data.whyNow)
    .replaceAll('{searchScope}', data.searchScope)
    .replaceAll('{nextStepAfterSearch}', data.nextStepAfterSearch)
    .replaceAll('{offlineFallback}', data.offlineFallback);
}

export function buildSearchPreflightMessage(fields, policy = {}) {
  const { searchPreflightContract } = resolveEntryContractBundle(policy);
  const template = searchPreflightContract?.defaultUserFacingTemplate || '我先查{searchScope}，确认{whyNow}；查完后直接进入{nextStepAfterSearch}。如果当前无法联网，我会明确说明并按离线降级处理。';
  return fillTemplate(template, {
    whyNow: String(fields?.whyNow || '').trim(),
    searchScope: String(fields?.searchScope || '').trim(),
    nextStepAfterSearch: String(fields?.nextStepAfterSearch || '').trim(),
    offlineFallback: String(fields?.offlineFallback || '').trim(),
  });
}

export function validateSearchPreflightFields(fields, policy = {}) {
  const { searchPreflightContract } = resolveEntryContractBundle(policy);
  const requiredFields = Array.isArray(searchPreflightContract?.requiredFields) && searchPreflightContract.requiredFields.length > 0
    ? searchPreflightContract.requiredFields
    : ['whyNow', 'searchScope', 'nextStepAfterSearch', 'offlineFallback'];

  const normalized = {
    whyNow: String(fields?.whyNow || '').trim(),
    searchScope: String(fields?.searchScope || '').trim(),
    nextStepAfterSearch: String(fields?.nextStepAfterSearch || '').trim(),
    offlineFallback: String(fields?.offlineFallback || '').trim(),
  };

  const missingFields = requiredFields.filter((key) => !normalized[key]);
  return {
    ok: missingFields.length === 0,
    missingFields,
    normalized,
  };
}

export function createSearchPreflightEntry(fields, policy = {}) {
  const validation = validateSearchPreflightFields(fields, policy);
  if (!validation.ok) {
    const error = new Error(`missing_preflight_fields:${validation.missingFields.join(',')}`);
    error.code = 'MISSING_PREFLIGHT_FIELDS';
    error.missingFields = validation.missingFields;
    throw error;
  }

  return {
    kind: 'search_preflight',
    ok: true,
    timestamp: fields?.timestamp || new Date().toISOString(),
    stage: normalizeStage(fields?.stage),
    chapterId: String(fields?.chapterId || 'global'),
    whyNow: validation.normalized.whyNow,
    searchScope: validation.normalized.searchScope,
    nextStepAfterSearch: validation.normalized.nextStepAfterSearch,
    offlineFallback: validation.normalized.offlineFallback,
    message: String(fields?.message || '').trim() || buildSearchPreflightMessage(validation.normalized, policy),
    source: String(fields?.source || 'runtime').trim(),
  };
}

export function appendLedgerEntry(bookRoot, entry) {
  const ledgerPath = path.join(path.resolve(bookRoot), '.fbs', 'search-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return ledgerPath;
}

function writeJsonSnapshot(filePath, payload, force = false) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !force) {
    const current = fs.readFileSync(filePath, 'utf8').trim();
    if (current.length > 0) {
      return { written: false, filePath, payload };
    }
  }
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { written: true, filePath, payload };
}

export function ensureWorkspaceGovernanceSnapshot(bookRoot, policy = {}, options = {}) {
  const { workspaceGovernance } = resolveEntryContractBundle(policy);
  const payload = {
    generatedAt: options.generatedAt || new Date().toISOString(),
    projectTruthDirs: workspaceGovernance?.projectTruthDirs || DEFAULT_FIRST_USABLE_SURFACE.authorityDirs,
    projectTruthStateFiles: workspaceGovernance?.projectTruthStateFiles || DEFAULT_FIRST_USABLE_SURFACE.stateFiles,
    artifactBoundary: workspaceGovernance?.artifactBoundary || 'brain/<conversation-id>/ 仅用于过程性 artifact，不得充当项目真值',
    readOnlyContextSources: workspaceGovernance?.readOnlyContextSources || [],
    userVisiblePreference: workspaceGovernance?.userVisiblePreference || [],
    firstUsableWorkspace: {
      ...(workspaceGovernance?.firstUsableWorkspace || {}),
      ...(resolveFirstUsableSurface(policy)),
      mustExplainToUser: workspaceGovernance?.firstUsableWorkspace?.mustExplainToUser || '',
    },
  };

  return writeJsonSnapshot(
    path.join(path.resolve(bookRoot), '.fbs', 'workspace-governance.json'),
    payload,
    options.force === true,
  );
}

export function ensureEntryContractSnapshot(bookRoot, policy = {}, options = {}) {
  const { entryWorkplanes, searchPreflightContract } = resolveEntryContractBundle(policy);
  const payload = {
    generatedAt: options.generatedAt || new Date().toISOString(),
    wp1: entryWorkplanes?.wp1 || null,
    wp2: {
      ...(entryWorkplanes?.wp2 || {}),
      ...(resolveFirstUsableSurface(policy)),
    },
    searchPreflightContract: {
      enabled: searchPreflightContract?.enabled === true,
      requiredFields: searchPreflightContract?.requiredFields || [],
      mustAnnounceBeforeStages: searchPreflightContract?.mustAnnounceBeforeStages || [],
      mustAnnounceBeforeChapterSearch: searchPreflightContract?.mustAnnounceBeforeChapterSearch === true,
      blockedIfMissingAnnouncement: searchPreflightContract?.blockedIfMissingAnnouncement === true,
      defaultUserFacingTemplate: searchPreflightContract?.defaultUserFacingTemplate || '',
    },
  };

  return writeJsonSnapshot(
    path.join(path.resolve(bookRoot), '.fbs', 'entry-contract.json'),
    payload,
    options.force === true,
  );
}

export function isSearchPreflightEntry(entry, policy = {}) {
  if (entry?.kind !== 'search_preflight' || entry?.ok === false) {
    return false;
  }
  return validateSearchPreflightFields(entry, policy).ok;
}

export function findStagePreflightEntries(entries, stage, policy = {}, options = {}) {
  const normalizedStage = normalizeStage(stage);
  const chapterId = options.chapterId ? String(options.chapterId).toLowerCase() : null;
  return (entries || []).filter((entry) => {
    if (!isSearchPreflightEntry(entry, policy)) return false;
    if (normalizeStage(entry.stage) !== normalizedStage) return false;
    if (!chapterId) return true;
    const entryChapterId = String(entry.chapterId || 'global').toLowerCase();
    return entryChapterId === chapterId || entryChapterId === 'global';
  });
}

/**
 * WP1 边界守卫：检测文本/指令中是否出现 WP1 阶段禁止提前暴露的内部术语。
 * 被调用方（如 init 脚本、s3-start-gate）可用此函数在 WP1 内做拦截。
 *
 * @param {string} text - 要检测的文本（可以是用户输入、文件内容片段等）
 * @param {object} [policy] - search-policy.json 内容（可选，用于读取自定义禁止词）
 * @returns {{ ok: boolean, violations: string[] }} ok=true 表示无违规
 */
export function checkWP1BoundaryTerms(text, policy = {}) {
  const DEFAULT_FORBIDDEN_TERMS = [
    'WP2', 'S3', 'S4', 'S5', 'S6',
    '目录结构', '章节大纲', '质检', '发布',
    '结构锁定', 'release', 'deliverables',
  ];
  const policyForbidden = Array.isArray(policy?.entryWorkplanes?.wp1?.forbiddenTerms)
    ? policy.entryWorkplanes.wp1.forbiddenTerms
    : [];
  const allForbidden = [...new Set([...DEFAULT_FORBIDDEN_TERMS, ...policyForbidden])];
  const content = String(text || '');
  const violations = allForbidden.filter((term) => content.includes(term));
  return { ok: violations.length === 0, violations };
}

/**
 * WP1 切换守卫：验证从 WP1 切换到 WP2 的前置条件是否满足。
 * 前置条件：search-ledger 中必须存在完整的搜索前置合同宣告（kind=search_preflight）。
 *
 * @param {string} bookRoot - 书稿根目录
 * @param {object} [policy] - search-policy.json 内容（可选）
 * @returns {{ ok: boolean, reason?: string }} ok=true 表示可切换
 */
export function checkWP1ToWP2Transition(bookRoot, policy = {}) {
  const ledgerPath = path.join(path.resolve(bookRoot), '.fbs', 'search-ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) {
    return { ok: false, reason: 'search-ledger 不存在，WP1→WP2 切换被阻断；需先完成 S0 搜索前置合同宣告' };
  }

  const requiredFields = Array.isArray(policy?.searchPreflightContract?.requiredFields)
    ? policy.searchPreflightContract.requiredFields
    : ['whyNow', 'searchScope', 'nextStepAfterSearch', 'offlineFallback'];

  const body = fs.readFileSync(ledgerPath, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e.kind !== 'search_preflight' || e.ok === false) continue;
      const missing = requiredFields.filter((f) => !String(e[f] || '').trim());
      if (missing.length === 0) return { ok: true };
    } catch {
      // skip
    }
  }
  return {
    ok: false,
    reason: `WP1→WP2 切换被阻断：search-ledger 中缺少完整的搜索前置合同宣告（需包含 ${requiredFields.join('/')}）`,
  };
}
