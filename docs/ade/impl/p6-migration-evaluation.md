# P6-13 迁移评估报告：Claude Code / Cursor 是否迁入 HarnessAgent

> 结论先行：**两者都不迁**。它们不是"另一个协议适配"，而是已经把 SDK 深耦合能力
> 用满的成熟 DelegatedTurnRuntime；迁到 `HarnessAgent`/`SessionTurnRuntime` 只能拿到
> 统一的会话管理外壳，却要把已经在线工作的深集成退回成通用协议层，收益为负。

## 1. 评估对象

| harness | transport | 现实现 | 体量（kun/src/runtime） |
| --- | --- | --- | --- |
| Claude Code | `agent-sdk` | `agent-sdk-runtime-factory-*` 家族（~10k 行含测） | 深集成：skills、hooks、approval review、supervision、plan 工具、graph 恢复、trace |
| Cursor | `cursor-sdk` | `cursor-sdk-runtime-*` 家族（~7k 行含测） | 深集成：auth 流、handoff、plan 工具、tool bridge |
| Codex | `codex-app-server`（P6-05 新增） | `codex-*`（薄协议层） | app-server 是纯协议面，SDK 能力都在进程对面 |
| Pi | `pi-rpc`（P6-09 新增） | `pi-*`（薄协议层 + bridge 扩展） | 同上 |

关键区别：Codex/Pi 的"runtime"在远端进程里，Kun 侧只是一层传输+事件映射，
`HarnessAgent` 抽象天然贴合。Claude/Cursor 的 Kun 侧 runtime 才是实现本体，
SDK 提供的是库级 API（query/options/hook 回调），不是会话协议。

## 2. 逐条评估

### 2.1 Claude Code（`agent-sdk`）

**迁移可得到**

- 统一池化/断开清理路径（`HarnessPool`）。
- 统一的 `HarnessTurnSink` 审批/输入门面（形状层面，agent-sdk 已自带等价物）。

**迁移会失去/要重建**

- `sdk-options-builder`/`sdk-tool-bridge`/`sdk-context-assembler` 等一批对
  Claude SDK `query()` 参数面的深度封装（permission mode hooks、canUseTool
  回调、MCP 注入、skill 目录装配、approval review 模型调用）。
- supervision/plan/graph 恢复这些 Kun 特有编排——它们不走"协议事件"，
  `HarnessTurnSink` 的事件面覆盖不了。
- ~10k 行实现 + 同等量级测试的全部回归风险。

**判定**：不迁。agent-sdk 的收益点（统一池/统一门）可以通过共享小件
（harness-process、approval gate 类型）按需抽取，不值得整体重写。

### 2.2 Cursor（`cursor-sdk`）

同上，且更弱：cursor runtime 的 streaming-auth/handoff 与 Kun 的
session-binding 已经互相咬合，迁到 HarnessAgent 需要先把 session 绑定协议
化，工程量大于 codex/pi 两个适配器之和。

**判定**：不迁。

### 2.3 Gemini / OpenCode / 自定义 ACP

维持 03 号文档的判定：ACP 是面向这类 agent 的标准协议，`AcpRuntime` 已经
跑在共享 `session/` 层之上，无需再包一层 `HarnessAgent`。

### 2.4 何时重估

- 上游把 Claude Code / Cursor 的"agent loop"搬出 SDK 成独立进程协议
  （像 codex app-server 那样）时，按 P6-07 的 transport variant 机制新增
  薄适配器即可，无需动现有 runtime。
- 若 `SessionTurnRuntime` 的池/门/会话绑定出现 Claude/Cursor 也急需的能力，
  把该能力下沉到共享小件，而不是反过来重写 deep runtime。

## 3. 遗留清理

| 项 | 状态 |
| --- | --- |
| `@zed-industries/codex-acp` → `@agentclientprotocol/codex-acp` | 依赖已迁；残留引用在检测命令兜底名，保持兼容不必清理 |
| ACP codex 回退期 | `transportOverrides.codex='acp'` 为显式回退开关；P6-12 矩阵全绿后再议移除，否则长期保留 |
| pi 默认可见性 | `prerelease` + `harnesses.experimentalIds` 门控；P6-12 通过后摘掉标记 |

## 4. 对准入清单的回写

原生 `HarnessAgent` 适配器的准入条件（回写 13 号文档）：

1. 上游必须是**进程级协议**（stdio JSON-RPC/JSONL），不是库级 SDK。
2. 协议必须能表达 Kun 需要的会话生命周期（起会话/收事件/审批应答/中断），
   缺的部分必须由该 harness 的官方扩展机制补齐（pi 用 extension，codex 用
   app-server 原生 approval request）。
3. 池化边界必须声明（`poolScope`）；进程绑死 cwd 的必须 workspace 级。
4. 凭据只能走 credentialEnv + 生成的 0600 配置；密钥永不落盘成明文。
5. 能力声明以实机验收矩阵为准，不声称未验证的能力。
