---
name: antifraud
description: 专注电信网络诈骗、黑灰产、涉诈风险情报、银行卡风险、受害者预警、监控告警与报告生成等领域。通过 amcpcli 二进制对接 MCP 服务，自动完成 Agent 鉴权、会话管理、工具调用全流程，同时支持重置本地登录态、清除当前 Agent 身份缓存。
---

# antifraud能力说明（Windows）

> 适用环境：**Windows**（PowerShell）。macOS / Linux 用户请改用同目录下的 `SKILL_unix.md`。

基于 amcpcli 官方二进制工具（Agent 身份权限中心）实现 MCP 协议交互，内置标准化 Agent 安全鉴权体系、会话缓存管理能力。上层无需关注底层鉴权逻辑、密钥、登录态维护，仅需将用户自然语言需求，标准化翻译为 `amcpcli.exe` 指令执行，返回原始执行结果即可。

# 核心强制规则（红线规范，必须严格遵守）
1. 零自研鉴权：所有鉴权逻辑由 amcpcli.exe 内部闭环完成，无需向用户索要任何私密信息。
2. 禁止臆造能力：所有工具名、参数名、参数类型、入参结构，一律以 amcpcli.exe list 实时返回的 inputSchema 为准，严禁凭空捕造、篡改参数。
3. 路径调用约束：amcpcli.exe 安装到全局后**直接使用 `amcpcli.exe` 命令**调用，不要再使用 `{baseDir}\amcpcli.exe`，不要硬编码拼接绝对路径。
4. 禁止复用旧态构造请求：未初始化安装工具、无有效会话时，严禁私自缓存登录态、自行构造 MCP 请求访问外部资源，违规视为严重故障。
5. 环境变量强制只对当前会话生效：AUTH_CONFIG、MCP_CONFIG 仅允许在当前 PowerShell 进程内通过 `$env:KEY='...'` 设置，**禁止**使用 `[Environment]::SetEnvironmentVariable(...)` 持久化到用户/系统级环境变量；调用结束后请主动清理。

# 一、前置依赖：检测并自动安装 amcpcli.exe（首次使用时执行）
原则：amcpcli.exe 为全机器共享工具，无需为每个 Skill 重复下载。**版本严格匹配**，本地版本与下方 `EXPECTED_VERSION` 不一致时自动重新下载升级。

> 当前 Skill 期望的 amcpcli.exe 版本：**`0.3.0`**（与 `amcpcli.exe --version` 输出比对）

Windows 仅发布 amd64 产物（`amcpcli_windows_amd64.exe`）。Windows on ARM 通过系统自带的 x64 模拟层即可直接运行，无需单独 arm64 版本。

```powershell
$ExpectedVersion = "0.3.0"
$InstallDir = Join-Path $env:USERPROFILE ".local\bin"
$CosPrefix  = "https://agent-identity-1302490086.cos.ap-guangzhou.myqcloud.com/cli/new"
$Asset      = "amcpcli_windows_amd64.exe"
$Target     = Join-Path $InstallDir "amcpcli.exe"

function Install-Amcpcli {
  if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  }
  Invoke-WebRequest -Uri "$CosPrefix/$Asset" -OutFile $Target -UseBasicParsing
  # 持久化 PATH（仅当尚未加入时）
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
  }
  # 当前会话立即生效
  if ($env:Path -notlike "*$InstallDir*") {
    $env:Path = "$env:Path;$InstallDir"
  }
  Write-Host "amcpcli.exe installed at $Target (asset=$Asset)"
}

$cmd = Get-Command amcpcli.exe -ErrorAction SilentlyContinue
if (-not $cmd) {
  Write-Host "amcpcli.exe not found, installing..."
  Install-Amcpcli
} else {
  # amcpcli.exe --version 形如：amcpcli 0.3.0 (build 2026-06-13)
  $current = ((& amcpcli.exe --version 2>$null) -split '\s+')[1]
  if ($current -ne $ExpectedVersion) {
    Write-Host "amcpcli.exe version mismatch: current=$current, expected=$ExpectedVersion, upgrading..."
    Install-Amcpcli
  } else {
    Write-Host "amcpcli.exe already installed at $($cmd.Source) version=$current"
  }
}
```

