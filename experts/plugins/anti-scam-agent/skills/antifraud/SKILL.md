---
name: antifraud
description: 专注电信网络诈骗、黑灰产、涉诈风险情报、银行卡风险、受害者预警、监控告警与报告生成等领域。通过 amcpcli 二进制对接 MCP 服务，自动完成 Agent 鉴权、会话管理、工具调用全流程，同时支持重置本地登录态、清除当前 Agent 身份缓存。
---

# antifraud能力说明

> ⚠️ **执行前必须先识别用户当前操作系统**，并按下表加载对应文件作为本 Skill 的真正执行说明。**只读其一，不要把两个文件都跑一遍。**

| 操作系统 | 应加载的文件 | 说明 |
| --- | --- | --- |
| macOS / Linux（bash / zsh） | [`SKILL_unix.md`](./SKILL_unix.md) | 使用 POSIX 前缀内联环境变量、`curl` + `chmod` 安装 amcpcli |
| Windows（PowerShell） | [`SKILL_windows.md`](./SKILL_windows.md) | 使用 `$env:KEY=...` 设置环境变量、`Invoke-WebRequest` 安装 amcpcli.exe |

## 路由判定步骤
1. 通过 shell 探测当前操作系统：
   - 已知是 PowerShell（`$PSVersionTable` 可用、提示符以 `PS` 开头、命令分隔符为 `;`）→ **Windows**
   - 已知是 bash / zsh（`uname -s` 可用）→ **macOS / Linux**
2. 按上表打开对应的 `SKILL_*.md`，**严格遵循其中的安装、调用、重置、安全规范**执行。
3. 两个文件的 MCP 调用语义、`call` 参数规则、认证流程、安全机制完全一致，差别**仅在于 shell 语法、安装脚本、环境变量设置方式**。
