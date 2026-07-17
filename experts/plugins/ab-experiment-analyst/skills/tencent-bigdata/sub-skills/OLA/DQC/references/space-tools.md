# 空间查询工具

## list_spaces

列出当前令牌授权的所有空间及其摘要信息（规则数、监控数、活跃告警数）。

### 使用场景

- 用户问"我有哪些空间"
- 用户问"可以操作哪些链路"
- 需要获取 workbenchId 作为后续操作的基础

### 参数

无参数。

### 返回示例

```json
{
  "code": 0,
  "data": [
    {
      "workbenchId": 10001,
      "workbenchName": "数据质量空间",
      "ruleCount": 25,
      "monitorCount": 10,
      "activeAlertCount": 3
    }
  ]
}
```

### 使用提示

- 若只有一个空间，可自动使用该空间的 workbenchId
- 若有多个空间，应列出供用户选择
- workbenchId 是后续调用 `list_monitors`、`list_rules`、`list_alert_events` 等工具的必要参数
