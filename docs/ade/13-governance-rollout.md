# 13 安全、开关、红线文档、测试与分阶段验收

- 阶段：全程
- 依赖：全部

## 1. 实施顺序

```text
P0  01 harness 路由 ─┬─> 02 能力 v2 ──┐
                     │                ├─> 09 总管控制面（P1）
    06 ActivityStore ┤                │
    07 任务工作区 ────┤                │
    08 确定性交接 ────┘                │
P1  03 ACP 运行时 ──> 05 MCP server / worker 工具 ──┘
    04 网关协议桥（独立，可并行）
    10 选择与验收 ──> 11 审查（批注、合入）──> 12 Mission Control / 轨道 / 通知
P2  05 CLI 回调与托管 hooks、终端 agent；10 赛马、自动检查；11 归属、PR 与 CI；12 弹出窗口
```

每一项都能独立合入：P0 的每个模块在开关关闭时对现有行为无影响；P1 的界面在 `agents.kun.ade.enabled` 关闭时不出现。

## 2. 安全

### 2.1 权限

| 规则 | 位置 |
| --- | --- |
| worker 有效权限 = 总管快照 ∩ profile ∩ harness 档位上界，永不扩大 | 09 §7.1 |
| 升级到完全访问必须由宿主向用户发审批，取消或超时无副作用 | 09 §7.2 |
| 无人值守路径不升级；请求档位不支持时回落最严档 | 02 §4 |
| worker 的审批默认交给用户；总管代批默认关闭，且只能批不超出自身快照的请求 | 09 §6.5 |
| 外部 agent 的权限档：支持外部审批的由 Kun 档位推导；不支持的由用户选，映射取保守上界 | 01 §4 |
| ACP 权限回复永不选 `allow_always`（除非只有它） | 03 §8.3 |
| 合入用户 checkout 需要用户确认；绝不动用户未提交的改动 | 07 §8.2、11 §7.1 |

### 2.2 凭据与环境

- provider 密钥永不进入外部 harness 的进程环境；经网关的 harness 只拿到 scoped 令牌（04 §4、05 §4）。
- 所有 harness 启动都经过同一个环境剥离清单（`kun/src/harness/harness-env.ts`，03 §4.1），防止凭据优先级把订阅悄悄换成按量计费（Claude 订阅接入时踩过）。
- setup / checks 命令的环境不带任何 Kun 令牌或 provider 凭据（07 §7.2）。
- 令牌只在内存里；日志只记 grantId 前缀。

### 2.3 如实说明边界

以下内容写进设置页说明和文档，**不要夸大**：

- worktree 是隔离的工作目录，**不是安全沙箱**：agent 仍能访问它的进程能访问的文件和网络。
- 完全访问档下，外部 agent 可以读到自己进程的环境变量；Kun 不会把 provider 密钥放进去，但 harness 自己的登录凭据（例如本机 CLI 的登录文件）对它可见。
- 路径与命令的文本拦截只是纵深防御，不是隔离边界。真正的强隔离需要操作系统级沙箱，本计划不包含（§8 待定）。
- 终端 agent 的状态来自 hooks，精度取决于 CLI；取消是推断的（05 §6.3）。

### 2.4 第三方二进制

- 检测到的 CLI 以用户权限运行；Kun 只调用用户已安装的程序或随包附带、版本固定的程序。
- 自定义 ACP agent 只能由用户在设置页显式添加（命令路径 + 参数），不从项目文件自动读取启动命令（避免仓库里的配置在用户不知情时启动任意程序）。
- 订阅类 harness 显示现有的"个人自用"说明横幅（Claude 订阅已有）。

## 3. 开关与配置

### 3.1 GUI 设置：`agents.kun.ade`

```ts
export type KunAdeSettingsV1 = {
  enabled: boolean                          // 总开关；P1 期间在"实验室"里，默认 false
  harnessRouter: boolean                    // 01 的新路由；默认 true，异常时可关闭回到旧的 provider 推断（一个版本周期后删除）
  deterministicHandoff: boolean             // 08；默认 true，关闭回到 48 KiB transcript
  managerModel?: { providerId: string; model: string }
  managerMayApprove: boolean                // 默认 false
  allowUnattendedFullAccess: boolean        // 默认 false
  limits: { softWorkers: number; hardWorkers: number }        // 4 / 8
  budget?: { softTokens?: number; hardTokens?: number }
  hibernation: { enabled: boolean; idleMinutes: number }      // true / 30
  stall: { structuredMinutes: number; terminalMinutes: number } // 10 / 20
  notifications: { waiting: boolean; failed: boolean; done: boolean; stalled: boolean; sound: boolean; keepAwake: boolean }
}
```

同步链路（每一层都要改，漏一层就会静默丢字段）：

