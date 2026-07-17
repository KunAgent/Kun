# MigraQChatCompletions — 迁移专家全局对话

腾讯云迁移服务专家对话接口（SSE 流式输出），支持云资源扫描、迁移方案规划、目标云选型推荐、TCO 分析、迁移工具选择等全流程迁移问答。

## 调用模式

| 模式 | 适用场景 | 是否需要 AK/SK | 命令 |
|------|----------|----------------|------|
| **免鉴权** | 售前流程（扫描、推荐、TCO、评估等） | ❌ 不需要 | `--no-auth` |
| **鉴权** | 迁移执行、集群管理 | ✅ 需要 | 默认 |

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| Input | 是 | String | 用户问题，如 `阿里云50台ECS如何迁移到腾讯云` |
| Stream | 是 | Boolean | 固定值 `true`（SSE 流式输出） |
| SessionKey | 是 | String | 会话 ID（UUID v4）。首次调用由脚本自动生成；多轮对话时传入上次返回的 `session_id` |

## 鉴权

- **免鉴权模式**：无需认证头，直接调用免鉴权 endpoint
- **鉴权模式**：使用腾讯云 TC3-HMAC-SHA256 签名（需要 `TENCENTCLOUD_SECRET_ID` + `TENCENTCLOUD_SECRET_KEY`）

## 调用示例

```bash
# 免鉴权（售前流程，默认推荐）
python3 {baseDir}/scripts/migrateq_sse_api.py --no-auth '阿里云50台ECS如何迁移？'
python3 {baseDir}/scripts/migrateq_sse_api.py --no-auth '帮我做TCO分析' '550e8400-e29b-41d4-a716-446655440000'

# 鉴权（迁移执行、集群管理）
python3 {baseDir}/scripts/migrateq_sse_api.py '帮我执行迁移任务'
python3 {baseDir}/scripts/migrateq_sse_api.py '创建迁移集群' '550e8400-e29b-41d4-a716-446655440000'
```

## 返回格式（脚本输出）

脚本自动解析 SSE 流并汇总为统一 JSON：

```json
{
  "success": true,
  "action": "MigraQChatCompletions",
  "data": {
    "content": "## 迁移方案概述\n\n对于阿里云50台ECS迁移到腾讯云...",
    "is_final": true,
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "usage": {
      "prompt_tokens": 13080,
      "completion_tokens": 512,
      "total_tokens": 13592
    }
  },
  "requestId": "resp_84ced3ce-1234-5678-abcd-ef0123456789"
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | String | Markdown 格式回答，直接展示给用户 |
| `is_final` | Boolean | 是否为最终结果（固定 true） |
| `session_id` | String | 调用方传入的 SessionID，原样返回 |
| `usage.prompt_tokens` | Integer | 输入 Token 数 |
| `usage.completion_tokens` | Integer | 输出 Token 数 |
| `usage.total_tokens` | Integer | 总 Token 数 |
| `requestId` | String | Gateway 请求 ID，用于问题排查 |

## 原始 SSE 流格式

```
event: run.started
data: {"type":"run.started","session_id":"550e8400-e29b-41d4-a716-446655440000"}

event: run.progress
data: {"type":"run.progress","stage":"preparing","summary":"Preparing request"}

event: message.delta
data: {"type":"message.delta","delta":"## 迁移"}

event: message.delta
data: {"type":"message.delta","delta":"方案"}

event: message.completed
data: {"type":"message.completed","reply":"## 迁移方案\n...","usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}
```

| SSE 事件 | 含义 |
|---------|------|
| `run.started` | 会话已建立，服务端确认收到 `SessionKey` |
| `run.progress` | 处理进度提示（可忽略） |
| `message.delta` | 流式文本增量，取 `delta` 字段实时拼接 |
| `message.completed` | 流结束，取 `reply`（完整回复）和 `usage` |

## Session 管理

**免鉴权和鉴权模式共享同一个 SessionKey，保证对话上下文连续。**

| 场景 | 处理方式 |
|------|---------|
| 首次对话 | 不传 session_id，脚本自动生成 UUID v4 |
| 同一对话追问 | **必须**沿用上次返回的 session_id |
| 用户要求新对话 | 不传 session_id，脚本重新生成新 UUID |

## 清除会话

```bash
python3 {baseDir}/scripts/migrateq_sse_api.py --clear-session
```

## 展示规则

- `content` 为 Markdown 格式，可直接展示给用户
- 若 `success: false`，按 SKILL.md §七 失败话术模板回应

## 常见错误码

| 错误码 | 含义 | 处理方式 |
|--------|------|---------|
| `NetworkError` | 无法连接 API | 检查网络连接 |
| `HTTPError` | API 返回 HTTP 错误 | 检查 API 状态 |
| `AuthError` | 鉴权失败（仅鉴权模式） | 检查 AK/SK 配置 |
| `StreamError` | SSE 流中断 | 可重试 |
| `MissingParameter` | 脚本调用缺少参数 | 检查调用方式 |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `TENCENTCLOUD_SECRET_ID` | 鉴权模式必填 | 腾讯云 SecretId |
| `TENCENTCLOUD_SECRET_KEY` | 鉴权模式必填 | 腾讯云 SecretKey |
| `CMG_REGION` | 可选 | 地域，默认 ap-shanghai |
| `CMG_NO_AUTH_HOST` | 可选 | 免鉴权 endpoint host，默认 msp.cloud.tencent.com |
| `CMG_NO_AUTH_PATH` | 可选 | 免鉴权 endpoint path，默认 /open/chat |
| `CMG_NO_AUTH_SCHEME` | 可选 | 免鉴权 endpoint scheme，默认 https |
