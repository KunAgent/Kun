# 短指令完整清单（§4 扩展版）

> **原章节**：SKILL.md §4
> **主题**：短指令完整分类与说明（**经复核共 66 条**，含系统控制类与技能包落地类）
> **版本**：2.0（与 `search-policy` / SKILL Frontmatter 同版本）

---

## 导航

- 📄 **返回SKILL.md主文档**：[FBS-BookWriter](../../SKILL.md)
- 📄 **相关文档**：[§NLU指令系统](./section-nlu.md)

---

## 指令分类图

```
短指令（66条）
├─ 基础指令（18条）
│  ├─ 写作类（3条）
│  ├─ 搜索类（3条）
│  ├─ 构建类（4条）
│  └─ 查看类（8条）
├─ 系统控制（3条）
│  └─ 终止、帮助（含「帮帮我」同义）、确认（主题校验）
├─ v6新增指令（9条）
│  ├─ 学术合规类（4条）
│  ├─ 版权商用类（3条）
│  └─ 项目管理类（2条）
├─ 新手引导（18条）
│  ├─ 模式切换类（4条）
│  ├─ 偏好管理类（5条）
│  ├─ 资产管理类（7条）
│  └─ 自动化类（2条）
└─ 技能包落地（18条）
   ├─ 构建导出类（3条）
   ├─ 门禁与质检类（9条）
   └─ 记忆与编排类（6条）
```

---

## 基础指令（18条）

### 写作类

| 用户说 | 执行 |
|--------|------|
| "写"/"成文" | 生成当前章节 |
| "下一章" | 启动下一章流水线 |
| "续写" | 继续当前内容写作 |

### 搜索类

| 用户说 | 执行 |
|--------|------|
| "搜一下"/"验证" | 联网搜索并报告 |
| "竞品" | 重新 **S0-A 内容竞品**扫描（同类书/报告等可替代本稿者；非默认行业产品矩阵，见 `section-3-workflow` S0） |
| "保鲜检查" | 输出数据保鲜报告 |

### 构建类

| 用户说 | 执行 |
|--------|------|
| "构建" | 排版构建（阶段产物） |
| "导出" | 导出打包当前项目 |
| "封面" | 重新生成/调整封面 |
| "加图" | 追加/修改插图标记 |

### 查看类

| 用户说 | 执行 |
|--------|------|
| "自检" / "质量报告" | 输出详细质量报告（与 [`section-nlu.md`](./section-nlu.md) `REVIEW` 同目标，短指令别名） |
| "图表" | 查看/修改当前章Mermaid图表 |
| "视觉清单" | 输出全书视觉资产清单 |
| "风格" | 显示/修改风格档案 |
| "策略" | 显示/切换策略组合 |
| "日志" | 显示当前运行日志 |
| "加载日志" | 加载上次运行日志 |
| "推荐" | 使用默认策略（标准×标准协同） |

---

## 系统控制（3条）

| 用户说 | 执行 |
|--------|------|
| "终止"/"停止"/"取消"/"中断"/"退出"/"退出福帮手" | **安全结束**当前流水线或子任务：默认先执行 `node scripts/session-exit.mjs --book-root <bookRoot> --json` 写入恢复卡与会话摘要；其 JSON 标准字段为 `saved`、`bookRoot`、`note`、`files`、`snapshotSummary`、`userMessage`，随后再停止继续自动工具调用，并向用户确认已停 |
| "帮助"/"帮帮我"/"指令"/"怎么用" | 输出 Tier 1/2 指令摘要，并指向本文件与 [`section-nlu.md`](./section-nlu.md) |
| "确认"/"是的"/"没错" | **主题一致性校验**：回显当前锁定主题「确认继续写[主题]？」，校验通过后继续；无锁定主题时询问「确认写什么？」（与 [`section-nlu.md`](./section-nlu.md) `CONFIRM_TOPIC` 对齐） |

### 脚本与 CLI 联动（排查 / 运维，非 MCP）

