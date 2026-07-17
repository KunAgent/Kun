# WecomCreateChat — 企微拉群协助

拉一个企微内网客服群，并自动在群里发一条欢迎语「激活」群（让所有成员客户端浮出会话）。

## 接口

```
POST /internal/wecom_app/create_chat
Content-Type: application/json
X-Internal-Token: <TOF 链路签发的 token>
```

### 请求 Body

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 群名，≤32 字符（汉字按 1 计） |

> 仅支持 `name` 一个字段。群成员、欢迎语均由网关侧固定，不接受外部传入。

### 群成员组装规则

最终拉群成员 = `service_id` + 配置里的 `wecom_app.default_members` + token 里的触发者 RTX，按此顺序去重。调用方无法通过接口追加成员。

### 鉴权

`X-Internal-Token` 必填，由 TOF 链路签发，Payload 必须包含 `login_name`。

| 场景 | HTTP | 响应头 `X-Internal-Token-Error` |
|------|------|------|
| 未带 header | 401 | `missing` |
| token 过期 | 401 | `expired` |
| token 非法/签名错 | 401 | `invalid` |
| token 不带 login_name | 401 | — |

## 调用示例

```bash
python3 {baseDir}/scripts/wecom_create_chat.py --name "项目X 迁移支持群"
```

## 返回格式（脚本输出）

### 成功

```json
{
  "success": true,
  "action": "WecomCreateChat",
  "data": {
    "chat_id": "wwxxxxxxxxxxxxxxxx",
    "members": ["service_account", "shiyaosong", "louiscxqiu", "willisliu", "waitechen", "<trigger_rtx>"],
    "welcome_sent": true
  },
  "requestId": ""
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `chat_id` | String | 企微群 ID，用于后续 `send_text` |
| `members` | Array | 实际下发的成员清单（去重后） |
| `welcome_sent` | Boolean | 欢迎语是否发送成功 |
| `welcome_warning` | String | 仅在欢迎语发送失败时出现，群已建成但客户端可能不浮出 |

### 失败

```json
{
  "success": false,
  "action": "WecomCreateChat",
  "error": { "code": "AuthError", "message": "拉群鉴权失败: token 已过期" },
  "requestId": ""
}
```

## 错误码

| 错误码 | HTTP | 触发条件 |
|--------|------|----------|
| `AuthError` | 401 | token 缺失/过期/非法/不带 login_name |
| `HTTPError` | 400 | body 无法解析 / `name` 为空 / 群名超长 |
| `HTTPError` | 502 | 企微 `appchat/create` 调用失败 |
| `HTTPError` | 503 | 网关侧未配置 wecom_app 或 internal token auth |
| `NetworkError` | — | 网络连接失败 |
| `ConfigError` | — | 脚本配置错误（如 tai-auth.sh 缺失、群名超长） |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MIGRAQ_TOF_TOKEN_URL` | 可选 | TOF token 网关地址，默认 `https://migraq-chat-test.mcp.it.woa.com/proxy/internal/auth/tof/token` |
| `MIGRAQ_CREATE_CHAT_URL` | 可选 | 拉群接口地址，默认 `http://chat.migraq.woa.com:8080/proxy/internal/wecom_app/create_chat` |
