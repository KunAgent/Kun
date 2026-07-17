# CloudQChatCompletions — CloudQ 全局对话

CloudQ 全局对话交互接口（SSE 流式输出），不绑定特定架构图，支持跨架构图的全局智能问答。

## 参数

| 参数 | 必选 | 类型 | 描述 |
|------|------|------|------|
| Question | 是 | String | 用户问题，如 `列出架构图` |
| SessionID | 是 | String | 会话 ID（UUID v4），同一对话必须保持不变 |

## 调用示例

```bash
python3 {baseDir}/scripts/tcloud_sse_api.py '列出架构图'
python3 {baseDir}/scripts/tcloud_sse_api.py '详细说说' '550e8400-e29b-41d4-a716-446655440000'
```

## 返回格式

脚本自动解析 SSE 流并汇总为统一 JSON，**控制台链接已自动替换为免密登录链接**：

```json
{
  "success": true,
  "action": "CloudQChatCompletions",
  "data": {
    "content": "当前账号下共有 **10 张**架构图...\n\n[前往智能顾问控制台](免密登录URL)",
    "is_final": true
  },
  "requestId": "d72bal4g699bmj4h7gs0"
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | String | Markdown 格式回答（控制台链接已自动替换为免密登录链接） |
| `is_final` | Boolean | 是否为最终结果 |

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