| 场景 | 执行 |
|------|------|
| 统一 CLI 帮助（检索前置合同、企微场景包、乐包、入口/退出等） | `node scripts/fbs-cli-bridge.mjs help` 或 `npm run fbs:cli -- help`（技能根目录） |
| 完整命令与能力对照 | [`skill-cli-bridge-matrix.md`](./skill-cli-bridge-matrix.md)；宿主机读见 `workbuddy/channel-manifest.json` / `codebuddy/channel-manifest.json` 的 `scriptBridge` |
| 开场路由器 JSON 中的指引 | 运行 `intake-router.mjs --json` 时，响应含 `scriptBridgeDoc`、`scriptBridgeCli`，与上表一致 |

---

## v6新增指令（9条）

### 学术合规类

| 用户说 | 执行 |
|--------|------|
| "学术声明" | 输出AI辅助学术用途声明模板 |
| "披露声明" | 输出AI辅助创作声明模板 |
| "合规检查" | 触发G层合规自查（可开关） |
| "学术模式" | 开启学术用途严格合规模式 |

### 版权商用类

| 用户说 | 执行 |
|--------|------|
| "商用模式" | 开启商用版权优先模式 |
| "版权声明" | 输出知识产权归属声明 |
| "授权案例" | 授权案例库共享协议 |

### 项目管理类

| 用户说 | 执行 |
|--------|------|
| "新项目" | 清零记忆+重新初始化项目 |
| "清零" | 仅清零当前项目状态 |

---

## 新手引导（18条）

### 模式切换类

| 用户说 | 执行 |
|--------|------|
| "切换模式"/"换模式" | 显示模式切换说明；若宿主提供 UI 且已实际执行，再进入模式切换界面（新手/专家） |
| "新手模式" | 切换到新手模式（引导式体验） |
| "专家模式" | 切换到专家模式（完整功能） |
| "当前模式" | 显示当前使用模式 |

### 偏好管理类

| 用户说 | 执行 |
|--------|------|
| "偏好设置"/"我的偏好" | 显示当前偏好摘要与可修改项；若宿主提供 UI 且已实际执行，再进入偏好设置面板 |
| "保存模板" | 保存当前配置为模板 |
| "加载模板" | 加载已保存的模板 |
| "删除模板" | 删除指定的模板 |
| "模板列表" | 显示所有可用模板 |

### 书房资产类

| 用户说 | 执行 |
|--------|------|
| "我的资产" | 显示书房资产摘要视图；若宿主提供 UI 且已实际执行，再进入书房资产面板 |
| "交互资产" | 显示交互资产摘要 |
| "产物资产" | 显示产物资产摘要 |
| "模板资产" | 显示模板资产摘要 |
| "自动化规则" | 显示自动化规则摘要 |
| "清理资产" | 列出可清理资产与建议操作；若宿主提供 UI 且已实际执行，再进入批量清理界面 |
| "标注参考" | 将资产标注为参考素材 |

### 自动化类

| 用户说 | 执行 |
|--------|------|
| "重新引导"/"重新开始" | 重新开始新手引导流程 |
| "跳过引导" | 跳过新手引导，直接进入 |

---

## 技能包落地（18条）

> 与 [`references/05-ops/promise-code-user-alignment.md`](../05-ops/promise-code-user-alignment.md) 主表对齐：将「文档承诺」落到可执行命令（仍依赖 Node 与可选脚本）。

### 构建导出类

| 用户说 | 执行 |
|--------|------|
| "构建 HTML"/"生成 HTML" | 本书根执行 `node <技能根>/assets/build.mjs`（依赖见 `build.md`）；CI 可加 `--strict-sources` 或 `FBS_BUILD_STRICT_SOURCES=1`（缺列出的 MD 即失败）；**无有效源 exit 1** |
| "导出 PDF"/"生成 PDF" | 浏览器打印 HTML 为 PDF，或见 `build.md` 自动化 |
| "生成 DOCX" | 见 `build.md` / `delivery-guide.md` 调用 html-to-docx 或等价转换 |

### 门禁与质检类

