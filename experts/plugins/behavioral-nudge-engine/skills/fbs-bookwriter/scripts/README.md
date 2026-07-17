# FBS-BookWriter 脚本索引

> **用途**：为 `scripts/` 目录提供统一导航，说明常用脚本的职责、触发条件和典型调用入口。  
> **适用对象**：维护者、宿主 AI、需要排查或扩展 FBS 工作流的开发者。

---

## 目录分层

| 路径 | 作用 | 何时进入 |
|---|---|---|
| `scripts/` 顶层 | 入口脚本、工作流脚本、质检脚本、打包脚本 | 需要直接执行 FBS 主流程时 |
| `scripts/agents/` | 供多智能体或后台任务调用的辅助脚本 | 处理审计、简报、协同任务时 |
| `scripts/lib/` | 共享运行时与工具库 | 修改底层能力、宿主桥接、公共函数时 |
| `scripts/test/` | `vitest` 回归测试 | 修改规则、元数据、路由、打包逻辑后 |
| `scripts/wecom/` | 企业微信相关桥接与投递 | 需要企业微信分发链路时 |
| `scripts/_deprecated/` | 已弃用或兼容保留脚本 | 只在追溯历史行为或兼容旧包时进入 |
| `archive/versions/scripts/` | 历史 `pack-v202` / `v210` 等别名脚本归档（**不可直接执行**，路径已失效） | 仅溯源旧版打包入口 |

---

## npm 脚本速查（与 CI 对齐）

| 脚本 | 用途 |
|------|------|
| `npm test` | 全量 Vitest（CI 默认） |
| `npm run test:contract` | 契约/版本/hints 快测，适合提交前首跑 |
| `npm run test:integration` | 除契约包外的其余测试 |
| `npm run audit:all` | P0 六段审计，**默认书根** `fixtures/ci-book-root`（与 CI 一致） |
| `npm run audit:all:strict` | 同上 + `--strict`（与 CI **P0 audits strict** 一致） |
| `npm run validate:runtime-hints` | 校验 `fbs-runtime-hints.json`（已含于 `pack:skill-gates`） |
| `npm run manifest:scripts` | 生成 `scripts/generated/scripts-manifest.json`（CI 与 `evolution-gate` 前执行） |
| `npm run clean:dist` | 删除 `dist/*-temp`、`dist/test-unzip` 等打包复检残留 |
| `npm run clean:dist:prune` | 同上 + 删除 `dist` 内旧版 zip 及同名校验 JSON |
| `npm run fbs:progress-snapshot` | 写出 `.fbs/progress-snapshot.md`（可选抽查） |

自定义书稿根：`npm run audit:all -- --book-root <绝对或相对路径>`（后者覆盖默认）。

---

## 高频入口脚本

### 入口 / 恢复 / 会话生命周期

| 脚本 | 职责 | 典型触发 |
|---|---|---|
| `intake-router.mjs` | 统一首响入口；自动做宿主检测、恢复工件补写、意图路由 | 首次进入、`bookRoot` 变更、只说“福帮手/写书” |
| `host-capability-detect.mjs` | 探测 WorkBuddy / CodeBuddy 宿主能力与 Tier1/2 可用性 | 启动前、切换宿主后、打包前校验 |
| `workbuddy-session-snapshot.mjs` | 生成 `.fbs/workbuddy-resume.json` 恢复卡 | 阶段完成、退出前、跨会话恢复 |
| `write-progress-snapshot.mjs` | 生成 `.fbs/progress-snapshot.md` 文本进度块（对照 UX 规则抽查，非门禁） | `npm run fbs:progress-snapshot`；阶段切换 / 章节完成后可选 |
| `apply-book-memory-template.mjs` | 生成 Smart Memory 快照与 `session-resume-brief.md` | 首响补写、退出补写、恢复链修复 |
| `session-exit.mjs` | 标准退出脚本；默认先保存恢复卡与摘要再退出 | 命中“退出 / 停止 / 退出福帮手” |
| `workbuddy-user-profile-bridge.mjs` | 吸收宿主画像到当前书稿上下文 | 首响恢复、偏好同步 |
| `release-feedback-bridge.mjs` | 汇总宿主反馈 / 提审反馈进入书稿工作面 | 提审后、回传问题时 |
| `collect-host-diagnostics.mjs` | 收集宿主 / 乐包 / 二进制登记等诊断（路径脱敏） | 排障、策略 A 现场快照 |
| `fbs-cleanup.mjs` | 清理过期缓存（如 stale p0-audit-report） | 门禁误阻断排障、会话前清理 |
| `emit-upgrade-summary.mjs` | 对比旧版技能根与当前仓库，生成 `releases/upgrade-capability-summary-*.md` | 装包前后、策略 C 留档 |
| `propose-lexicon-refresh.mjs` | 生成词表更新提案模板 | 策略 C、季度词表评审 |

