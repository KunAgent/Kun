---
name: jiaozhen-factcheck
description: 事实查证工具，对输入内容的具体说法、资讯、事件或常识进行真实性、准确性、可靠性判断。当用户需要较真一下，查证问题或判断信息真伪、识别谣言、询问真假，是真的吗，真的假的，能否xxx，可不可以，是谣言吗...等场景时调用。
description_zh: "事实查证与谣言识别，判断信息真伪与可靠性"
description_en: "Fact-checking tool for verifying claims and identifying rumors"
version: 1.0.1
author: TencentNews
tags:
- news
- tencent
- factcheck
- jiaozhen
- misinformation detection
- fake news
- rumor
- truth
---

# 腾讯较真事实查证

通过 `tencent-news-cli` 的较真能力完成事实核查。

> **核心原则**：基础设施交给脚本处理；智能体只负责依据当前 CLI 能力选择命令和参数。**除 `cli-state` 外，所有 CLI 调用都通过 `run-cli` 执行；始终先读 `help jiaozhen`，不要硬编码任何业务命令。**

## 平台约定

| 平台 | 脚本运行方式 | 示例 |
|------|------------|------|
| macOS / Linux | `sh scripts/<name>.sh` | `sh scripts/cli-state.sh` |
| Windows | `bun scripts/<name>.ts` | `bun scripts/cli-state.ts` |

> Windows 需先确保 `bun` 可用。若不可用：`powershell -c "irm bun.sh/install.ps1 | iex"`，安装后重启终端确认 `bun --version`。

以下所有脚本调用均以 macOS / Linux 为例，Windows 将 `.sh` 替换为 `.ts`，`sh` 替换为 `bun`。

除 `cli-state` 外，所有 CLI 命令都通过 `run-cli` 脚本执行：

| 平台 | CLI 调用模板 |
|------|-------------|
| macOS / Linux | `sh scripts/run-cli.sh <command> [args]` |
| Windows | `bun scripts/run-cli.ts <command> [args]` |

## Phase 1：环境就绪

> 环境已就绪时直接跳到 Phase 2。

### 1. 状态检查

```sh
sh scripts/cli-state.sh
```

解析返回的 JSON，关注以下字段：

| 字段 | 含义 |
|------|------|
| `platform.cliPath` | 底层实际使用的 CLI 完整路径，供诊断错误或权限问题时参考 |
| `platform.cliSource` | `global`（优先命中 PATH 中可用的全局命令，否则命中默认全局安装目录）/ `local`（旧版 skill 目录内安装，兼容兜底）/ `none`（以上路径都未找到） |
| `cliExists` | CLI 是否存在 |
| `update.needUpdate` | 当前版本是否需要更新 |
| `update.error` | `version` 检查失败时的错误信息 |
| `apiKey.present` | API Key 是否已配置 |
| `apiKey.status` | `configured` / `missing` / `error` |
| `apiKey.error` | `apikey-get` 执行异常或输出异常时的错误信息 |

### 2. 安装 CLI（`cliExists` 为 `false` 时）

> 仅当 `cliSource` 为 `none` 时才需要安装；`local` 表示命中了旧版本地安装，可继续使用但建议后续迁移到全局安装。

按照安装命令执行安装

安装成功后重新执行 `sh scripts/cli-state.sh`（Windows 用 `bun scripts/cli-state.ts`）刷新状态。

若安装失败，引导用户手动处理。

### 3. 更新 CLI（`update.needUpdate` 为 `true`，或 CLI 提示版本过旧时）

```sh
sh scripts/run-cli.sh update
```

Windows 使用 `bun scripts/run-cli.ts update`。

若 `update.error` 不为空，先展示错误并让用户处理。

若 `update` 命令失败，或错误信息表明当前 CLI 不支持 `update`（如 `unknown command`、`not found`、`not recognized`），按上述步骤 2 重新安装。仍然失败时，引导用户手动处理。

### 4. 配置 API Key（`apiKey.status` 不为 `configured` 时）

