# 04 harness × 模型：已实现的网关协议桥

供应商管理与 Agent 管理独立。供应商保存上游账号、端点、目录和模型权限；
Agent harness 管理程序、原生登录、会话与工具。网关是现有 Kun Runtime 的模型
传输入口，不启动第二个 Agent 循环。

完整合同见 [供应商配置与本机网关](../provider-configuration-and-gateway.md)，
独立客户端的设置见 [本机网关](../local-model-gateway.md)。

## 1. 三种选择模式

| 模式 | 模型与认证来源 | 行为 |
| --- | --- | --- |
| native-login | Agent 原生账号和目录 | 保留原生登录；不自动创建公共供应商 |
| provider | 用户选定连接、账号与模型 | 注入受限网关 grant；上游秘密保留在 Kun |
| kun-gateway | 已批准账号集合中的公共 route alias | 冻结本回合可达目标；主、小模型按 harness 支持设置 |

一个网关绑定使用结构化 `gatewayBinding`：主模型保存 `routeId` 和明确批准的
`allowedConnectionIds`，可选小模型也有自己的集合。它不是伪造的 HTTP 供应商。
界面显示网关来源，不把 Agent 的原生登录状态改成已登录。

直接 provider 模式继续保留 `kun/<providerId>/<model>` 内部寻址。该寻址只给
匹配的 harness grant 使用，公共客户端 Key 不能访问它。公共 Key 使用 alias
或用户明确允许的直接导出模型。

## 2. 回合授权与会话

`HarnessTokenService` 签发内存中的短期 `kgw_` grant。服务端绑定 harness、
credential identity、thread/turn 与用途；客户端自报 thread/session 字符串不
授予线程访问权，也不成为可信费用归属。

Alias grant 保存 role、routeId、alias 及冻结的具体账号/模型集合。每次解析取
当前可导出目标与原批准集合的交集。路由新增账号不会扩大存活 grant；下一
回合可以按更新后的明确批准配置重新生成 grant。更换范围会获得不同 grant。

已运行回合保留原 binding。切换原生账号、具体供应商或 alias 按下一回合的
既有 session 切换规则执行，不假设不同引擎的 session 可以移植。恢复回合的
目标集合不能扩大，已经撤回的目标不能通过旧环境变量重新获得权限。

主模型和小模型都必须落在批准范围。Claude 可配置独立小模型；没有独立配置
时明确复用主模型。未声明小模型协议的 harness 不提供虚假的独立选择。

首次确定实际上游时，服务端在暴露工具事件之前持久化 acting route。自动审批
审查等待这个具体来源，并复用其账号准入与配置 fence；不能落到默认供应商。

## 3. 模型协议和范围

已实现的入口：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`，返回估计而非供应商账单

入站协议转换为同一 `ModelRequest`，交给 Runtime 的共享模型路由。出站 SSE
保留文本、工具参数、工具历史、终止原因及协议用量结构。串行工具约束被
传给上游；违反约束而产生第二个调用时拒绝响应。

网关不执行客户端工具。Kun tool bridge 的授权与模型 grant 分开；模型权限
不意味着允许调用 Kun 工具。工具参数开始输出后，自动回退停止，避免把已
输出的调用在另一家重放。

模型兼容性仍由 adapter 与目标能力决定。Responses provider-managed state、
加密 reasoning、grammar/custom tools 等无法保真的语义明确拒绝。未实现的
Gemini-native、嵌套路由及媒体导出留到独立 P5 change。

## 4. 凭据与隔离配置

子进程只获得 loopback endpoint 与受限网关 token，不获得上游 Key。

| 客户端 | 生成器与认证引用 | 已验证版本 |
| --- | --- | --- |
| Codex | `CODEX_HOME/config.toml`，`env_key`，Responses | 0.160.0 |
| Claude Code | session 环境，`ANTHROPIC_AUTH_TOKEN`，Messages | 2.1.220 |
| OpenCode | `OPENCODE_CONFIG`，`{env:NAME}`，Chat Completions | 1.1.47 |
| Pi | `PI_CODING_AGENT_DIR/models.json`，裸环境变量名，Chat Completions | 0.73.1 |

生成器位于 `kun/src/harness/gateway-config-templates.ts`，托管进程与独立客户端
设置共用。Pi 不展开 `${NAME}`；它查找 `process.env[apiKey]`，因此必须写裸
变量名。Codex 0.160 不再使用 `preferred_auth_method`，生成器仅使用 `env_key`。

独立客户端设置预览不含秘密；文件写入只操作所选项目的 `.kun-gateway` 所有权
范围。已有不属于 Kun 的文件、过期预览、符号链接或外部编辑会拒绝覆盖。
恢复也验证当前摘要，并保留用户后续编辑。配置应用不安装或自动启动 Agent。

Claude 兼容环境关闭不支持的 thinking/自动 effort。原生登录路径保持自己的
行为，网关设置不读取或覆盖用户全局登录文件。

## 5. 调度、费用与退出

原生调用、Main 文本工具、公网格式入口和受管 harness 共用账号调度。并发、
有界队列和取消覆盖同一账号的所有调用方。物理上游尝试共享四次尝试上限和
120 秒默认 deadline，队列等待与重试也消耗 deadline。

用量记录实际账号/模型和每次已知 attempt 的消耗，包含被放弃的回退目标。
Response tokens 与计费用量合计分开，避免把多次重试误认为更大的上下文。
缺失 usage 保留未知；发送后的预算预留跨重启保留，不能按零消耗释放。

Runtime admin token、公共客户端 Key 和 harness grant 分开。网关 token 请求
配置、安装、线程或工具管理接口会被拒绝。默认没有 browser CORS 放行。
网关启用要求 loopback host；LAN 不属于当前发布能力。

GUI 退出会关闭它拥有的 Runtime 和 Manager；网关随之退出。重开恢复持久
配置、Key 和预算，harness 内存 grant 重新生成。Manager 失联由应用所有者
协调旧消费者退出和新 generation，Runtime 不自行接管 Manager。

## 6. 验证证据

`scripts/smoke-model-gateway-clients.mjs` 从当前源码或指定 packaged resources
加载真实网关 handler，再使用四个固定版本的真实 CLI 调用 fake upstream。
profile、工作目录、账号环境和代理均隔离；真实供应商请求不参与验收。

四个客户端都验证文本流、实际只读工具执行后的第二回合、取消传播至上游。
Claude 还分别验证 main/small alias；OpenCode 明确复用 main 为 small，Codex/Pi
无独立 small 协议。主/小授权、冻结 scope、session 恢复和工具 grant 分离另有
Runtime fixtures。以上证据只适用于固定版本及声明组合，不证明未来全部版本。

协议 fixtures 见 `gateway-protocol-conformance.test.ts`；范围与恢复见
`gateway-alias-binding.test.ts`、`gateway-alias-env.test.ts`；真实 HTTP loopback/
CORS/admin 隔离见 `provider-gateway-release-boundary.test.ts`。完整发布证据见
[供应商发布验收](../provider-gateway-release-validation.md)。
