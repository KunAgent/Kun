# ChatCompletionsAndonQ — AndonQ 全局对话

AndonQ 全局对话交互接口（SSE 流式输出），核心能力（工单/需求单查询、云产品问答、云资源查询等）由后端统一承载。

## 接口定义

| 项 | 值 |
|------|------|
| URL | `https://andon.cloud.tencent.com/api/v1/gateway/chat-completions-andonq` |
| method | `POST` |
| Content-Type | `application/json` |
| Accept | `text/event-stream` |
| 鉴权 Header | `X-TANDON-CODE: <OAuth2 临时码>` |
| action | `ChatCompletionsAndonQ` |

## 请求参数（请求体 JSON）

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| `content` | 是 | String | 用户问题，如 `查询我的工单` |
| `session_id` | 是 | String | 会话 ID（UUID v4），同一对话必须保持不变 |

### curl 示例

```bash
curl -XPOST 'https://andon.cloud.tencent.com/api/v1/gateway/chat-completions-andonq' \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -H 'X-TANDON-CODE: <你的临时码>' \
  --data '{"content":"查询下我的轻量服务器","session_id":"<UUID v4>"}' \
  -N
```

## 调用示例（脚本）

```bash
python3 {baseDir}/scripts/andon_sse_api.py '查询我的工单'
python3 {baseDir}/scripts/andon_sse_api.py '详细说说' '<首轮使用的 session_id>'
```

## 鉴权（OAuth2 临时码）

### 授权流程

1. **浏览器打开授权页面并登录**（腾讯云开放平台）；授权 URL 形式如下，其中 `state` 每次由脚本随机生成（UUID）用于防 CSRF。终端中该 URL 独占一行，支持 Cmd/Ctrl 点击直接打开，无需手动复制：

   ```
   https://cloud.tencent.com/open/authorize?app_id=100048267608&redirect_url=http%3A%2F%2Fandon.qq.com%2Foauth%2Faq%2Fcallback&scope=login&state=<随机 uuid>
   ```

   实际请通过 `python3 {baseDir}/scripts/check_env.py --bind-code` 打印出的 URL打开，不要复用旧 URL。

2. **登录成功后**，复制页面上展示的临时码。

3. **绑定临时码**（交互式粘贴并落盘）：

   ```bash
   python3 {baseDir}/scripts/check_env.py --bind-code
   ```

### 临时码本地存储

- **路径**：`~/.andonq/auth.json`
- **权限**：`0600`（仅当前用户可读写）
- **字段**：
  ```json
  {
    "token": "<临时码>",
    "obtained_at": 1761227278
  }
  ```
  `obtained_at` 为 Unix 秒级时间戳（整数）。旧版本 ISO8601 字符串会被自动兼容读取。
- **跨会话**：在临时码授权有效期内，新开会话、历史被压缩时脚本均会从该文件读取并复用；临时码过期后需重新授权并绑定

### 调用阶段

每次调用 `andon_sse_api.py` 时，脚本自动从 `~/.andonq/auth.json` 读取 `token`，并作为 HTTP Header `X-TANDON-CODE` 发送至网关。

### 临时码失效

当接口返回 `HTTP 401 / 403`，脚本会把错误统一映射为 `AuthCodeInvalid`，提示用户重新授权并执行 `--bind-code` 绑定。

> **AK/SK 已废弃**：本版本起不再使用腾讯云 API AK/SK 签名；`TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` / `TENCENTCLOUD_TOKEN` 环境变量无需配置（保留也不会影响本 Skill 运行）。

## 返回格式

脚本自动解析 SSE 流并汇总为统一 JSON：

