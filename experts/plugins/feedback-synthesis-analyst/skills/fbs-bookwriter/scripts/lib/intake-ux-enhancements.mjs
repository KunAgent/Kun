/**
 * intake 首响 UX 增强：历史书登记、能力刷新、交付预览、检索策略提示（对用户转述须去内部代号）
 */
import fs from 'fs';
import path from 'path';
import { listRegistryEntries } from './fbs-book-projects-registry.mjs';

function normRoot(p) {
  try {
    return path.resolve(String(p || '').trim());
  } catch {
    return '';
  }
}

/**
 * 从 ~/.workbuddy/fbs-book-projects.json 取与当前书稿不同的最近登记项（最多 2 条）
 */
export function getHistoricalBookShortcuts(effectiveBookRoot, max = 2) {
  const cur = normRoot(effectiveBookRoot);
  const entries = listRegistryEntries();
  const sorted = [...entries]
    .filter((e) => e?.bookRoot && normRoot(e.bookRoot) !== cur)
    .sort((a, b) => {
      const ta = new Date(a.lastExitAt || a.registeredAt || 0).getTime();
      const tb = new Date(b.lastExitAt || b.registeredAt || 0).getTime();
      return tb - ta;
    })
    .slice(0, Math.max(0, max));

  return sorted.map((e) => {
    const title = (e.bookTitle && String(e.bookTitle).trim()) || path.basename(e.bookRoot);
    return {
      bookRoot: normRoot(e.bookRoot),
      displayTitle: title,
      currentStage: e.currentStage || null,
      lastExitAt: e.lastExitAt || null,
      /** 供 Agent 转述：打开该书稿时应使用的 book-root */
      intakeHint: `将工作区切换到该书稿目录后执行 intake-router（book-root 为该目录绝对路径）`,
    };
  });
}

/**
 * 技能市场版本戳晚于 host-capability 探测时间时，建议刷新（WorkBuddy 升级后）
 */
export function getCapabilityRefreshRecommendation(fbsDir, workbuddyHome) {
  const capPath = path.join(fbsDir, 'host-capability.json');
  let detectedMs = 0;
  if (fs.existsSync(capPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(capPath, 'utf8'));
      detectedMs = new Date(c.detectedAt || 0).getTime();
    } catch {
      detectedMs = 0;
    }
  }
  const home = workbuddyHome && String(workbuddyHome).trim();
  if (!home) return { recommended: false, reason: null, suggestedCmd: null };
  const verPath = path.join(home, '.skills-marketplace-version');
  if (!fs.existsSync(verPath)) return { recommended: false, reason: null, suggestedCmd: null };
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(verPath).mtimeMs;
  } catch {
    return { recommended: false, reason: null, suggestedCmd: null };
  }
  if (mtimeMs > detectedMs + 60_000) {
    return {
      recommended: true,
      reason:
        '检测到技能市场版本信息晚于当前宿主能力快照；WorkBuddy 升级后建议刷新能力探测，以匹配插件与市场技能。',
      suggestedCmd: 'node scripts/host-capability-detect.mjs --book-root "<书稿根>" --json --force',
    };
  }
  return { recommended: false, reason: null, suggestedCmd: null };
}

export function buildDeliveryPreviewHints(effectiveBookRoot, workbuddyFeatures) {
  const root = normRoot(effectiveBookRoot);
  const deliverablesDir = path.join(root, 'deliverables');
  const relDeliverables = 'deliverables';
  const base = {
    deliverablesDir,
    deliverablesRelative: relDeliverables,
    presentationBridgeSupported: !!workbuddyFeatures?.presentationBridgeSupported,
  };
  if (!workbuddyFeatures?.presentationBridgeSupported) {
    return {
      ...base,
      userFacingActions: [
        `合并稿与交付物请放在书稿根下的「${relDeliverables}」文件夹，便于统一查找。`,
      ],
      agentNote: '可向用户说明交付物目录位置；需要 HTML 预览时走宿主构建/预览能力（见 skill 交付说明）。',
    };
  }
  return {
    ...base,
    userFacingActions: [
      `书稿合并稿与对外文件可放在「${relDeliverables}」文件夹。`,
      '若宿主支持结果展示：生成 HTML 后可用「在侧栏/预览中打开」类动作查看版式（以当前宿主为准）。',
      '需要 Word/PDF/幻灯片时，通过宿主已启用的文档类插件导出（勿向用户复述插件内部代号）。',
    ],
    agentNote:
      'presentationBridgeSupported 为 true：可优先走 host-consume-presentation / 宿主展示链路；仍须先确认路径再打开。',
  };
}