1. `src/shared/app-settings-types-kun-runtime.ts` 类型 + `app-settings-kun.ts` 规范化（未知字段丢弃、数值夹紧）。
2. `src/main/ipc/app-ipc-schemas/settings-model.ts` 的 `kunRuntimePatchSchema`（`.strict()`）加 `ade`、`harnesses`。
3. `src/main/runtime/kun-runtime-model-config.ts` 生成 config.json 的 `ade` 段（纯函数、稳定排序）。
4. `kun/src/config/kun-config-application.ts` 的 `KunConfigSchema` 加 `ade: AdeConfigSchema.optional()`（`.strict()`）。
5. `src/main/runtime/kun-runtime-config-service.ts` 的 `sanitizeKunConfigSections` 登记 `ade`、`harnesses`。
6. 测试：同一份设置两次生成的 config 逐字节相同（防重启死循环）；带新字段的 patch 通过 strict 校验。

### 3.2 运行时读取

kun 侧所有开关通过 `core.activeOptions` 读取，支持热更新；已接纳的 turn 冻结自己的开关值（与现有 turn 冻结语义一致）。

## 4. 红线文档的修改

以下修改与 P0 的第一个 PR 一起提交，否则后续 review 会把 ADE 的代码判定为违规。

### 4.1 `docs/AGENTS.md` → Forbidden Paths

现文：

> - No `AgentSwitcher`.
> - No CodeWhale/Reasonix adapter, process manager, RPC bridge, updater, or importer.

改为（保留原有禁令，补充允许的路径）：

```markdown
- No `AgentSwitcher` that switches the host runtime. Choosing a **harness** for a
  thread or turn (Kun native, Claude Code, Codex, an ACP agent, ...) is not a
  runtime switch: every harness runs inside `kun serve` as a `DelegatedTurnRuntime`,
  and the GUI still talks only to `kun serve`.
- No CodeWhale/Reasonix adapter, process manager, RPC bridge, updater, or importer.
  External agent processes may only be started by `kun serve` through the harness
  runtimes (`kun/src/runtime/`), using the owned-process launcher, and must be
  reachable only through Kun's HTTP/SSE boundary. The GUI main process may start a
  terminal agent in a PTY only after registering it with `kun serve`, and it must
  report that agent's state only through Kun's activity store.
```

### 4.2 `docs/AGENTS.md` → Allowed Extension Path

追加一条：

```markdown
6. New agent engines are added as harness definitions (`kun/src/harness/`) plus, when
   needed, a `DelegatedTurnRuntime` implementation. Prefer the generic ACP runtime;
   a dedicated adapter needs a capability that ACP cannot provide.
```

### 4.3 `docs/kun-architecture.md`

- "GUI 要拆的东西"中"Agent 切换器：`AgentSwitcher` 不再出现，`AGENT_CATALOG` 只有 `kun`"改为："不恢复切换运行时的 Agent 切换器；harness 选择器选择的是 turn 引擎（见 `docs/ade/01-harness-routing.md`）"。
- "Settings -> Agents 直接展示 Kun 配置"补充："Agents 分组可列出 harness（检测、登录、默认权限），它们都在 Kun 运行时内执行"。
- 新增一节"ADE：总管与 worker"，只放不变量摘要，链接到 `docs/ade/README.md`。

### 4.4 根目录 `AGENTS.md`

"Do not recreate old runtime paths, provider switchers, ... process managers, or RPC bridges" 后补一句："External agent harnesses are the documented exception and must follow `docs/ade/`."

## 5. 测试策略

| 层 | 内容 |
| --- | --- |
| 单元 | 各章节测试表 |
| 集成 | 假 ACP agent（03 §12）驱动完整的一轮；假 worker 驱动总管的派活、完成、唤醒、提问全流程 |
| 契约固定 | 每个随包或推荐版本的 harness，录制一份真实会话的事件流作为夹具（先脱敏：去掉账号、路径中的用户名、令牌），映射器测试基于夹具；升级 harness 版本时重录 |
| 真实二进制冒烟（夜间或发布前手动） | Claude Code（订阅 + 网关）、Gemini CLI、Codex（ACP adapter）、OpenCode：一轮对话、一次工具审批、一次文件修改、一次中断、一次恢复 |
| 性能 | ActivityStore 热路径（06 §11）；ACP 映射器每秒 500 条 update 不阻塞事件循环（现有 event-loop-monitor 断言） |
| 跨平台 | Windows CI：worktree 创建、setup 的 `.cmd` 命令、路径；Linux：进程组回收 |
| 回归 | 现有 Claude SDK / Cursor / Antigravity / Graph / 子代理测试全部通过 |
| 仓库门禁 | 新文件 ≤ 700 行（`npm run check:file-lines`）；`npm run typecheck`、`npm test`、`npm run build`、`npm run build:kun` |

## 6. 指标门禁

凡是改动触及 prompt 组装、工具暴露、事件翻译、模型映射、用量计量的 PR，说明里必须写：

1. 可能影响哪些指标：缓存命中率、响应速度、结果准确性。
2. 怎么测的：改动前后同一组任务的对比（缓存命中用 Kun 现有的 provider 原生命中统计；速度用 turn 耗时与首字延迟；准确性用事件流抽查）。
3. 结论。

