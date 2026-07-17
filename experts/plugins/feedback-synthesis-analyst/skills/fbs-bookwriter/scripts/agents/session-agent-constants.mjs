/**
 * Session Agent 静态配置（从 session-agent.mjs 抽出，便于维护与降行数）
 */

export const SESSION_TYPES = {
  CREATIVE: "creative",
  READER: "reader",
  ADVERSARIAL: "adversarial",
  REVIEW: "review",
};

export const ROLES = {
  RADICAL: "radical",
  CONSERVATIVE: "conservative",
  READER: "reader",
  NOVICE: "novice",
  EXPERIENCED: "experienced",
  EXPERT: "expert",
  SUPPORTER: "supporter",
  OPPONENT: "opponent",
  SYNTHESIZER: "synthesizer",
  CONTENT_EXPERT: "content_expert",
  EXPRESSION_EXPERT: "expression_expert",
  CRITIC: "critic",
};

export const PHASES = {
  DIVERGENCE: "divergence",
  CONVERGENCE: "convergence",
};

/** 与历史行为一致：原文件对 CREATIVE 重复赋值，运行时仅保留最后一项 */
export const DURATION_LIMITS = {
  [SESSION_TYPES.CREATIVE]: { mode: "light", normal: 5, timeout: 10 },
  [SESSION_TYPES.READER]: { normal: 7.5, timeout: 15 },
  [SESSION_TYPES.ADVERSARIAL]: { normal: 12.5, timeout: 20 },
  [SESSION_TYPES.REVIEW]: { normal: 17.5, timeout: 30 },
};

export const PSYCHOLOGICAL_CONTRACT_OPTIONS = {
  FIND_ISSUES: "find_issues",
  BALANCE: "balance",
  CONFIRM_HIGHLIGHTS: "confirm_highlights",
};

export const SESSION_FILE_NAMES = {
  [SESSION_TYPES.CREATIVE]: "creative-session.md",
  [SESSION_TYPES.READER]: "reader-session.md",
  [SESSION_TYPES.ADVERSARIAL]: "adversarial-session.md",
  [SESSION_TYPES.REVIEW]: "review-session.md",
};

export const SESSION_LABELS = {
  [SESSION_TYPES.CREATIVE]: "创意会",
  [SESSION_TYPES.READER]: "读者会",
  [SESSION_TYPES.ADVERSARIAL]: "对抗会",
  [SESSION_TYPES.REVIEW]: "评审会",
};

export const ROLE_LABELS = {
  [ROLES.RADICAL]: "激进派",
  [ROLES.CONSERVATIVE]: "守序派",
  [ROLES.READER]: "读者派",
  [ROLES.NOVICE]: "新手读者",
  [ROLES.EXPERIENCED]: "有基础读者",
  [ROLES.EXPERT]: "挑剔读者",
  [ROLES.SUPPORTER]: "支持者",
  [ROLES.OPPONENT]: "反对者",
  [ROLES.SYNTHESIZER]: "综合者",
  [ROLES.CONTENT_EXPERT]: "内容专家",
  [ROLES.EXPRESSION_EXPERT]: "表达专家",
  [ROLES.CRITIC]: "怀疑论者",
};

export const SESSIONS_SUMMARY_HEADER = `# 会议纪要汇总（.fbs/sessions-summary.md）

> **适用场景**：所有会议（创意会/读者会/对抗会/评审会）关键决策汇聚一处，用户只看这一个文件即可了解所有会议结论。
> **更新时机**：每次会议完成后，由主编或 team-lead 追加（在本段最上方插入最新记录）。
> **规范参考**：\`references/01-core/session-protocols.md\` + \`references/05-ops/search-policy.json\` → sessionProtocols.sessionSummaryFile

## 会议记录（最新在上）

| 时间 | 会议类型 | 核心决策（≤3条） | 待执行事项 | 详情文件 |
|------|---------|--------------|---------|---------|
| — | — | — | — | — |

---

## 说明

每次会议后追加一行（在表格上方插入），格式：
\`| {ISO时间} | {创意会/读者会/对抗会/评审会} | 决策1；决策2；决策3 | 待执行1；待执行2 | .fbs/sessions/{文件名} |\`

详细纪要见对应的 sessions/ 子目录文件。
`;
