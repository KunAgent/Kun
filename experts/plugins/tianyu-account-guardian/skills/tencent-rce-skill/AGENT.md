# 腾讯云风险识别 RCE Skill — AI Agent 执行手册（路由壳）

> 本文件为 AI Agent 内部执行手册的**路由入口**，只负责按操作系统分流。
> 终端用户阅读外层 `SKILL.md` 即可，无需关注本文件。
>
> ⚠️ **执行前必须先识别用户当前操作系统**，并按下表加载对应文件作为本 Skill 的真正执行手册。**只读其一，不要把两个文件都跑一遍。**

| 操作系统 | 应加载的文件 | 说明 |
| --- | --- | --- |
| macOS / Linux（bash / zsh） | [`AGENT_unix.md`](./AGENT_unix.md) | 使用 POSIX 前缀内联 `AUTH_CONFIG='{...}' amccli ...`、`curl` + `chmod` 安装 amccli、`\` 续行 |
| Windows（PowerShell） | [`AGENT_windows.md`](./AGENT_windows.md) | 使用 `$env:AUTH_CONFIG='...'` 设置环境变量、`Invoke-WebRequest` 安装 amccli.exe、反引号 `` ` `` 续行 |

## 路由判定步骤

1. 通过 shell 探测当前操作系统：
   - 已知是 PowerShell（`$PSVersionTable` 可用、提示符以 `PS` 开头、命令分隔符为 `;`）→ **Windows**
   - 已知是 bash / zsh（`uname -s` 可用）→ **macOS / Linux**
2. 按上表打开对应的 `AGENT_*.md`，**严格遵循其中的安装、调用、文档检索、传参规范**执行。
3. 两个文件的 `amccli rce <Action>` 语义、`BusinessSecurityData` 参数定义、接口说明检索流程、SOP（Step 0 授权预热 / Step 1~3）、踩坑经验**完全一致**，差别**仅在于 shell 语法、安装/更新脚本、环境变量设置方式、续行符**。
