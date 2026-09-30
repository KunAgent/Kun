# Agent 安装与 Paseo 对照

## 源码调研

参考 `getpaseo/paseo` 的 `4417d7c`，2026-09-30 按需检出源码。

| 参考代码 | 实际行为 | Kun 的应用方式 |
| --- | --- | --- |
| `packages/app/src/data/acp-provider-catalog.ts` | 目录记录名称、图标、安装链接、启动 argv、环境和参数；部分条目使用带固定版本的 `npx -y` | 接入目录和安装方式必须区分；沿用 Kun 内建 harness 定义，不把可见条目当成已经安装 |
| `packages/app/src/hooks/use-acp-provider-catalog.ts` | 添加条目生成 `extends: acp` 的 provider 配置补丁 | Kun 自定义 ACP 继续使用已有 command/args/env 配置，不引入第二套运行时 |
| `packages/server/src/server/agent/provider-launch-config.ts` | 明确区分默认命令、追加参数和覆盖 argv，检测与启动共用解析 | 安装后复检有效命令；保留用户显式路径；扩展新装 CLI 的查找路径 |
| `packages/server/src/executable-resolution/executable-resolution.ts` | 枚举命令候选、探测可执行性，区分无法执行与探测错误 | 不把握手失败笼统归为未安装；Windows 检测复用实际启动的后缀和 Path 解析 |
| `public-docs/providers.md` / `troubleshooting.md` | 基础 CLI 仍需安装；桌面环境 PATH 缺失会造成误判 | 明确显示未安装、未登录、握手失败；点击安装后自动检查，避免要求重启才能找到常见用户目录 |

Paseo 的“添加配置”不意味着替用户完成账号登录。Kun 本轮的一键安装执行与进度卡片是自身实现，
不是声称 Paseo 对每个 Agent 都提供同样的后台安装能力。

## 用户交互

入口保持在“设置 → 助手 → Agent 接入”，以及“添加 Agent”的连接步骤中。
未安装的 Agent 展示“一键安装”；适配器缺失时展示“一键安装适配器”。
点击后留在原卡片，显示安装、结果检查、成功、失败或取消；命令和有限长度日志折叠展示。
失败可重试，运行时可取消；切换卡片再回来会读取当前安装任务，不重复启动安装。

成功表示命令检测已确认安装和最低版本要求，不代表已登录或真实模型请求成功。
随后继续展示对应的登录、供应商配置或连接检查操作。保留手动命令、文档和指定路径入口。
侧栏使用具体原因，避免所有问题都显示为“需要配置”。
同时修复旧主操作按钮的无效 `bg-ds-accent` 类：该类导致白色文字配透明背景，按钮看起来消失。
主要操作改用已有 `bg-accent` 主题色，并在桌面验证中检查实际计算出的背景颜色。

## 安装策略

- 由 Kun runtime 根据宿主平台和可用前置工具选择仓库维护的内建安装命令，Renderer 不提交 shell 内容。
- Devin macOS 优先 Homebrew，未安装 Homebrew 时可选官方 shell 安装脚本；Linux/Windows 使用对应官方方式。
- Antigravity 原先“没有独立安装器”的描述已经过时，现使用官方 `agy` CLI 安装脚本，Unix 下保留用户已有别名，并允许官方脚本注册后续终端登录所需的 PATH。
- Codex、Claude Code、Gemini CLI、OpenCode 以及已启用的 Pi 复用各自已有安装元数据。
  Kun 和仅需供应商配置的 SDK 接入不要求额外装 CLI。
- 安装前检查 bash/PowerShell、npm、brew、curl 等必要命令；缺失时说明具体依赖，不运行注定失败的命令。
- 查找命令时保留已有 PATH 优先级，补充常见用户安装目录与 Homebrew 目录；实际 Agent 启动采用相同环境。
- 安装网络在 Main 按已知官方目的地址解析系统代理，以临时策略进入 runtime；显式代理环境优先。
  不同目的地需要不同代理且无法表示时报告原因，不偷偷选一个代理。

官方安装资料（本轮核对）：

- [Devin CLI](https://docs.devin.ai/cli)
- [Antigravity CLI 安装与认证](https://www.antigravity.google/docs/cli/install/)
- [Paseo 配置参考](https://github.com/getpaseo/paseo/blob/4417d7c/public-docs/custom-providers.md)

## 执行边界

`GET /v1/harnesses/:id/install` 读取计划和状态，`POST` 显式启动；
`POST /v1/harnesses/:id/install/cancel` 按任务 ID 取消。请求必须通过现有宿主认证和 IPC 路径白名单，
禁止自定义 Agent 借此提交任意命令。安装任务按 Agent 去重，日志保留末尾 32,768 字符 并脱敏，
十分钟超时；子进程使用 owned-process 生命周期，应用关闭后由宿主回收。
成功必须重新检测有效命令，不把安装器的退出码 0 当成完整接入成功。

运行时重启不会续跑旧安装任务；再次进入页面读取当前 CLI 状态。取消可能留下安装器已写入的部分文件，
不自动卸载或回滚用户已有安装。当前实现不自动执行登录、真实付费模型请求或任意第三方目录安装器。

## 验证入口

- `kun/src/harness/harness-installer.test.ts`：平台选择、依赖缺失、去重、取消竞争、失败重试、限时、脱敏和安装复检。
- `kun/src/server/routes/harness-install.test.ts`：鉴权及不受支持的请求拒绝。
- `AgentInstallControl.test.ts` 与 IPC/卡片测试：点击才启动、状态轮询、完成刷新、静态状态停止轮询和依赖提示。
- `node scripts/smoke-development-ade.cjs --compiled-renderer --install-only --locale zh --scale 2`：
  隔离 Electron、Main、Kun、真实安装子进程与 ACP 握手，使用离线临时文件模拟安装，不安装用户全局软件。

跨平台命令选择有测试，但 Windows 原生 Job 和 Linux 桌面实机安装不在本次 macOS 验证范围内。
