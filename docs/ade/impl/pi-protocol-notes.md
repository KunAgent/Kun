# Pi RPC 协议档案（P6-09 前置契约）

P6b §0 要求的实机核对结果。来源两条腿：

1. **本机实跑** `@earendil-works/pi-coding-agent@0.99.0`（npm 包存在，bin=`pi`，
   `pi --version` 输出裸 semver `0.99.0`），隔离 `PI_CODING_AGENT_DIR` + `--session-dir`
   下跑了 `get_state` / `get_session_stats` / `prompt` / `abort` 真请求。
2. **cindy 量产实现** `packages/maker-core/src/agents/pi/**`（同一协议的线上消费者），
   命令面/事件面/bridge 形态以它为准。

## 安装与检测

| 项 | 值 |
| --- | --- |
| npm 包 | `@earendil-works/pi-coding-agent`（实测 0.99.0；bin `dist/bundle/cli.js`） |
| 安装 | `npm i -g @earendil-works/pi-coding-agent`（产出 `pi` 命令） |
| 版本探测 | `pi --version` → 单行裸 semver（`0.99.0`） |
| 配置根 | env `PI_CODING_AGENT_DIR`（models.json/扩展/sessions 都挂这里） |
| 会话目录 | `--session-dir <dir>`；会话文件 `<sessionDir>/<ts>_<uuid>.jsonl` |
| 登录查询 | 无独立查询命令；`prompt` 未配 provider 时返回 `{success:false, error:"No API key found…"}` |

## 启动参数（cindy 量产参数面）

```
pi --mode rpc
   --no-approve            # 关 pi 自带审批（审批归 Kun bridge）
   --no-extensions         # 不自动加载用户/项目扩展
   --session-dir <dir>
   --provider <id> --model <id>
   [--tools read,grep,...]      # 工具白名单（review 场景）
   [--append-system-prompt <t>] # 追加而非替换 pi 内置 prompt（勿用 --system-prompt）
   [--extension <path>]…        # 显式扩展（kun-pi-bridge.ts 走这里）
   [--skill <path>]… [--prompt-template <path>]…
   [--session <file|id>]        # resume
   [--no-context-files] [--offline]
```

## 帧格式（JSONL/stdio）

- 请求：`{id:'<string>', type:'<command>', ...args}`（id 为字符串，官方 rpc.md
  明确）；响应：`{id:'<string>', type:'response', command:'<echo>',
  success:boolean, data?:{...}, error?:string}`。
- 事件（pi→host，无 id）：`{type:'<event>', ...}`。
- 扩展 UI 回复：`{type:'extension_ui_response', id, confirmed?|value?|cancelled?:true}`。

## 命令面（cindy 在用，Kun v1 只取粗体）

| 命令 | 用途 |
| --- | --- |
| **`prompt {message}`** | 发输入；`/xxx` 也走这里（如 `/plan`） |
| **`steer {message}`** | 同轮插话（cindy 在 managedExtensionCommand 场景回落 prompt） |
| **`abort`** | 中止当前流 |
| **`get_state`** | `data:{model{provider,baseUrl,...}, thinkingLevel, isStreaming, sessionFile, sessionId, autoCompactionEnabled, …}` |
| **`get_session_stats`** | `data:{sessionFile, sessionId, userMessages, tokens{input,output,cacheRead,cacheWrite,total}, cost}` |
| **`switch_session`** | 同进程切会话（resume 锚） |
| **`set_model {provider, modelId}`** | 会话中换模型 |
| **`set_auto_compaction {enabled}`** | 关自动压缩（Kun 接管上下文时） |
| **`compact`** | 手动压缩 |
| **`fork {entryId}`** | 按条目分叉会话树 |
| `clone` / `get_entries` / `get_fork_messages` / `get_tree` / `export_html` | 会话树/导出（v1 不用） |

## 事件面（pi→host）

```
agent_start → (turn_start → message_start → {text_delta|thinking_*} →
  message_end → tool_execution_* → …) → turn_end → agent_end → agent_settled
```

- **`agent_settled` 是唯一终止边界**：`agent_end`/`turn_end` 之后还可能有
  auto_retry/compaction/排队 follow-up；终态一律等 `agent_settled`（cindy 明确注释）。
- `tool_execution_start/update/end` 带 `toolCallId`/`toolName`/`input`；
  `message_update` 增量与 `text_delta` 并存（cindy 用 delta 流、`message_end` 定稿）。
- `auto_retry_*`/`compaction_*`/`summarization_retry_*`/`queue_update`/
  `bash_execution_update`/`extension_error`/`plan_mode_changed` —— v1 只映射
  compaction/retry 到 Kun 状态事件，其余可落 diagnostics。
- `extension_ui_request {id, method, ...}`：bridge 内 `ctx.ui.confirm/input/select`
  的出栈事件；host 回 `extension_ui_response`。

## 权限门（pi 原生无工具审批 → Kun 注入 bridge 扩展）

- 扩展契约：`<PI_CODING_AGENT_DIR>/extensions/` 下的 `.ts`，`export default async function(pi){…}`，跑在 pi 的 bun 运行时里，只用 pi ExtensionAPI + node:fs/fetch。
- `pi.on('tool_call', async (event, ctx) => …)`：`event={toolName,toolCallId,input}`；
  返回 `{block:true, reason}` 拦截；`ctx.ui.confirm(title, detail)` 出 `extension_ui_request`。
- 权限档**每次调用现读 `KUN_PI_PERMISSION_FILE`**（热切换生效；读不到一律 fail-closed 到 ask）。
- **控制面硬防护**：`PI_CODING_AGENT_DIR`（models.json/权限文件所在）的结构化写一律 block —
  防止模型改写 baseUrl/apiKey 把会话 MITM 到攻击者端点（cindy R5 审计 H-4 同款）。
  对 symlink 父目录也要 realpath 判定。

## 已知差异与收口

- pi 无 initialize 握手：进程起来即可接命令；就绪判定 = `get_state` 返回 success。
- pi 无账号体系：登录态 = 用户自己的 `~/.pi`（native-login）或 Kun 生成的
  `PI_CODING_AGENT_DIR/models.json`（kun-gateway，apiKey 只写 env 引用名）。
- `turn_end`/`agent_end` 不是终止信号——实现里只能以 `agent_settled` 收口。
