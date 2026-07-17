# kwiki.update_knowledge_view

## 1. kwiki.update_knowledge_view

#### 功能说明

更新知识库名称、描述、封面、状态等配置，按需传入待修改字段。


#### 操作约束

- **前置检查**：`kwiki.get_knowledge_view` 确认目标知识库存在及当前配置
- **后置验证**：`kwiki.get_knowledge_view` 确认名称或简介已更新

**幂等性**：是

#### 调用示例

更新名称与描述：

```json
{
  "drive_id": "8001234567",
  "group_id": "6200987654",
  "name": "销售知识库（2026版）",
  "desc": "沉淀销售方法论、案例和常见问答",
  "cover_img": "https://cdn.example.com/2025/06/09/other/7.png",
  "status": 1
}
```


#### 参数说明

- `drive_id` (string, 必填): 知识库云盘 ID，来自 `list_knowledge_views` 或 `get_knowledge_view` 返回值
- `group_id` (string, 可选): 群组 ID，来自 `list_knowledge_views` 或 `get_knowledge_view` 返回值
- `name` (string, 可选): 新的知识库名称，不传则保持原值
- `desc` (string, 可选): 新的知识库简介，不传则保持原值
- `cover_img` (string, 必填): 封面图 URL（可从 get_knowledge_view 获取当前值回传）
- `status` (number, 必填): 可见性状态（可从 get_knowledge_view 获取当前值回传）

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": ""
}

```


---