ADE 专属的不变量：

- 稳定前缀（`kun/src/prompt/kun-system-prompt.ts`）**不因 ADE 改变**。总管工具说明是工具 schema 的一部分（按规则排序）；harness 列表、worker 通知、交接简报、派活模板全部在每轮动态上下文或工具结果里。
- 开关切换不能改变稳定前缀或工具集合的顺序（工具集合的增减遵守现有"只追加"的缓存规则）。
- 事件翻译不能丢事件、错序、错配类型（03 §7 的测试守护）。

## 7. 待定决策

| 决策 | 默认 | 说明 |
| --- | --- | --- |
| agent 是否活过应用重启 | **否** | 参考项目用常驻 PTY 守护进程；Kun 现行规则是关窗即退出并回收所有受管进程。本计划用"可恢复"替代"常驻"：worker 与终端 agent 在下次启动时按原生会话恢复（06 §7.2）。若要改，需要修改 `docs/AGENTS.md` 的进程生命周期章节并单独评审 |
| Codex 深度适配 | P2 评估 | ACP adapter 先行；若需要 Codex 特有能力（如更丰富的审批与沙箱控制），再评估其 app-server 协议 |
| 远程主机上的 worker | 不做 | 现有手机远程只是控制端；在 SSH 主机上跑 worker 需要远端运行时，另立计划 |
| 外部 agent 当总管 | 不做 | 与差异化方向相反 |
| 操作系统级沙箱 | 不做 | 单独立项；在此之前如实说明边界（§2.3） |
| Mission Control 弹出窗口 | P2 | 需要确认多窗口下的退出屏障与焦点规则 |

## 8. 分阶段验收清单

### P0

1. 现有线程（Claude 订阅、Cursor、Antigravity、普通 provider）行为不变；`harnessRouter` 开关关闭能回到旧路径。
2. 新线程显式选择 harness，turn 走对应运行时；缺少运行时或未登录时以可读错误失败。
3. 前端置灰原因来自能力声明；Rooms 准入由统一函数判定，结果与现有规则一致。
4. ActivityStore：普通会话的运行、等待审批、完成在侧栏与手机端显示一致；在桌面忽略后手机端同步消失。
5. 任务工作区：从默认分支创建 worktree，共享 `node_modules`、复制 `.env`，setup 未批准时跳过并提示；采集结果与 `git diff` 一致；合入不改动用户未提交的文件。
6. 确定性交接：Kun 原生 → Claude Code 切换时注入简报；切回时恢复原会话；简报相同输入输出相同。
7. 权限：请求高于总管的档位被降级并如实报告；升级需要用户确认。

### P1

1. 一个 Code 线程跑在 Gemini CLI（ACP）上：流式文本、工具调用、审批、文件修改进入审查面板、中断、恢复都正常。
2. Claude Code 以 DeepSeek 模型运行（网关），用量记在该线程上。
3. 总管一次派出 3 个 worker（3 种 harness），各自 worktree；看板实时更新；完成后总管被唤醒一次并汇总；汇总中写明每项由哪个 agent 完成、验收结论。
4. worker 提问 → 总管回答 / 升级到用户 → worker 继续。
5. 审查面板发送 5 条批注给 worker，worker 修改后批注重新定位，未解决的进入下一批。
6. 额度 ≥ 95% 的订阅不被自动选中，理由出现在汇报里。
7. 通知：worker 等待、失败、完成时收到桌面通知，Dock 角标正确。

### P2

1. 终端 agent：在 worktree 里以终端方式运行 Claude Code，hooks 驱动状态，`kun worker ask` 能和总管往返。
2. 同题赛马：三个 agent 同起点，比较视图可选胜者并丢弃其余。
3. AI 行归属：审查面板行号栏显示写入者；人工修改后回到人工。
4. PR：推送并创建 PR，CI 状态刷新，失败检查一键回传。
5. 外部会话接续：从本机 Claude Code 会话创建 Kun 分支并在同一 harness 继续。

## 9. 规模估计（相对值）

| 模块 | 规模 | 主要风险 |
| --- | --- | --- |
| 01 路由 | M | 旧路径兼容；子代理执行器改造 |
| 02 能力 | S | 前端改造面广但简单 |
| 03 ACP | L | 各 agent 的协议实现差异；加载阶段回放 |
| 04 网关 | M | Anthropic 事件序列细节；缓存口径 |
| 05 回调 | M（P1 部分）/ M（P2 部分） | 终端 agent 的状态精度 |
| 06 状态存储 | M | 热路径性能；重启恢复 |
| 07 工作区 | M | 跨平台；setup 信任 |
| 08 交接 | M | 停泊会话与 provider-state 目录迁移 |
| 09 总管 | L | 投递幂等、唤醒、问题流 |
| 10 选择与验收 | M | 额度数据的完整度 |
| 11 审查 | L | 批注定位、diff 渲染性能 |
| 12 UI | L | 视觉一致性、窄窗口 |