### 初始化 / 工作流推进

| 脚本 | 职责 | 典型触发 |
|---|---|---|
| `init-fbs-multiagent-artifacts.mjs` | 初始化 `.fbs/`、`deliverables/`、`releases/` 三层工作面 | 新项目、新书稿、裸目录补底座 |
| `rewrite-plan-bootstrap.mjs` | 生成拆书改写最小执行计划模板（`.fbs/rewrite-plan.md`） | 进入“拆书式改写”前锁定保留/替换/新增清单 |
| `workflow-progressor.mjs` | 推进 S0–S6 阶段状态 | 阶段切换、自动化推进 |
| `s3-start-gate.mjs` | S3 写稿前门禁检查 | 从大纲进入写作前 |
| `chapter-dependency-gate.mjs` | 校验章节依赖与写作先后关系 | 多章并行、章节顺序敏感时 |
| `save-chapter-brief.mjs` | 固化章节简报 / 写作 brief | S2 定稿、S3 开写前 |
| `shared-knowledge-base.mjs` | 建立或更新共享知识底座 | 长书项目、多人协同时 |

### 搜索 / 原料 / 记忆

| 脚本 | 职责 | 典型触发 |
|---|---|---|
| `record-search-preflight.mjs` | 记录检索前置合同 | 进入 S0 / S1 / S2 联网检索前 |
| `enforce-search-policy.mjs` | 校验检索记录是否满足阶段规则 | S2 / S2.5 / S3 门禁前 |
| `link-search-ledger-to-chapters.mjs` | 将搜索记录与章节台账关联 | 证据回填、阶段复盘 |
| `smart-memory-core.mjs` | FBS 本地记忆核心管理 | 查看偏好、写入记忆、恢复摘要 |
| `knowledge-fetcher.mjs` | 抓取知识源并转成结构化输入 | 深度研究、知识回填 |
| `knowledge-delta-extractor.mjs` | 比较新旧知识变化 | 连续调研、迭代更新 |

### 质检 / 审校 / 审计

| 脚本 | 职责 | 典型触发 |
|---|---|---|
| `quality-auditor-lite.mjs` | 轻量四层评分 | 常规去 AI 味、存量质检 |
| `quality-auditor.mjs` | 机器可检项扫描 / 自动修复 | 深度质检、批量扫描 |
| `quality-panorama-orchestrator.mjs` | Panorama / Deep 双阶段总控 | 大规模书稿、全景质检 |
| `quality-audit-incremental.mjs` | 增量质检 | 只检查本轮修改范围 |
| `quick-scan.ps1` | 无 Node 环境下的 PowerShell 快扫 | Windows 宿主、应急降级 |
| `consistency-audit.mjs` | 版本/NLU/配置/SKILL 引用脚本一致性巡检 | `npm run audit:consistency`、打包前 |
| `build-intent-canonical-assets.mjs` | 由意图单真源生成快照与文档资产 | 调整触发词/冲突矩阵后 |
| `intent-ops-report.mjs` | 输出意图识别澄清率与低置信率治理报告 | 词典调整后、周报收口 |
| `validate-runtime-hints.mjs` | 校验 `fbs-runtime-hints.json` 键、路径与 `package.json` 版本对齐 | `npm run validate:runtime-hints`、`pack:skill-gates` |
| `validate-skill-frontmatter.mjs` | `SKILL.md` YAML 顶层键白名单 | `npm run validate:skill-frontmatter`、`pack:skill-gates` |
| `fbs-doctor.mjs` | 聚合预检（frontmatter + runtime-hints + env-preflight + Node 引擎） | `npm run doctor` |
| `ux-flow-guard.mjs` | 体验规则门禁（恢复卡、最多 3 条推荐等） | 打包前、`npm run pack:skill-gates` |
| `audit-broken-links.mjs` | 文档链接检查 | 改文档索引、重构 references 后 |
| `audit-pending-verification.mjs` | 待核实清单清零检查 | S5 前、交付前 |