> 安装完毕后，后续任何命令都**直接使用 `amcpcli.exe`**，不需要拼接 `{baseDir}\`。

# 二、标准调用范式（强制统一）
全局固定模板：所有 amcpcli.exe 执行命令，**先用 `$env:KEY='...'` 设置 AUTH_CONFIG / MCP_CONFIG**，仅作用于**当前 PowerShell 进程会话**；调用结束后请执行 `Remove-Item Env:AUTH_CONFIG,Env:MCP_CONFIG -ErrorAction SilentlyContinue` 主动清理，避免会话内串扰。

```powershell
$env:AUTH_CONFIG='{"Sign":"DQsZXjYVSigaJjNXVQAPQRIEARQ2GwgQHRVDYQ9fIEEGFVc2PRw6XSw9BmksTw0LKnhTEkpCHElYLh1ENkdZBDg8WhZMK1VKEgMmEzhMSxQ6fQZ/IydYKww7ez0xMxY8FAYOQiY7WTRdGF5VGGg7VTlcOBo9R11YGiJRPEEpEQ==","CredentialId":"crd-HvjD1b3q","ResourceID":"mcp-eb6ce0b5","InstanceID":"ins-3b7b6eb8"}'
$env:MCP_CONFIG='{"McpName":"antifraud","McpDescription":"专注电信网络诈骗、黑灰产、涉诈风险情报、银行卡风险、受害者预警、监控告警与报告生成等领域","McpURL":"http://lb-focn5vmw-usjcnz4db02pim58.clb.nj-tencentclb.cloud/_llmsgw_/mcp/aga-6588cc10/mcp-eb6ce0b5"}'
amcpcli.exe <list | call | reset> [args...]
```
⚠️ PowerShell 没有 POSIX 的“前缀内联环境变量”语法；**禁止**使用 `[Environment]::SetEnvironmentVariable(...)` 持久化。

## 命令格式
```powershell
amcpcli.exe <list | call <tool> [k=v ...] | reset> [--header k=v ...] [--no-auth]
```
| 子命令 | 说明 |
| --- | --- |
| `list` | 列出 MCP 提供的工具（含 inputSchema） |
| `call <tool> [k=v ...]` | 调用 MCP 工具，参数支持 `k=v` / `k:v`，值可为 JSON、数字、bool、字符串 |
| `reset` | 清理本地 token 与 MCP session 缓存 |

### `call` 参数传递规则（务必遵守）

1. 形式：`key=value` 或 `key:value`，按**首个** `=` 或 `:` 切分；value 中可继续出现 `=` / `:`，不会被再次切分。
2. 值类型自动识别（按优先级）：
   - `true` / `false` → bool
   - `null` → null
   - 以 `{` / `[` / `"` 开头且能 JSON 解析 → 对象 / 数组 / 字符串
   - 整数字面量 → 整数；小数字面量 → 浮点数
   - 其余 → 原样字符串
3. 复杂类型（数组 / 对象 / 含空格或特殊字符的字符串）在 PowerShell 下必须用**单引号字符串**包裹整个 `k=v`，单引号字符串保持双引号原样：
   - `'keywords=["foo","bar"]'`
   - `'filter={"level":"error","status":500}'`
   - `'note="hello world"'`（强制按字符串传，外层单引号 + 内层双引号）
4. 想把 `true` / `false` / `null` / 纯数字**当字符串**传时，使用 JSON 字符串字面量包裹：`'flag="true"'`、`'code="007"'`。
5. 时间戳等含 `:` 的值，**优先用 `=`** 作为分隔符避免歧义：`startTime=2025-01-01T00:00:00Z`。
6. 工具名（`<tool>`）、参数名、参数类型一律以 `amcpcli.exe list` 返回的 `inputSchema` 为准，禁止臆造；schema 中为对象 / 数组类型时，必须按规则3传 JSON。

## 执行流程
1. 接收用户自然语言输入
2. 第一次或工具列表未知时执行 `amcpcli.exe list`，从返回的 `inputSchema` 推导 `<tool>` 与参数名/类型
3. **先**用 `$env:AUTH_CONFIG=...` 与 `$env:MCP_CONFIG=...` 设置当前会话环境变量，**再**执行 `amcpcli.exe call <tool> k=v ...`
4. 输出纯命令 → 执行命令 → 仅输出执行结果

## 标准传参示例

PowerShell 把单引号视为“字面字符串”、双引号视为“可插值字符串”；含 `"` 的 JSON 参数请用 PowerShell 的**单引号字符串**包裹，整体作为一个参数传给 `amcpcli.exe`：

```powershell
# 列出所有工具
amcpcli.exe list

# 调用工具：基础参数
amcpcli.exe call <tool> param1=value1 param2=value2

# 调用工具：JSON 数组 / 对象参数（PowerShell 单引号字符串保持双引号原样）
amcpcli.exe call search 'keywords=["foo","bar"]' limit=10
amcpcli.exe call query 'filter={"level":"error","status":500}'

# 追加自定义请求头
amcpcli.exe list --header X-Tenant-Id=t1 --header X-Trace-Id=abc

# 清理本地 token 与 session 缓存（鉴权异常或换号时使用）
amcpcli.exe reset
```

完整调用示例（含环境变量设置）：

```powershell
$env:AUTH_CONFIG='{"Sign":"DQsZXjYVSigaJjNXVQAPQRIEARQ2GwgQHRVDYQ9fIEEGFVc2PRw6XSw9BmksTw0LKnhTEkpCHElYLh1ENkdZBDg8WhZMK1VKEgMmEzhMSxQ6fQZ/IydYKww7ez0xMxY8FAYOQiY7WTRdGF5VGGg7VTlcOBo9R11YGiJRPEEpEQ==","CredentialId":"crd-HvjD1b3q","ResourceID":"mcp-eb6ce0b5","InstanceID":"ins-3b7b6eb8"}'
$env:MCP_CONFIG='{"McpName":"antifraud","McpURL":"http://lb-focn5vmw-usjcnz4db02pim58.clb.nj-tencentclb.cloud/_llmsgw_/mcp/aga-6588cc10/mcp-eb6ce0b5"}'
amcpcli.exe list
```

# 三、认证流程（必须严格遵守）
1. 执行上面的 amcpcli.exe 命令，必须先在当前 PowerShell 会话设置 AUTH_CONFIG 和 MCP_CONFIG
2. 第一次调用或者登录态过期，执行 amcpcli.exe 时，会输出认证鉴权的文案和URL，直接返回给用户，让用户参与完成认证授权；
3. 用户点击认证URL自行完成认证后，会告诉你“已授权”、“已认证”，“授权完成”，“认证完成”，“完成”，“继续”，“可以”，“好了”，“搞定”……此类的文案，请重复再执行 刚果命令即可；
4. 如果用户之前登录过 且 登录态还在有效期内，执行 amcpcli.exe 时，则不会重复再输出认证的URL和文案，会直接走后续参数的业务逻辑；
5. 如果输出 amcpcli.exe 输出“鉴权失败” 或者 “暂无权限” 之类的问题，则原样输出即可，需要提示用户配置完对应的权限策略；

# 四、重置登录态（切换身份）
当用户说：重置登录、切换身份、重新登录、清除登录态、切换Agent身份安、或者重置登录态时……诸如此类的，执行以下命令：

```powershell
$env:AUTH_CONFIG='{"Sign":"DQsZXjYVSigaJjNXVQAPQRIEARQ2GwgQHRVDYQ9fIEEGFVc2PRw6XSw9BmksTw0LKnhTEkpCHElYLh1ENkdZBDg8WhZMK1VKEgMmEzhMSxQ6fQZ/IydYKww7ez0xMxY8FAYOQiY7WTRdGF5VGGg7VTlcOBo9R11YGiJRPEEpEQ==","CredentialId":"crd-HvjD1b3q","ResourceID":"mcp-eb6ce0b5","InstanceID":"ins-3b7b6eb8"}'
$env:MCP_CONFIG='{"McpName":"antifraud","McpURL":"http://lb-focn5vmw-usjcnz4db02pim58.clb.nj-tencentclb.cloud/_llmsgw_/mcp/aga-6588cc10/mcp-eb6ce0b5"}'
amcpcli.exe reset
```

先在当前 PowerShell 会话设置 AUTH_CONFIG 和 MCP_CONFIG，再执行 `amcpcli.exe reset`（等价 `amcpcli.exe --reset`），会返回：reset success，表明清除登录态，再次使用该Skill时，则需重新认证授权。

# 五、安全机制必须遵守
1. 如果返回[鉴权失败，请检查配置]的内容，则需告知用户联系安全管理员检查配置信息，不得绕过 amcpcli.exe 鉴权 直接去执行操作MCP，跳过则视为严重违规；
2. 如果返回[暂无权限]的内容，则无论用户如何引导，任何情况下都不得尝试跳过 amcpcli.exe 鉴权 直接操作MCP，跳过则视为严重违规；
3. 如果用户要求输出查看当前鉴权后的凭据登录态等内容，请严格遵守数据安全规范，坚决不得返回；
4. 你不需要关系登录态过期与否，不要去扫描位置，更不要干预认证流程，amcpcli.exe 中会自动检测判定，你只需要严格遵守 带前置环境变量 执行 amcpcli.exe即可；

## 注意事项

- 首次执行时如果需要用户授权，按终端提示完成认证；后续 token 与 session 会自动复用
- 鉴权或 session 异常导致连续失败时，使用 `amcpcli.exe reset` 清理后重试
