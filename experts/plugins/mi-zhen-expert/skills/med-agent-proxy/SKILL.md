---
name: med-agent-proxy
description: 所有用户 query 代理 Skill。只负责调用本 Skill 自带脚本，由脚本处理 chatWorkbuddy 调用、绑定、解绑、不绑定、响应解析和最终输出。
agent_created: true
---

# Med Agent Proxy

## 目标

将用户的所有请求交给本 Skill 自带脚本处理。脚本负责调用觅诊后台 HTTP 接口、解析返回、处理绑定、解绑、不绑定，并决定最终输出给用户的内容。

固定接口：

```text
https://medagent.woa.com/med-agent/chatWorkbuddy
```

绑定确认接口由脚本从固定接口自动推导为同路径下的 `workbuddyBindConfirm`，也可以通过 `MED_AGENT_BIND_CONFIRM_URL` 或 `--bind-confirm-url` 覆盖。

## 触发场景

在用户发出任何 query 时使用本 Skill，并直接交给脚本处理。

不按领域、内容、意图、语言、长度或安全类别做额外筛选；绑定、解绑、不绑定也都必须交给脚本识别和处理。

## 执行流程

### 1. 直接触发

收到用户 query 后直接执行本 Skill，不做前置分类、不做领域判断、不做内容过滤。

### 2. 调用脚本

对所有用户 query，包括账号绑定、解绑、不绑定消息，都直接调用本 Skill 自带脚本：

```bash
python3 scripts/chat_workbuddy.py --query "<用户原始请求>"
```

如果运行环境要求使用绝对 Python 路径，使用可用的 Python 3 解释器执行同一脚本即可。

关键规则：

- `<用户原始请求>` 必须使用用户的原始请求文本。
- 不得改写、总结、翻译、纠错、补充上下文或拆分用户请求。
- 不得额外添加系统提示、安全提示、免责声明或解释性文字到 `query`。
- 不得自行判断绑定、解绑、不绑定意图后改写 query；只负责透传给脚本。
- 不得因为 query 内容看起来不属于医疗健康领域而跳过调用。
- 不再加载或调用 `medical-mcp-server` MCP。

### 3. 账号状态处理

账号状态完全由脚本根据用户原始请求处理：

- **绑定**：当 query 是觅诊账号绑定消息时，脚本提取 `userId`，调用绑定确认接口确认生效后再写入本地绑定文件；确认失败时不保存绑定，并输出后端错误或重试提示。
- **不绑定**：当 query 明确表示“不绑定/跳过绑定/skip/nobind”等意图时，脚本生成新的 WorkBuddy 匿名 `userId`，以不绑定状态保存，并携带该匿名 `userId` 继续调用 `chatWorkbuddy`。
- **解绑**：当 query 明确表示“解绑/解除绑定/取消绑定/unbind”等意图时，脚本先携带当前 `userId` 调用 `chatWorkbuddy`，成功输出后将旧 `userId` 标记为不绑定，再生成新的匿名 `userId` 保存为不绑定状态。
- **普通对话**：脚本优先使用命令行 `--user-id`、环境变量 `MED_AGENT_USER_ID` 或本地绑定文件中的有效 `userId`；没有可用 `userId` 时仅发送原始 `query`。

### 4. 返回脚本输出

最终回复内容完全以脚本的标准输出为准。脚本负责绑定、解绑、不绑定、HTTP 请求、SSE/JSON 解析、错误处理和最终展示内容选择。

禁止在脚本输出之外自行追加、删减、总结、改写或混合其他来源内容。

## 异常处理

如果脚本返回错误或无输出，按脚本输出如实返回；禁止在接口失败时自行编造医疗建议。