| 用户说 | 执行 |
|--------|------|
| "检索门禁校验" | `node scripts/enforce-search-policy.mjs --skill-root <技能根> --book-root <本书根> --chapter-id <id>` 或 `--chapter-file` |
| "S3 启动门禁" / "进 S3 前检查" | `node scripts/s3-start-gate.mjs --skill-root <技能根> --book-root <本书根>`；已有 `[S3]*.md` 时**自动**跑时间标签、术语扫描；ledger 存在时**自动**跑 `audit-query-optimization`（均默认警告）。阻断：`--audit-temporal-enforce` / `--audit-term-enforce` / `--audit-query-opt-enforce`；跳过：`--no-audit-temporal` |
| "S3 三守卫" / "一键 preflight" | `npm run guard:s3:full -- --skill-root <技能根> --book-root <本书根>`（`s3-guard.mjs`：门禁 + 心跳 + 台账真值） |
| "S5 前三项审计串联" / P0 六段 | **默认（与 CI 对齐）**：`npm run audit:all`（等价于 `--skill-root .` + `--book-root ./fixtures/ci-book-root`）。**严模式**：`npm run audit:all:strict`。真实书稿：追加 `-- --book-root <本书根>`（覆盖默认书根）。含断链+结构堵点+场景包+入口性能；紧急逃生可加 `--no-broken-links` / `--no-structure-guard` |
| "大文件体检" | `npm run inspect:large-files`（按体积/行数输出 Top 文件，用于结构化治理） |
| "结构堵点守卫" | `npm run guard:structure -- --skill-root <技能根> --book-root <本书根> [--enforce]`（持续运行风险体检：大文件、队列、心跳、账本、lockfile 与归档） |
| "锁文件摘要" | `npm run lockfile:summary`（生成 `.fbs/lockfile-summary.json`，用于 lockfile 变更节流） |
| "时间标签审计" / "年份硬编码检查" | `node scripts/audit-temporal-accuracy.mjs --book-root <本书根> --scan-book-s3`（或 `--inputs` / `--glob`）；CI 阻断加 `--enforce` |
| "待核实清单" / "S5 待办清零" | `node scripts/audit-pending-verification.mjs --book-root <本书根>`；S5 前加 `--enforce`（见 `.fbs/writing-notes/pending-verification.md`） |
| "P0 与脚本对照" | 打开 [`quality-gates-brief.md`](../05-ops/quality-gates-brief.md) 查看质量门禁规则（`search-policy.json` 的 **p0AutomationIndex**；完整 CLI 映射见企业/平台版 `p0-cli-map.md`，用户侧ZIP不含） |
| "质量审计" / "脚本质检" | `node scripts/quality-auditor.mjs --skill-root <技能根> --inputs <…md>` 或 `--glob "chapters/*.md"`；CI 可加 **`--fail-on-s6-warn`**（S6 警告带）/**`--enforce`**（S/P/C/B + **S6 仅阻断** >block + **S5 B 计 0** + 编号重复，**不含 V1**）/**`--enforce-strict`**（enforce + S6 警告带）/**`--fail-on-s5-buzz`**（单项 S5）/**`--fail-on-long-sentence-warn`**（S3>8%）/**`--fail-on-absolute-claims`**/**`--vcr-heuristic-warn`**（P2，见 [`quality-gates-brief.md`](../05-ops/quality-gates-brief.md)）；专项 **`--dash-density`** / **`--check-section-ids`** / **`--int-percent-density`** |
| "HTML 交付烟测" / "HTML 终稿检查" | `node scripts/html-delivery-smoke.mjs --html <路径.html> [--strict] [--fail-on-warn]`（见 [`html-deliverable-gate.md`](../05-ops/html-deliverable-gate.md)） |

### 记忆与编排类