### 展示 / 交付 / 打包

| 脚本 | 职责 | 典型触发 |
|---|---|---|
| `host-consume-presentation.mjs` | 处理宿主展示消费链路 | 交付预览、展示结果 |
| `launch-presentation-preview.mjs` | 启动展示预览流程 | 需要本地预览 HTML / 交付物 |
| `presentation-preview-server.mjs` | 本地预览服务器 | HTML 预览、S5 展示 |
| `html-delivery-smoke.mjs` | HTML 交付冒烟检查 | 打包前、展示链校验 |
| `pack-workbuddy-marketplace.mjs` | 生成 WorkBuddy 审核包 | 提审 WorkBuddy 时 |
| `pack-codebuddy-plugin.mjs` | 生成 CodeBuddy 插件包 | 发布 CodeBuddy 通道时 |
| `pack-release.mjs` | 默认仅生成 WorkBuddy 主包；可用 `--all` 生成三通道发布产物 | 正式发版、重打送审包 |
| `lib/pack-skill-gates.mjs` | 打包前 Skill 全量门禁（含 vitest 契约、ux-flow、consistency-audit） | `npm run pack:skill-gates` |
| `version-bump.mjs` | 统一版本号变更 | 发新版本前 |
| `version.mjs` | 输出当前版本真值 | 校验版本一致性 |

---

## 维护类脚本分组说明

- **`audit-*`**：针对特定质量问题或一致性问题的专项巡检脚本。
- **`phase*` / `execute-phase*`**：阶段性优化、性能实验或历史改造脚本。
- **`*optimization*` / `*enhanced*`**：优化版实现或实验性增强逻辑，修改前应先看对应测试覆盖。
- **`workspace-*` / `plan-board.mjs` / `heartbeat-monitor.mjs`**：运行时管理、心跳和工作区治理脚本。

---

## Windows 与路径说明

- 仓库可在 **Windows** 本地开发与在 **Linux**（如 GitHub Actions）上跑 CI；请以 **正斜杠** 或 Node 提供的 `path` 拼接路径，避免硬编码盘符。
- `quick-scan.ps1` 等 **PowerShell 脚本** 仅在 Windows/PowerShell 环境适用；文档中若写「无 Node 时快扫」，请勿在仅 bash 的 CI 中强依赖。
- `session-exit` / `intake-router` 等要求 **`--book-root` 指向书稿根**；在书稿子目录执行时勿假定 `cwd` 即书根。

---

## 修改脚本前的建议顺序

1. 先确认这是**入口脚本**、**规则脚本**还是**打包脚本**。
2. 若涉及 `SKILL.md`、`plugin.json`、`channel-manifest.json`，同步检查 `scripts/test/skill-package-consistency.test.mjs`。
3. 若涉及质检规则，至少同步检查：
   - `references/02-quality/quality-check.md`
   - `references/02-quality/quality-S.md`
   - `references/02-quality/quality-PLC.md`
4. 若涉及退出 / 恢复链路，至少联动检查：
   - `intake-router.mjs`
   - `session-exit.mjs`
   - `apply-book-memory-template.mjs`
   - `workbuddy-session-snapshot.mjs`
5. 修改完成后优先运行相关定向测试，再跑全量测试与打包。

---

## 相关入口

- 文档总索引：`references/01-core/skill-index.md`
- 技能主入口：`SKILL.md`
- 平台运维简报：`references/05-ops/platform-ops-brief.md`
- 发版核对清单：`references/05-ops/release-checklist.md`
- 多智能体写入隔离：`references/05-ops/multi-agent-horizontal-sync.md`