/** 供 Agent 内部路由，禁止逐字给用户念技能 ID */
export function buildSearchStrategyHints(hostCap) {
  const avail = new Set(hostCap?.tier1?.relevantSkills?.available || []);
  const lines = [];
  if (avail.size === 0) {
    lines.push('当前未探测到本地市场增强能力时：先用通用联网检索，并按检索前置合同记录来源。');
    return { agentLines: lines, userFacingSummary: '按阶段做检索并保留来源记录。' };
  }
  if (avail.has('wechat-article-search')) {
    lines.push('中文资讯/公众号素材：优先用微信公众号文章检索能力补充（适用国内读者与行业动态）。');
  }
  if (avail.has('multi-search-engine')) {
    lines.push('需要多角度网页素材：优先用多引擎聚合检索，减少单一搜索引擎盲区。');
  }
  if (avail.has('citation-manager')) {
    lines.push('学术引用与参考文献格式：优先用引用管理能力拉取元数据并统一格式。');
  }
  if (avail.has('deep-research')) {
    lines.push('需要结构化深度调研报告：可走深度调研工作流（分阶段产出提纲与报告）。');
  }
  lines.push('以上均为宿主侧可选增强；不可用时按 search-policy 降级，不得假装已执行。');
  return {
    agentLines: lines,
    userFacingSummary: '会按你的主题自动选用合适的检索与引用方式，并保留可查来源。',
  };
}

export function buildMemoryMigrationNudge(markers) {
  if (!markers) return null;
  if (markers.memoryDirExists) return null;
  if (!markers.legacyMemeryDirExists) return null;
  return {
    userFacingOneLiner:
      '检测到宿主记忆仍在旧目录：若你愿意，可在方便时把记忆迁到新目录（可减少以后恢复时的歧义）。',
    agentNote:
      'markers：memory 目录不存在而 memery 存在；勿强迫用户迁移；仅轻量提示一次即可。',
  };
}

export function buildTeamOrchestrationNudge(hostCap) {
  const avail = hostCap?.tier1?.relevantSkills?.available || [];
  if (!Array.isArray(avail) || !avail.includes('agent-team-orchestration')) return null;
  return {
    agentNote:
      '本地市场已具备多角色编排能力：复杂并行任务时可由编排入口分派，福帮手侧仍以书稿目录与台账为真值，避免重复写入。',
    userFacingSummary: null,
  };
}

/**
 * 合并首屏三个主选项文案（不向用户暴露内部技能名）
 */
export function buildPrimaryOptionsHintWithHistory(env, historicalShortcuts) {
  if (env.gateSummary?.status === 'blocked') {
    return ['继续写作（系统将提示风险）', '先做快速检查', '查看待处理问题'];
  }
  if (env.retroGate?.hasUnresolvedP0) {
    return ['继续写作（需确认风险）', '先做快速检查', '查看整改清单'];
  }
  const s = historicalShortcuts || [];
  if (s.length === 0) {
    return ['开始写作（新书或新章节）', '继续当前书稿', '先定本章计划'];
  }
  if (env.resumeCard && s.length >= 1) {
    return [
      '开始写作（新书或新章节）',
      '接着写当前书稿（当前已打开目录）',
      s[1]
        ? `打开登记过的另一本：${s[1].displayTitle}`
        : `打开登记过的书稿：${s[0].displayTitle}`,
    ];
  }
  if (s.length >= 2) {
    return ['开始写作（新书或新章节）', `继续「${s[0].displayTitle}」`, `继续「${s[1].displayTitle}」`];
  }
  return ['开始写作（新书或新章节）', `继续「${s[0].displayTitle}」`, '先定本章计划'];
}