| 用户说 | 执行 |
|--------|------|
| "初始化项目记忆" | `node scripts/init-project-memory.mjs --book <本书根> --skill <技能根>`（可选 `--with-workbuddy-hint` / `--workbuddy-hint-workspace-only` / `--with-environment-snapshot` / `--no-redact`） |
| "ESM 状态落盘 / 切换记录" | `node scripts/fbs-record-esm-transition.mjs --book-root <本书根> --from IDLE --to INTAKE --reason "原因" [--genre A]`（写入 `.fbs/esm-state.md` 与 `.fbs/规范执行状态.md`「切换日志」；见 `search-policy.json` **esmExecutionTracking**） |
| "WorkBuddy 记忆摘要" | 需宿主支持，具体配置请参考宿主文档（策略见 [`skill-authoritative-supplement.md §宿主集成指南`](../01-core/skill-authoritative-supplement.md)；JSON 字段 `bookContextHeuristics`） |
| "环境指纹 / 宿主路径探测" | 需宿主支持，具体配置请参考宿主文档（仅存在标记 + 策略版本，见 `search-policy` **environmentSnapshot**） |
| "工作流阶段清单" | `node scripts/workflow-progressor.mjs`（可选 `--current S3`） |
| "多智能体编排" | `node scripts/multiagent-orchestrator.mjs --stage S0`（话术全文见 `workbuddy-agent-briefings.md`） |

---

## 指令统计

| 分类 | 数量 | 占比 |
|------|------|------|
| 基础指令 | 18 | 27.3% |
| 系统控制 | 3 | 4.5% |
| v6新增 | 9 | 13.6% |
| 新手引导 | 18 | 27.3% |
| 技能包落地 | 18 | 27.3% |
| **总计** | **66** | **100%** |

> **说明**：统计不含口语变体（如「继续写」「接着来」归入同一指令）。当前共 66 条。

---

## 乐包体系

> 乐包是本地积累的写作奖励，也是虚拟书房的成长记录与解锁信号；它既用于解锁场景包体裁，也用于回显书房能力树所处阶段，纯离线运行，无需充值。

### 乐包获取方式

| 行为 | 乐包奖励 |
|------|---------|
| 首次安装 | +100 个乐包 |
| 每日首次使用 | +5 个乐包 |
| 完成一章 | +10 个乐包 |
| 章节质检通过 | +3 个乐包 |
| 完成整本书 | +50 个乐包 |

### 乐包能力树

| 能力枝 | 主要来源 | 解锁后用户感知 |
|--------|----------|----------------|
| 启房枝 | 首装、建书房、每日激活 | 看见书房底座、资产面板与基础体裁 |
| 成稿枝 | 完成章节、推进目录 | 书稿区更完整，章节推进更顺手 |
| 审校枝 | 通过质检、完成评审会 | 内容更稳定，待审到完成的闭环更清晰 |
| 转化枝 | 完成 S6 拆解、路线图、场景包来源识别 | 书房开始把内容推出书架，形成产品化能力 |
| 发布枝 | 完成发布映射、消化外部反馈、回流修订 | 书房开始面向外部生长，并能把反馈带回内部优化 |

### 体裁解锁门槛

| 体裁 | 门槛 | 对应解锁意义 |
|------|------|--------------|
| 通用 | 0 个乐包 | 基础书房可用（R1） |
| 家谱 | 100 个乐包 | 开始支持传承叙事类项目 |
| 创业顾问 | 200 个乐包 | 支持咨询/方法论型书稿 |
| 代撰稿 | 200 个乐包 | 支持章节级高质量代撰产品（R3） |
| 企业培训 | 300 个乐包 | 支持课程化、训练营与内训型内容 |
| 个人出书 | 500 个乐包 | 支持完整个人品牌型出书项目 |

### 指令回显要求

| 用户说 | 执行 |
|--------|------|
| "查看乐包" / "乐包余额" / "余额" | 显示当前余额、各体裁解锁状态、当前书房能力树阶段（对应 NLU `CHECK_BALANCE`） |
| "怎么解锁" / "乐包有什么用" / "还差多少" | 显示乐包获取方式、距离下一个解锁目标的差距、建议优先推进的书房动作（对应 NLU `UPGRADE_HINT`） |

> 乐包余额存储于本机 `scene-packs/credits-ledger.json`，流水账存于 `credits-ledger-log.jsonl`。
> 实现见 `scripts/wecom/lib/credits-ledger.mjs`（`getBalance` / `formatBalanceSummary` / `getUpgradeHint`）。

---

## 代码索引

| 模块 | 文件路径 |
|------|---------|
| NLU指令解析 | 宿主实现；规范见 [section-nlu.md](./section-nlu.md) |
| 乐包账本 | `scripts/wecom/lib/credits-ledger.mjs` |
