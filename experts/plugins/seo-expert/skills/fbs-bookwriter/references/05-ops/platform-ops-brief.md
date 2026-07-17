# 平台运维简报（构建 · 交付 · 心跳）

**版本**：2.0 · **层级**：平台侧（维护者参考）

> **运行环境要求**：Node.js ≥ 18.0.0（`node --version` 验证；`_plugin_meta.json engines.node` 字段同步声明）

---

## 一、构建系统（`assets/build.mjs`）

在**技能包根目录**执行：

```bash
node assets/build.mjs
node assets/build.mjs --check
```

- 环境变量与严格源校验见 [`section-4-commands.md`](../01-core/section-4-commands.md)。
- 输出须满足 [`html-deliverable-gate.md`](./html-deliverable-gate.md) 方可宣称 **D1**。
- `package.json` 中 `build` / `build:check` 为同名封装。

---

## 二、交付体系（MD / HTML / 打包）

**关联**：[`delivery-guide.md`](./delivery-guide.md)

| 路径 | 说明 |
|------|------|
| **MD** | 零环境真理源；章节与 `[S*]` 命名见工作流 §3 |
| **HTML** | 专业档走构建系统 + HTML 交付门禁 |
| **PDF/DOCX** | 可选依赖见 [`01-user-install-guide.md`](../03-product/01-user-install-guide.md) |

**D1/D2/D3 三档定义**（权威定义见 [`html-deliverable-gate.md`](./html-deliverable-gate.md)）：

| 档位 | 含义 | 关键条件 |
|------|------|----------|
| **D1** | 专业 HTML 终稿 | `assets/build.mjs` 构建 + `html-delivery-smoke.mjs --strict --fail-on-warn` 退出码 0 + Node ≥18 + `npm install`（含脚注依赖，见 `01-user-install-guide.md`） |
| **D2** | 诚实降级 HTML | 无完整构建链时的显式声明；不得标注为 D1 |
| **D3** | 会话内草稿 | 禁止冒充 D1；不得用于对外宣称「可发布」 |

四档交付（A 轻量 / B 标准 / C 完整 / D 网站）与 `05-product-framework`「四种交付选项」一致；实施时以**真实构建能力**标注 D1/D2/D3，禁止夸大。用户操作详见 [`delivery-guide.md`](./delivery-guide.md)。

**结果打开默认策略**：
- 优先打开 `deliverables/` 下的 HTML 交付物；HTML 属于用户可见终稿，应走浏览器/预览模式。
- HTML 预览优先执行 `node scripts/launch-presentation-preview.mjs --book-root "<bookRoot>"`，自动定位最新展示目标、后台拉起预览并返回本地 URL。
- 宿主统一执行 `node scripts/host-consume-presentation.mjs --book-root "<bookRoot>" --json`；该脚本会优先读取最新 `fbs.presentation.ready` 事件，其次回退 `presentation-ready.json`，必要时自动补拉最新 HTML 预览。
- **关键边界**：`host-consume-presentation.mjs` 返回的是宿主下一步应执行的 `hostAction`，并不等于结果已经在 UI 中打开；宿主必须继续实际调用 `preview_url` 或 `open_result_view`，才能向用户宣称“已打开”。
- 自动预览完成后，会向 `.fbs/host-bridge-events.jsonl` 追加 `fbs.presentation.ready` 事件；宿主优先消费该事件中的 `presentationAccess`，不要只盯 `presentation-ready.json`。

- 若只掌握单个 HTML 文件路径，再退回 `node scripts/presentation-preview-server.mjs --file "<deliverables/chapterId.html>" --port 4173` 把文件路径转换为本地 URL。



- 若 HTML 缺失，再回退到 `deliverables/` 下的 MD；仍缺失时再回退 `releases/<chapterId>-release.json`。
- **禁止**把 `references/` 仓库规范文档、`SKILL.md` 或 `.fbs/` 内部台账当作最终结果展示入口。

---

## 三、静默心跳与长任务可见性

**关联**：[`SKILL.md`](../../SKILL.md)「执行约定」、`section-6-tech.md` §6.5

| 心跳类型 | 间隔 | 说明 |
|----------|------|------|
| **对话级** | 约 15s | 单次工具调用或连续静默预计 ≥30s 时，每约 15s 输出一行可读进度 |
| **成员巡检级** | ≤60s | 多成员并行时，`.fbs/member-heartbeats.json` 中 `lastHeartbeat` 建议 ≤60s 更新 |

**心跳升级阈值**（`.fbs/member-heartbeats.json` 字段 `lastHeartbeat` 间隔超过以下值时触发对应动作）：

