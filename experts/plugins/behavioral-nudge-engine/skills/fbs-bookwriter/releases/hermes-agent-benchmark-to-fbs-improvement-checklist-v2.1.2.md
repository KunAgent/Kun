# Hermes-Agent 对标研究与 FBS 改进清单（v2.1.2）

> 研究对象：`https://github.com/NousResearch/hermes-agent`（临时克隆：`tmp/hermes-agent`）  
> 目标：提炼可直接提升 FBS 用户价值与绩效的成熟机制，形成可执行改进清单。

---

## 一、最可借鉴的核心特色（高优先）

- **稳定系统提示分层与缓存**：减少回合漂移、提升一致性与成本效率。  
- **工具输出预算与自动外置**：避免长输出撑爆上下文，提升稳定性。  
- **可见技术动作的结构化解释**：用户知道“为什么做、对我有什么价值”。  
- **危险操作双轨防护**：命令级批准 + 内容级安全扫描。  
- **多入口统一契约（CLI/网关）**：同任务跨通道体验一致。  
- **记忆/会话搜索/技能三层闭环**：把“短期上下文”和“长期能力”分开治理。

---

## 二、Hermes 代码中的成熟办法（代码锚点）

1) 安静首屏、减少启动噪音  
- `tmp/hermes-agent/cli.py`（`HERMES_QUIET`）

2) 系统提示稳定分层 + 会话缓存  
- `tmp/hermes-agent/run_agent.py`：`AIAgent._build_system_prompt()`

3) 渠道输出契约（平台提示）  
- `tmp/hermes-agent/agent/prompt_builder.py`：`PLATFORM_HINTS`

4) 工具输出三层防线（单工具截断 + 单结果外置 + 回合总预算）  
- `tmp/hermes-agent/tools/tool_result_storage.py`：`maybe_persist_tool_result()`、`enforce_turn_budget()`

5) 澄清与危险确认分离  
- `tmp/hermes-agent/tools/clarify_tool.py`：`CLARIFY_SCHEMA`、`clarify_tool()`

6) 危险命令批准策略  
- `tmp/hermes-agent/tools/approval.py`：`DANGEROUS_PATTERNS`、`prompt_dangerous_approval()`

7) 内容级安全扫描  
- `tmp/hermes-agent/tools/tirith_security.py`

8) 记忆层与上下文围栏  
- `tmp/hermes-agent/tools/memory_tool.py`、`tmp/hermes-agent/agent/memory_manager.py`

9) 历史会话检索摘要链  
- `tmp/hermes-agent/tools/session_search_tool.py`

10) 技能治理与导入安全门禁  
- `tmp/hermes-agent/tools/skill_manager_tool.py`、`tmp/hermes-agent/tools/skills_guard.py`

---

## 三、FBS 对应改进清单（P0-P2，可执行）

## P0（立即提升用户价值与稳定性）

### P0-1 系统提示分层缓存合同（对齐 Hermes _build_system_prompt）
- **借鉴来源**：`run_agent.py` `AIAgent._build_system_prompt()`  
- **FBS 落地**：`scripts/intake-router.mjs` + `fbs-runtime-hints.json` 增加“提示层级与失效条件”机读字段。  
- **用户价值**：首屏与后续行为更稳定，减少“同问不同答”。  
- **验收**：
  - `npm run validate:runtime-hints`
  - `npm run audit:consistency`
- **落地状态**：✅ 已落地（`fbs-runtime-hints.json#promptLayerCache` + `firstResponseContext.promptLayerCacheContract`）

### P0-2 工具输出预算门禁（对齐 tool_result_storage）
- **借鉴来源**：`tools/tool_result_storage.py`  
- **FBS 落地**：新增 `scripts/tool-output-budget-gate.mjs`，在长输出脚本后统一执行预算检查与外置。  
- **用户价值**：减少上下文溢出、卡顿和结果截断。  
- **验收**：
  - `npm run audit:all:strict`
  - 新增 `scripts/test/tool-output-budget-gate.test.mjs`
- **落地状态**：✅ 已落地（`scripts/tool-output-budget-gate.mjs` + `run-p0-audits`/`pack-skill-gates` 接入）

### P0-3 危险操作批准策略统一（对齐 approval）
- **借鉴来源**：`tools/approval.py`  
- **FBS 落地**：在执行写盘/命令类动作前引入 `once/session/always` 级别确认策略（高危禁 always）。  
- **用户价值**：降低误操作风险，增加可控感。  
- **验收**：
  - 新增 `scripts/test/approval-policy.test.mjs`
  - `npm test`
- **落地状态**：✅ 已落地（`scripts/approval-policy.mjs` / `scripts/command-approval-policy.mjs` + intake `dangerousOperationPolicy`）

### P0-4 质量结论层强制展示（已启动，继续加固）
- **借鉴来源**：Hermes 的“结构化中间层 + 平台契约”思路  
- **FBS 落地**：基于 `scripts/fbs-quality-full.mjs`，把 `bookQualityConclusion` 作为质检默认出口。  
- **用户价值**：终稿 vs 单章不再混淆，决策更快。  
- **验收**：
  - `node scripts/fbs-quality-full.mjs --book-root <bookRoot> --enforce`
  - 检查 `.fbs/quality-full-last.json`
