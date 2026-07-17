# 联网检索专项深化：四支柱

> **版本**：与 `search-policy.json` 同主版本迭代  
> **定位**：把联网搜索从「偶尔查一下」提升为贯穿 S0–S6 的**默认能力层**：补足模型知识截止、钉住时效、验证时态、反哺方法论与本技能知识库。

---

## 支柱一：知识截止补强（Why search）

大模型的**训练知识截止**是结构性缺陷：对「发布晚于截止日」的事实、价格、法规修订、产品迭代、人事与机构变更等，**不能**凭权重内推当作真值。

### 必须走联网（或等价一手来源）的典型域

- **数字与承诺**：API 价、订阅价、费率、配额、SLA。
- **规范与合规**：法律条文版本、行业标准编号、监管口径生效日。
- **版本与命名**：软件/模型/芯片/云产品的主推型号与生命周期状态。
- **市场与统计**：规模、份额、排名——须标注统计**截止时点**与来源。
- **新闻与事件**：「最新进展」「当前负责人」「是否已下架」类断言。

### 与策略的硬对齐

- `search-policy.json` 中 **mandatoryWebSearchStages**、S0 查证与 **search-ledger** 要求：不是「有则更好」，而是**阶段门禁与可审计记录**的一部分。
- 当检索失败而落入「仅模型知识」时，须在项目内显式记录（见 workflow 卷中 `s0SearchStatus` / `all-failed-model-knowledge-only` 处置），**禁止**静默当成已查证事实写入对外结论。

---

## 支柱二：时效锚定（Latest time / anti-stale）

「搜到了」不等于「搜对了」：检索结果页常混入**历史页面 SEO 残留**、**并列多代产品**、**旧标题未下线**，易被模型误读为当前真值。

### 查询侧纪律

1. **先锁「谁最新」再锁「细节」**  
   价格/型号类：先确认当前主推名称与代际，再以该名称为锚查规格与报价（详见 [`web-search-reverse-verification.md`](./web-search-reverse-verification.md)）。
2. **显式时间词**  
   在 query 或向宿主检索工具传参时加入**当前年**或「最新官方」「changelog」「release notes」等锚点，减少被旧页劫持。
3. **工具能力**  
   若宿主提供「按日期过滤 / 站内官方域」的高级检索，对**易变事实**优先使用，而非纯关键词泛搜。

### 项目内时间基准

- **S0 时间戳基线**：`project-config.json` 中与 `s0TimestampBaseline`、`.fbs/search-ledger.jsonl` 记录配合，使「本书开始查证的那一天」成为全书时间叙事的**一致参照**（与 [`temporal-accuracy-samples.md`](./temporal-accuracy-samples.md) 放行规则一致）。
- **正文表述**：对易变数据使用「截至 …」「据 …（来源，日期）」而非模糊的「目前」「最新」，除非已与检索结果互证。

---

## 支柱三：时态验证（State verification / 防误导）

获取信息后要回答三个问题：**来源说什么、那句话的日期是什么、与本书要写的「时点」是否一致**。

### 验证动作（最低集）

| 步骤 | 说明 |
|------|------|
| 对齐来源日期 | 页面「更新于」、文章发布日、报告封面年份；与正文声称的「当前」是否一致。 |
| 防同页混用 | 一页若并列多代价格/型号，**结论只能绑定与之一致的行**，禁止跨段拼接。 |
| 第二来源 | 对高影响数字/法规/价格，尽量有**独立来源**交叉（官方文档优先）。 |
| 写不进则标注 | 无法互证时写入 **MAT / 待核实** 或降格为「传闻级」并禁止进入终稿口径（与 `material-marker-governor`、终稿洁净门禁一致）。 |

### 工程化辅助

- **`node scripts/audit-temporal-accuracy.mjs`**：扫描年份硬编码与可疑表述（S3 门禁可联动 `--audit-temporal-enforce`）。
- **`temporal-accuracy-samples.md`**：人机对齐「应拦截 / 应放行」样例，减少误报与漏报。

---

## 支柱四：方法论与技能知识库增强（Beyond retrieval）

联网搜索在本项目中的角色**不仅是「填事实」**，还包括：

### 4.1 本书级沉淀（可继承的真值层）

- **search-ledger.jsonl**：查证 query、时间、URL、摘要、章节关联——形成**可审计**的检索史，而非一次性对话消耗。
- **material-library.md / 原料台账**：把检索得到的稳定结论沉淀为**可复用块**，供后续章节引用，避免每章重新「从零搜索」。

### 4.2 技能与流程进化（元层）

- **复盘 → 候选流程**：`retro-to-skill-candidates.mjs` 等将线上问题转为**可复用规则**；其中与「检索失误、时效错误」相关的项，应回流到本文件与 `web-search-reverse-verification.md`。
- **对外方法论段落**：白皮书/指南中涉及「如何做研究、如何标引用」的章节，应用联网检索**对照行业通行写法**（非抄袭事实句，而是**对齐结构与披露深度**），使本 Skill 的**方法论**与外部最佳实践保持张力对齐。
- **认知资产与叙事**：与 [`cognitive-asset-threeization.md`](./cognitive-asset-threeization.md)、`fbs-runtime-hints.json` 中价值表述一致——**检索增强的是可交付、可复核的书稿资产**，不是堆链接。

### 4.3 周期性再检

- 长周期项目中，对「数据章」「竞品对比」「法规依赖章」应设定**再检索触发条件**（阶段切换、发版前、用户声明外部世界已变），避免全书被单次 S0 检索**静态锁死**。

---

## 执行清单（Agent 速用）

1. 进入 S0/S1/S2 检索前：已口头宣告「为何查、查什么、查完去哪、离线怎么办」（见 `SKILL.md` 搜索前置合同）。
2. 涉及价、版、规：走 **反向验证** 查询链（[`web-search-reverse-verification.md`](./web-search-reverse-verification.md)）。
3. 写入结论前：完成 **时态验证** 最低集；存疑则 MAT/待核实，不硬写。
4. 落盘：有效检索写入 **search-ledger**；稳定事实进 **原料/台账**。
5. 发版前：按需跑 **audit-temporal-accuracy**，与终稿洁净、MAT 治理一并收口。

---

## 关联文档

| 文档 | 作用 |
|------|------|
| [`search-policy.json`](./search-policy.json) | 阶段强制、topicLock、ledger 与 temporal 配置 |
| [`web-search-reverse-verification.md`](./web-search-reverse-verification.md) | 模型/价格类反向验证 |
| [`temporal-accuracy-samples.md`](./temporal-accuracy-samples.md) | 年份与样例口径 |
| [`fbs-source-of-truth-matrix.md`](./fbs-source-of-truth-matrix.md) | 真源分层，避免叙事替代检索真值 |
