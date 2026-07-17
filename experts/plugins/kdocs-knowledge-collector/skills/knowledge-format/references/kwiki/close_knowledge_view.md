# kwiki.close_knowledge_view

## 1. kwiki.close_knowledge_view

#### 功能说明

关闭并删除指定个人知识库，操作前务必确认目标正确。


#### 操作约束

- **前置检查**：调用 `kwiki.get_knowledge_view` 确认目标知识库名称和 ID
- **用户确认**：关闭知识库不可恢复，必须向用户确认目标知识库名称和 ID

**幂等性**：否 — 不可恢复操作，禁止自动重试

#### 调用示例

关闭指定知识库：

```json
{
  "drive_id": "8001234567"
}
```


#### 参数说明

- `drive_id` (string, 必填): 要关闭的知识库云盘 ID

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": ""
}

```


---