- **落地状态**：✅ 已落地（`scripts/fbs-quality-full.mjs` + intake `qc` 分流与全局结论层）

## P1（两周内显著提升体验）

### P1-1 澄清工具结构化（对齐 clarify_tool）
- **借鉴来源**：`tools/clarify_tool.py`  
- **FBS 落地**：为 intake/qc/rewrite 增加“结构化澄清 schema”（选项 + 默认路径），与危险确认分离。  
- **用户价值**：减少反复追问，缩短决策轮次。  
- **验收**：
  - `scripts/test/intake-router.test.mjs` 新增澄清路径断言
- **落地状态**：✅ 已落地（`firstResponseContext.clarifyContracts`）

### P1-2 多入口契约一致（对齐 PLATFORM_HINTS + gateway/session）
- **借鉴来源**：`agent/prompt_builder.py`、`gateway/session.py`  
- **FBS 落地**：统一 WorkBuddy/CLI 输出 profile，避免同任务跨通道话术漂移。  
- **用户价值**：跨渠道体验一致、可预测。  
- **验收**：
  - `scripts/test/host-presentation-contract.test.mjs`
  - `npm run validate:runtime-hints`
- **落地状态**：✅ 已落地（`entryOutputProfiles` + host integration 契约字段）

### P1-3 可见技术动作 KPI 门禁（已完成，继续运营）
- **借鉴来源**：Hermes 的“能力+测试+门禁一体化”实践  
- **FBS 落地状态**：已接入 `scripts/visible-tech-action-kpi.mjs` + P0审计链 + 打包门禁。  
- **用户价值**：避免回退到“只见命令不见价值”。  
- **验收**：
  - `npm run kpi:visible-tech-action`
  - `npm run audit:all:strict`
- **落地状态**：✅ 已落地（持续运营）

### P1-4 技能导入安全扫描（对齐 skills_guard）
- **借鉴来源**：`tools/skills_guard.py`  
- **FBS 落地**：对外部技能/规则导入增加静态扫描与信任分级。  
- **用户价值**：减少注入与供应链风险。  
- **验收**：
  - 新增 `scripts/skills-import-guard.mjs`
  - 对应测试 + `pack:skill-gates` 接入
- **落地状态**：✅ 已落地（`scripts/skills-import-guard.mjs` + `scripts/test/skill-import-security-scan.test.mjs`）

## P2（中期能力建设）

### P2-1 会话检索摘要链（对齐 session_search_tool）
- **借鉴来源**：`tools/session_search_tool.py`  
- **FBS 落地**：在 `.fbs` 历史中引入“检索+截断+摘要”而非全文拼接。  
- **用户价值**：长项目恢复更快，不污染当前上下文。  
- **验收**：
  - 新增 `scripts/session-recall-summarizer.mjs`
  - 测试覆盖 recall 精准率与长度预算
- **落地状态**：✅ 已落地（`scripts/session-recall-summarizer.mjs` + 单测）

### P2-2 记忆围栏与污染防护（对齐 memory_manager）
- **借鉴来源**：`agent/memory_manager.py`  
- **FBS 落地**：在记忆注入时强制 `<memory-context>` 围栏与来源标注。  
- **用户价值**：减少“记忆当成用户新输入”导致的误导。  
- **验收**：
  - `scripts/test/memory-context-fence.test.mjs`
- **落地状态**：✅ 已落地（`scripts/lib/fbs-context-fences.mjs` + `scripts/test/memory-context-fence.test.mjs`）

### P2-3 安全扫描子进程化（对齐 tirith_security）
- **借鉴来源**：`tools/tirith_security.py`  
- **FBS 落地**：危险动作前可选内容扫描（可 fail-open/fail-closed 配置）。  
- **用户价值**：在不明显打断写作的前提下提升安全保障。  
- **验收**：
  - 新增 `scripts/content-safety-precheck.mjs`
  - `audit:all:strict` 可选接入
- **落地状态**：✅ 已落地（`scripts/content-safety-precheck.mjs` + `run-p0-audits` 可选接入）

---

## 四、最优执行顺序（建议）

1. P0-2 工具输出预算门禁  
2. P0-3 危险批准策略统一  
3. P1-1 结构化澄清  
4. P1-2 多入口契约一致  
5. P1-4 技能导入安全扫描  
6. P2 三项（回忆链、记忆围栏、安全扫描）

---

## 五、成功标准（面向用户价值）

- 首屏稳定：始终 `1行状态 + <=3主选项`  
- 质检决策效率：用户一次选择即可进入正确范围  
- 可见技术解释：KPI 持续达标（`visible-tech-action-kpi`）  
- 稳定性：长任务不因工具输出超量导致体验崩坏  
- 安全性：高危操作默认需确认，误操作率下降

