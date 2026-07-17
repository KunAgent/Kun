# kwiki.list_knowledge_views

## 1. kwiki.list_knowledge_views

#### 功能说明

分页查询当前用户的个人知识库列表，支持按关键字过滤。


> 用户只提供了知识库名称时，先用它来定位知识库
> 需要列出某人当前有哪些知识库

#### 调用示例

按关键字分页查询：

```json
{
  "keyword": "销售",
  "page_size": 20
}
```


#### 参数说明

- `keyword` (string, 可选): 搜索关键字，匹配知识库名称；不传则返回全部
- `page_size` (number, 可选): 每页返回条数，不传则使用服务端默认值
- `page_token` (string, 可选): 分页 token，首次请求不传；后续页传上一次返回的 `next_page_token`

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "has_more": false,
    "list": [
      {
        "drive_id": "8001234567",
        "group_id": "6200987654",
        "kuid": "0s_8001234567",
        "space_name": "销售知识库",
        "desc": "沉淀销售话术、案例和培训资料",
        "cover_img": "https://cdn.example.com/2025/06/09/other/1.png",
        "file_total": 12,
        "member_total": 1,
        "utime": 1775221117,
        "owner": {
          "id": 900012345,
          "name": "张三",
          "avatar": "https://img.example.com/avatar/default"
        }
      }
    ],
    "next_page_token": ""
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.list` | array[object] | 知识库摘要列表 |
| `data.has_more` | boolean | 是否有更多页 |
| `data.next_page_token` | string | 下一页 token，为空表示无更多页 |


---

