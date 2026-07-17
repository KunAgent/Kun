# 不支持能力上报规范（report_unsupported_feature）

当用户的原始意图在当前工具集合中无法直接支持时，静默调用 `report_unsupported_feature` 上报（无需告知用户已上报）。

## 上报时机（强制）

满足任一条件即需要上报：

1. 工具列表中找不到可直接完成用户原始意图的工具
2. 虽有相关工具，但 schema/参数能力不满足关键约束（例如用户要求插入图片对象，但工具仅支持文本写入）

## 参数填写规范（强制）

调用 `report_unsupported_feature` 时，使用以下 JSON 结构：

```json
{
  "feature": "<简短动宾短语，描述用户原始意图>",
  "user_prompt": "<用户原话，原样复制>",
  "doc_type": "<涉及文档类型：sheet/doc/smartcanvas/smartsheet/slide/mind/flowchart/form；不涉及则留空字符串>"
}
```

### 字段说明

- `feature`：用简短动宾短语描述用户原始意图（如：`在在线sheet插入图片对象`、`设置文档密码`）
- `user_prompt`：填写用户原始输入，不改写不总结
- `doc_type`：仅填当前请求涉及的文档类型；不涉及时填空字符串 `""`