| 超时阈值 | 动作 |
|----------|------|
| **≤30s** | 正常；无动作 |
| **> 2m** | team-lead 发出「状态确认」提示 |
| **> 5m** | team-lead 标记该 Writer 为「疑似挂起」，暂停依赖派发 |
| **> 10m** | team-lead 向该 Writer 发送 `shutdown_request`，准备改派；记录异常到运行日志（见 `section-6-tech.md §6.4.1`） |
| **> 15m** | team-lead 标记该 Writer 为 CRITICAL，停止等待，立即改派；将任务写入 `.fbs/task-queue.json`，`shutdown_request` 后 30s 仍无响应则强制终止 |
| **> 30s（对话级）** | 输出可读进度（与「对话级」一致，避免用户误判为失败） |

> **勿混淆**：`15000ms` 多为页面拉取超时（`searchAccessPolicy.singlePageTimeoutMs`）；**15s** 为对用户可见进度，二者不同指标。

宿主若仅展示「失败 unknown」，以 **磁盘文件** 与 `verify-expected-artifacts.mjs` 为准，见 SKILL「宿主误报失败与磁盘真值」。

---

## 四、Team 模式输出路径与审计运行治理（Skill 2.0.1）

> 入口导航：[`SKILL.md`](../../SKILL.md) · [`multi-agent-horizontal-sync.md`](./multi-agent-horizontal-sync.md)
> **补充说明**：WorkBuddy / CodeBuddy 的 Team 模式原生支持并行；这里的路径策略、超时与隔离治理，目标是保证并行可控和可恢复，而不是把 Team 降级为串行单智能体。

### 4.1 路径策略


| 模式 | 写入约束 | 典型用途 |
|------|----------|----------|
| `isArtifact=true` | 仅允许 `brain/<conversation-id>/` | 过程性/临时性产物 |
| `isArtifact=false` | 允许 workspace（如 `.fbs/`、`meta/`） | 项目交付物归档 |

**强制前置校验**：
1. 校验目标路径与模式是否匹配。  
2. 校验 `conversation-id` 是否存在（artifact 模式）。  
3. 校验失败时必须返回：失败原因 + 正确路径 + 修复建议。

### 4.2 审计任务执行治理

- 每个 agent 必填：`timeout`、`maxRetries`、`deliverable`。
- 超时后必须返回 `partial` 结果，不允许静默挂起。
- 标准状态：`running / timeout / failed / completed`。
- `shutdown_request` 发出后 30s 无响应，执行强制终止并记录日志。

### 4.3 运行归档与保留策略

- 每次运行产物目录：`.fbs/audit-runs/{runId}/`。
- 运行索引：`.fbs/audit-runs/index.json`。
- 默认保留 30 天，超期自动清理。
- 审计报告归档优先目录：`.fbs/`（项目内可追溯）。

### 4.4 一次性全面落地验收（7项）

| 改进项 | 验收点 | 通过标准 |
|--------|--------|----------|
| 只读并行 + 写入隔离 | 任务类型声明覆盖率 | 100% 任务有 `type`，且 `write` 有隔离路径 |
| 结构化模板 | 字段完整率 | `id/type/scope/excludes/deliverable/timeout/maxRetries` 全齐 |
| 结构快照缓存 | 启动阶段耗时 | 所有 agent 首轮不再全盘扫描 |
| 超时重试保底 | 超时交付率 | 超时任务 100% 产出 `partial` |
| shutdown 标准化 | 协议一致率 | 100% 使用统一状态流与字段 |
| 生命周期治理 | 历史清理率 | 超期目录按 30 天策略清理 |
| artifact 透明化 | 首次写入成功率 | 100% 首次即命中合法路径 |

### 4.6 角色权限边界（写作成员禁止事项）

> 与 [`workbuddy-agent-briefings.md`](../01-core/workbuddy-agent-briefings.md) §协同角色 保持一致

**Writer 成员（非 team-lead）禁止以下操作**：

| 禁止操作 | 说明 | 正确处理 |
|----------|------|----------|
| 自行修改 `GLOSSARY.md` / `.fbs/GLOSSARY.md` | GLOSSARY 由术语联络员（Glossary liaison）统一维护 | 通过 `send_message` 提请 team-lead 或术语联络员处理 |
| 自行修改 `chapter-status.md` / `.fbs/chapter-status.md` | 章节状态台账由 team-lead 统一维护，防止并发写入冲突 | 向 team-lead 汇报章节完成状态，由 team-lead 更新 |
| 跨项目访问他书根目录 | `dataIsolation.crossProjectAccess = false`，见 `security-fence.mjs` | 仅操作当前 `--book-root` 指定目录 |

**违规后果**：team-lead 发现违规后须立即回滚对应文件并记录异常至运行日志（`.fbs/audit-runs/`）。





1. **P0**：路径不合法 / 无 `partial` / 无超时控制 → 立即阻断发布。  
2. **P1**：任务重叠未处理 / shutdown 字段不完整 → 限期修复再运行。  
3. **P2**：索引未更新 / 保留策略延迟执行 → 进入治理待办。