- `missing` → 引导用户打开 [API Key 获取页面](https://news.qq.com/exchange?scene=appkey) 自行获取，**不要执行 `open` / `xdg-open` / `start` 等命令自动打开浏览器**
- `error` → 展示 `apiKey.error`，让用户先处理（权限、网络、CLI 异常），处理后重试

设置 Key（通过 `run-cli` 执行，KEY 是裸值不加引号）：

```sh
sh scripts/run-cli.sh apikey-set KEY
```

Windows 分别使用 `bun scripts/run-cli.ts apikey-set KEY`、`bun scripts/run-cli.ts apikey-get`、`bun scripts/run-cli.ts apikey-clear`。

验证：`sh scripts/run-cli.sh apikey-get`
清除（仅用户明确要求时）：`sh scripts/run-cli.sh apikey-clear`

详见上述 API Key 配置说明。

## Phase 2：事实查证

> 较真相关命令可能随 CLI 版本变化。**始终以当前 `help jiaozhen` 输出为准，不要假设或记忆任何业务命令。**

1. **先执行 `help jiaozhen`**
   通过 `run-cli` 执行：macOS / Linux 为 `sh scripts/run-cli.sh help jiaozhen`，Windows 为 `bun scripts/run-cli.ts help jiaozhen`。

2. **根据 `help jiaozhen` 选择命令**
   - 从帮助里找到最匹配的查证命令，按帮助说明传入用户的命题或文本
   - **长文本、文章、聊天记录** → 优先查找帮助中是否存在整段文本/内容查证能力；若没有，再提炼 1-3 条核心可核查命题分别执行
   - **图片、截图等多模态内容** → 利用自身的多模态理解能力（视觉识别）解析图片中的文字和关键信息，提炼出可核查的事实命题，再调用 CLI 查证命令；若图片模糊无法识别，请用户提供更清晰的图片或可复制文本
   - 若 `help jiaozhen` 中无匹配命令，如实告知用户当前 CLI 不支持该场景

3. **执行命令时遵守三条约束**
   - 所有实际 CLI 调用都走 `run-cli` 脚本，不要直接执行 `platform.cliPath`
   - 业务命令、参数名、参数顺序都以 `help jiaozhen` 展示为准，必要时照抄帮助中的示例
   - 不要自行猜测 `--jiaozhen` 在实际执行命令中的位置；按帮助输出里的完整用法组装

4. **输出结果**——把 CLI 返回的完整 markdown 作为最终答复主体直接展示给用户
   - 必须保留 CLI 原文中的所有结构化内容，包括但不限于：`【查证结论】`、`【查证过程】`、`【查证结论信心评估】`、来源编号、来源标题、来源链接
   - **不能只提炼结论后自行总结**

## 输出格式

较真 CLI 返回的内容本身已经是格式完善的 markdown，**最终回复必须以该 markdown 原文为主体直接输出，不要重新组织、摘要、改写或转述成另一版答案**。

- CLI 输出什么就展示什么，尤其要完整保留其中的来源链接与查证过程，不增不减
- 不要自行补充外部信息、不要伪造链接
- 不要把 CLI 原文藏在“根据查证结果”“结论如下”这类转述后面；应直接粘贴 CLI 返回内容
- 若确实需要补充一句说明，只能放在 CLI 原文之后，且不能替代原文
- 若 CLI 输出为空或执行失败，按下方「CLI 执行失败处理」流程处理

## CLI 执行失败处理

**CLI 命令失败后，立即停止，绝不通过 WebSearch 或其他方式自行补做事实查证。**

1. CLI 返回非零退出码、超时或输出含权限/安全错误时，不要重试，不要换方式。
2. 根据错误信息引导用户：
   - **macOS Gatekeeper**（`cannot be opened`、`not verified`）→ 系统设置 → 隐私与安全性 → 「仍要打开」
   - **企业安全软件**（`connection refused`、防火墙拦截）→ 安全提示中点击「信任」/「允许」
   - **权限不足**（`permission denied`）→ `chmod +x <cliPath>`
   - **其他** → 展示完整错误，请用户处理
3. 用户确认操作完成后再重试。即使多次失败，也只能告知当前无法完成查证并说明原因，**绝不**回退到其他信息源。

## References

> 注：本 skill 为单文件包，安装/更新/API Key 配置说明已内联在上述流程中。
