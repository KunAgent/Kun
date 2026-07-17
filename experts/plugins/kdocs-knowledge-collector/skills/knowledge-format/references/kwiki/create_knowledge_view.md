# kwiki.create_knowledge_view

## 1. kwiki.create_knowledge_view

#### 功能说明

创建新的个人知识库空间，可设置名称、状态、描述、封面与来源等基础信息。


#### 操作约束

- **后置验证**：新建后调用 `kwiki.get_knowledge_view` 或 `kwiki.list_knowledge_views` 核对返回的 `drive_id`、`group_id`、`kuid`

**幂等性**：否 — 重复调用会创建多个知识库，先确认是否已成功

#### 调用示例

创建销售知识库：

```json
{
  "space_name": "销售知识库",
  "desc": "沉淀销售话术、案例和培训资料",
  "status": 1
}
```


#### 参数说明

- `space_name` (string, 必填): 知识库名称
- `status` (number, 必填): 可见性状态。`1`=团队可见；`2`=企业可见；`3`=互联网公开。未提供该字段会返回 `inner invalid argument (status)` 错误。可选值：`1` / `2` / `3`；默认值：`1`
- `desc` (string, 可选): 知识库简介
- `img` (string, 可选): 封面图片 URL，不传使用系统默认封面
- `source` (string, 可选): 创建来源标识，用于业务溯源
- `role_id` (string, 可选): 创建者角色 ID，不传使用默认角色

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "drive_id": "8001234567",
    "group_id": "6200987654",
    "kuid": "0s_8001234567"
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.drive_id` | string | 新建知识库的云盘 ID |
| `data.group_id` | string | 新建知识库的群组 ID |
| `data.kuid` | string | 新建知识库的 kuid，格式 `0s_...` |


---

