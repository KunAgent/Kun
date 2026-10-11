# 代理运行时说明

Kun 桌面应用当前只有一个可运行的本地 Agent 运行时：仓库自带的同名 **Kun** 运行时。

不要新增第二套运行时、运行时切换器、运行时诊断面板，或旧的 CodeWhale / Reasonix 进程路径。Code（含 Design 任务）、Work、连接手机都统一走同一个 Kun HTTP/SSE 边界。连接手机在代码内部仍沿用 `claw` 命名，Work 内部仍沿用 `write` 命名，作为兼容标识。

## 允许的扩展路径

1. 在 `kun/src/contracts/` 中新增协议字段。
2. 在 `kun/src/loop/`、`kun/src/services/` 或 `kun/src/ports/` / `kun/src/adapters/` 下新增端口与适配器来实现新行为。
3. 在 `kun/src/server/routes/` 下新增 HTTP 接口。
4. 在 `src/renderer/src/agent/kun-runtime.ts` 与 `src/renderer/src/agent/kun-mapper.ts` 中完成端点与事件映射。
5. 仅在 `agents.kun` 下新增设置项。
6. 新的 agent 引擎以 harness 定义（`kun/src/harness/`）的形式加入，必要时再加一个
   `DelegatedTurnRuntime` 实现。优先使用通用 ACP 运行时；只有 ACP 提供不了的能力
   才需要专用适配器。

## 提示词管理的计划 Worktree 边界

- `agents.kun.lab.planWorktree.enabled` 是默认关闭的实验开关，仅适用于 Direct 计划构建；
  Graph 保持当前工作区流程和自身节点隔离。
- Renderer 点击执行时先保存计划，再用通用 Git 分支 API 读取精确仓库根、本地当前分支和
  脏文件数。非 Git、Git 不可用或 detached HEAD 会阻止发送，脏工作区不会被阻止。
- 应用只把固定 Git 生命周期协议和权威计划快照注入当前任务的下一条 user input，不创建
  或切换任务、不改变 workspace、不关闭计划面板，也不持久化或监听宿主运行记录。
- Agent 从目标分支的已提交 HEAD 创建唯一临时分支和 worktree，在其中实现、测试、提交、
  必要时 rebase，并只用 `merge --ff-only` 合入。源 checkout 的未提交修改不进入基线，
  且不得被 stash、reset、clean、切换或提交。
- 只有证明临时提交已包含在目标分支后才能非强制清理。测试失败、冲突无法可靠解决或合入
  受阻时必须保留 worktree 和分支并报告恢复信息。
- 动态分支、路径、标题、脏文件数和 Markdown 经过结构化编码后只进入 user input；
  Code / Design 切换也不得改变 immutable system prefix。
- 旧 `planBuildRunId` 等字段仅作历史解析，不再触发恢复、输入冻结、workspace 重绑或特殊展示。

## 禁止路径

- 不要新增切换宿主运行时的 `AgentSwitcher`。为线程或回合选择 **harness**
  （Kun 原生、Claude Code、Codex、某个 ACP agent 等）不是切换运行时：每个
  harness 都以 `DelegatedTurnRuntime` 的身份运行在 `kun serve` 内部，GUI 仍然只
  与 `kun serve` 通信。
- 不要新增 `ConnectionStatusBar`。
- 不要新增 `RuntimeDiagnosticsDialog` 或运行时自检 UI。
- 不要恢复 CodeWhale/Reasonix 的适配器、进程管理、RPC 桥、更新器或导入器。
  外部 agent 进程只能由 `kun serve` 通过 harness 运行时（`kun/src/runtime/`）以
  受管进程启动器启动，且只能通过 Kun 的 HTTP/SSE 边界到达。GUI 主进程只有在先向
  `kun serve` 登记之后才能在 PTY 里启动终端 agent，并且只能通过 Kun 的 activity
  store 上报该 agent 的状态。
- 不要恢复独立于当前 Design 模式之外的旧绘图/绘画启动卡片。
- 不要新增打开运行时控制面板的 `/usage` 或 `/runtime` 斜杠命令。

## 旧数据兼容规则

旧的持久化 key 仅在 settings 迁移时按只读路径使用：

- `agentProvider: codewhale | reasonix | deepseek-runtime` 映射为 `kun`。
- `agents.codewhale`、`agents.reasonix` 和旧 `deepseek` 的值会一次性写入 `agents.kun`。
- 保存后的 settings 仅保留 `agents.kun`。
- 旧连接手机（内部 Claw）的 `agentThreadIds.codewhale/reasonix` 会并入 `agentThreadIds.kun`。

## 验证清单

执行：

```bash
npm run typecheck
npm test
npm run build
```

手工冒烟检查：

- Code 可以创建 Kun 会话、流式回传回复、进行工具审批/拒绝、以及中断回合。
- CodeWhale 的等价能力应保持在 Kun 下可用：会话搜索/归档筛选、fork、会话恢复、`request_user_input` 提交与取消、usage 查询。
- 缓存指标使用 DeepSeek 原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；在稳定前缀热身后，热门对话的 hit rate 应长期保持在 90% 以上。
- 不可变前缀漂移与异常的 tool-call/tool-result 历史必须在请求下发 DeepSeek 前被拦截。
- Code 可在同一会话中切换下一回合的 Code / Design 意图；Design 在共享时间线中创建、
  迭代、预览与导出设计稿。
- 开启实验后，Direct 计划构建在当前任务发送提示词 Worktree 协议，保持源目录脏文件原样，
  并在失败时保留现场；Graph 不注入该协议。
- Work 可以打开工作区、发起 inline 补全、使用选中文本助手动作。
- 连接手机可以保存设置，并通过 Kun 会话执行手工任务。
- 设置 -> Agent 仅显示 Kun。

完整方案见 [`docs/kun-architecture.md`](./kun-architecture.md)。