```json
{
  "success": true,
  "action": "ChatCompletionsAndonQ",
  "data": {
    "content": "当前账号下共有 **15** 个工单...",
    "is_final": true
  },
  "requestId": "d72bal4g699bmj4h7gs0"
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | String | Markdown 格式回答（原样返回，不做任何后处理） |
| `is_final` | Boolean | 是否为最终结果（收到 `run.completed` 或 `message.completed` 时为 `true`） |

## SSE 响应事件（对齐 OpenClaw gwproto.StreamEvent，脚本已自动解析）

| 事件 `type` | 脚本行为 | 关键字段 |
|------|------|------|
| `message.delta` | 追加 `delta` 到 content 缓冲；实时 flush 到 stdout | `delta` |
| `message.completed` | 使用 `reply` 覆写 content（保证完整） | `reply` |
| `run.progress` | 输出 `[stage] summary` 到 stderr | `stage`、`summary` |
| `run.completed` | 正常结束流，返回成功结果 | — |
| `run.error` | 映射为统一错误 `{code, message}` 返回 | `error.type`、`error.message` |
| `[DONE]`（哨兵） | 兜底结束读流 | — |

其他事件类型（如 `public.delta`、`thought.delta` 等）会被静默忽略。

## 错误响应

```json
{
  "success": false,
  "action": "ChatCompletionsAndonQ",
  "error": {
    "code": "AuthCodeInvalid",
    "message": "OAuth2 临时码已失效或无权限，请重新授权..."
  },
  "requestId": ""
}
```

### 常见错误码

| 错误码 | 含义 | 解决方案 |
|--------|------|----------|
| `MissingAuthCode` | 未找到 `~/.andonq/auth.json` 或为空 | 执行 `python3 scripts/check_env.py --bind-code` 按提示完成授权与粘贴 |
| `AuthCodeInvalid` | 临时码失效（HTTP 401 / 403） | 重新访问授权页面登录，再 `--bind-code` 绑定 |
| `NetworkError` | 网络异常 | 检查网络连通性 |
| `HTTPError` | HTTP 状态码非 200 | 参考 message 排查 |
| `RunError` | 后端 `run.error` | 参考 message 排查 |

## 展示规则

- `content` 为 Markdown 原文，可直接展示给用户
- 严禁自行对 `content` 做链接替换、URL 改写等后处理，所有业务逻辑由后端 ChatCompletionsAndonQ 承载
- 多轮对话必须复用同一 `session_id`，改变 `session_id` 视为开启新对话

## 协议同意（子账号级，永久一次）

同一子账号**首次**调用 ChatCompletionsAndonQ 时，接口会返回《腾讯云 AndonQ 软件许可及服务协议》的同意请求。

**判断方式**：`content` 中包含 `软件许可及服务协议` 或 `请先阅读并同意` 关键词。

**处理流程**：

1. 直接将 `content` 展示给用户（含协议链接）
2. 用户回复「同意」后，以**同一 session_id** 发送「同意」：
   ```bash
   python3 {baseDir}/scripts/andon_sse_api.py '同意' '<同一SessionID>'
   ```
3. 同意成功后，该子账号后续所有对话均可正常使用

> **⚠️ 严禁自动发送「同意」**，必须由用户明确同意后才能发送。

## 频率限制

- 接口限制 20 次/秒（维度：API + 接入地域 + 子账号）

## SessionID 管理

调用方（Skill）**必须**显式生成并传入 `session_id`，**不要依赖脚本兜底**；脚本每次运行会把本次使用的 `session_id` 回显到 **stderr 首行** `[session] <uuid>`，供调用方读取复用。

| 场景 | session_id 处理 |
|------|---------------|
| **首次对话** | 调用方生成一个新的 UUID v4 并显式传入（例如 `python3 -c 'import uuid;print(uuid.uuid4())'`） |
| **同一对话追问** | **必须**沿用首次调用时传入的 session_id（从本对话上下文中回忆；若不确定，可从上一轮脚本 stderr 首行的 `[session] <uuid>` 回显中提取），**不采纳服务端返回的 session_id** |
| **用户要求新对话 / 重新开始** | 重新生成一个新的 UUID v4，并在后续所有调用中改用新值 |

> ⚠️ session_id 一旦改变，服务端视为全新对话，不包含任何历史上下文。
