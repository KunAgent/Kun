# CloudQChatCompletions — CloudQ 全局对话

CloudQ 全局对话交互接口（SSE 流式输出），不绑定特定架构图，支持跨架构图的全局智能问答。

AK/SK 和 OAuth 两种鉴权方式统一使用此接口。

## 对话模式

始终使用异步模式，不区分场景：

| 模式 | 参数 | 说明 |
|------|------|------|
| **异步** | `Async=true`（固定使用） | 不受客户端 60s 超时限制 |

### 为什么是异步？

调用方终端环境（CodeBuddy/WorkBuddy/OpenClaw 等）通常有 **60 秒超时限制**，而 CloudQ 后端 SSE 编排正常耗时在 **5~10 分钟**，长任务最长可达 **20 分钟**。如果使用同步模式，客户端超时会直接断开连接，用户永远得不到结果。

异步模式将"请求"与"结果获取"解耦：
1. 发起异步请求 → 立即返回 accepted（< 1s，不受超时限制）
2. 轮询查询结果 → 每次查询 < 1s，间隔可控

**因此所有调用一律使用异步模式。**

## 调用示例

```bash
# 发起异步请求
python3 {baseDir}/scripts/tcloud_sse_api.py '列出架构图' --source codebuddy --session-id <uuid>

# accepted 帧返回：
# {"success":true,"data":{"chat_id":"chat-xxx","session_id":"sess-xxx","content":"任务已受理...","is_accepted":true}}

# 查询任务状态（每次 <1s，不触发终端超时）
python3 {baseDir}/scripts/tcloud_async_task.py query <chat_id> <session_id>

# 取消任务
python3 {baseDir}/scripts/tcloud_async_task.py cancel <chat_id> [session_id]
```

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| Question | 是 | String | 用户问题，如 `列出架构图` |
| SessionID | 是 | String | 会话 ID（UUID v4），同一对话必须保持不变 |
| Source | 否 | String | 调用来源平台标识（不区分大小写），AI 根据当前运行环境自动判断，可选值：`codebuddy`、`workbuddy`、`openclaw`、`qclaw`、`hermes` 等 |
| Async | 否 | Boolean | 是否异步模式，默认 true。始终使用异步 |
| UseCloudQCredential | 否 | Boolean | OAuth 鉴权时自动设为 true，标识使用 CloudQ 控制台凭证 |
| UIRenderEvent | 否 | Boolean | 是否返回结构化 UI 事件 |
| Messages | 否 | Array | 历史消息上下文 |
| Model | 否 | String | 模型名称 |

## 返回格式

### 异步 accepted 帧

```json
{
  "success": true,
  "action": "CloudQChatCompletions",
  "data": {
    "session_id": "049bbd09-c5c9-48fa-b9c0-8952d94e53fe",
    "content": "当前账号下共有 **10 张**架构图...\n\n[前往智能顾问控制台](免密登录URL)",
    "is_final": true
  },
  "requestId": "d72bal4g699bmj4h7gs0"
}
```

### 异步模式（accepted 帧）

```json
{
  "success": true,
  "action": "CloudQChatCompletions",
  "data": {
    "chat_id": "chat-7f3a9b2e1d4c",
    "session_id": "sess-e5b8c1a0f6d2",
    "content": "任务已受理...",
    "is_accepted": true
  }
}
```

### 异步任务查询结果（DescribeCloudQAsyncTask）

```json
{
  "success": true,
  "action": "DescribeCloudQAsyncTask",
  "data": {
    "Status": "completed",
    "FinishReason": "stop",
    "Content": "根据您的云架构分析，建议优化以下资源配置...",
    "SessionID": "sess-e5b8c1a0f6d2",
    "ChatID": "chat-7f3a9b2e1d4c"
  }
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | String | **会话 ID**（UUID v4），用于标识同一轮对话。多轮对话时必须传入此值以保持上下文 |
| `content` | String | Markdown 格式回答（控制台链接已自动替换为免密登录链接） |
| `is_final` | Boolean | 是否为最终结果 |
| `requestId` | String | 请求追踪 ID（仅用于日志排查，**不能用作会话标识**） |

异步模式额外字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `chat_id` | String | 异步任务 ID，用于后续 `DescribeCloudQAsyncTask` 查询 |
| `is_accepted` | Boolean | 是否为 accepted 帧（异步模式） |

## FinishReason 枚举

| 值 | 含义 | 出现场景 |
|----|------|----------|
| `stop` | 正常完成 | 编排自然结束 |
| `user_stopped` | 用户主动停止 | `CancelCloudQChat` / `CancelCloudQAsyncTask` 触发 |
| `timeout` | 执行超时 | 编排超过时间上限自动终止 |
| `error` | 执行异常 | panic / 系统错误 |

## 脚本自动处理（无需手动干预）

`tcloud_sse_api.py` 在返回 content 前会自动执行以下处理：

1. 扫描 `console.cloud.tencent.com` 链接，替换为免密登录链接
2. 如果链接不含 archId 但内容中有架构图 ID（`arch-xxx`），自动拼入
3. 自动追加 `hideTopNav=true` 参数
4. 已是免密登录链接的不会重复处理
5. 免密链接生成失败时保留原链接
6. 如果 content 中没有任何免密链接，自动在末尾追加 `[前往智能顾问控制台](免密登录URL)`

## 展示规则

- `content` **已包含免密登录链接**，可直接展示给用户，无需额外生成
- 严禁直接展示完整免密登录 URL，必须以 Markdown 超链接格式展示

## 错误返回

调用失败时返回统一错误格式，**必须将错误码和错误信息展示给用户**：

```json
{
  "success": false,
  "action": "CloudQChatCompletions",
  "error": {
    "code": "UnauthorizedOperation",
    "message": "The operator is not authorized."
  },
  "requestId": "18b169de-4e4e-46d9-80ff-53053f34b0d7"
}
```

## 常见错误码

| 错误码 | 说明 | 处理方式 |
|--------|------|---------|
| `AuthFailure.SecretIdNotFound` | SecretId 不存在 | 提示用户检查 AK/SK 配置 |
| `AuthFailure.SignatureFailure` | 签名验证失败 | 提示用户检查 SecretKey 是否正确 |
| `AuthFailure.InvalidSecretId` | SecretId 无效 | 提示用户检查 AK/SK 配置 |
| `UnauthorizedOperation` | 无操作权限 | 提示用户当前账号无权调用此接口，需授权 `QcloudAdvisorFullAccess` 策略 |
| `UnauthorizedOperation.CamUnauthorized` | CAM 鉴权未通过 | 提示用户为子账号授予智能顾问相关权限 |
| `FailedOperation` | 操作失败 | 将错误信息原样展示给用户 |
| `ResourceNotFound` | 资源不存在 | 提示用户可能未开通智能顾问，调用 `DescribeUserAuthorizationStatus` 确认 |
| `RequestLimitExceeded` | 请求频率超限 | 提示用户稍后重试 |
| `ErrMissingParameter` | 必填参数缺失 | 检查 ChatID/SessionID 是否传入 |
| `ErrOperationDenied` | 无权操作 | 跨用户访问被拒绝 |

## 错误处理规则

1. **必须将 `error.code` 和 `error.message` 展示给用户**，不可吞掉错误
2. 权限类错误（`UnauthorizedOperation`、`AuthFailure.*`）需提示用户检查账号权限或 AK/SK 配置
3. 未开通类错误需引导用户通过 `DescribeUserAuthorizationStatus` 确认后决定是否开通
