# kwiki.get_knowledge_view

## 1. kwiki.get_knowledge_view

#### 功能说明

根据 drive_id 或名称查询单个知识库的详细信息。drive_id 与 name 至少提供其一。


> 如果用户同时给了名称和 ID，优先用 ID
> 若名称匹配到多个知识库，需结合返回结果进一步确认目标知识库

#### 调用示例

按 drive_id 查询：

```json
{
  "drive_id": "8001234567",
  "group_id": "6200987654"
}
```

按名称查询：

```json
{
  "name": "销售知识库"
}
```


#### 参数说明

- `drive_id` (string, 二选一必填: `drive_id` / `name`): 条件必填：已知知识库云盘 ID 时直接传（来自 `list_knowledge_views` / `create_knowledge_view` 返回值）。与 name 至少填其一
- `name` (string, 二选一必填: `drive_id` / `name`): 条件必填：仅知道名称时传入，模糊匹配。与 drive_id 至少填其一
- `group_id` (string, 可选): 知识库所属群组 ID（来自 `list_knowledge_views` / `create_knowledge_view` 返回值），已知时建议一并传入

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "drive_id": "8001234567",
    "group_id": "6200987654",
    "kuid": "0s_8001234567",
    "space_name": "销售知识库",
    "desc": "沉淀销售话术、案例和培训资料",
    "cover_img": "https://cdn.example.com/2025/06/09/other/7.png",
    "file_total": 12,
    "member_total": 1,
    "utime": 1775221117,
    "owner": {
      "id": 900012345,
      "name": "张三",
      "avatar": "https://img.example.com/avatar/default"
    }
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.drive_id` | string | 知识库云盘 ID |
| `data.group_id` | string | 群组 ID |
| `data.kuid` | string | 知识库唯一标识，格式 `0s_...`，用于构造访问链接：`https://www.kdocs.cn/wiki/l/{kuid}` |
| `data.space_name` | string | 知识库名称 |
| `data.desc` | string | 知识库描述 |
| `data.cover_img` | string | 封面图片 URL |
| `data.file_total` | number | 文档总数 |
| `data.member_total` | number | 成员总数 |
| `data.utime` | number | 最近更新时间（Unix 时间戳，秒） |
| `data.owner` | object | 知识库所有者信息，含 id / name / avatar |


---

