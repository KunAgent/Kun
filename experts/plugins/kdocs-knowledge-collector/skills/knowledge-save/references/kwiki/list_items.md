# kwiki.list_items

## 1. kwiki.list_items

#### 功能说明

列出知识库根目录或某个文件夹下的内容，返回文件和文件夹混合列表。


> 浏览知识库根目录或进入某个文件夹后继续查看下一级内容
> 为后续移动、删除、下载收集 `kuid`

#### 调用示例

列出根目录内容：

```json
{
  "kuid": "0s_8002345678"
}
```


#### 参数说明

- `kuid` (string, 必填): 知识库 kuid（格式 `0s_...`，来自 `list_knowledge_views` / `get_knowledge_view`）或文件夹 kuid（来自 `list_items`）

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "has_more": false,
    "list": [
      {
        "kuid": "0lAbCdE1234fGH",
        "file_id": "100200300401",
        "title": "产品需求文档",
        "doc_type": "o",
        "doc_origin_type": "otl",
        "link_id": "AbCdE1234fGH",
        "ctime": 1775221153,
        "size": 28175,
        "parent_id": "0",
        "creator": {
          "id": 900012345,
          "name": "张三",
          "avatar": "https://img.example.com/avatar/default"
        }
      },
      {
        "kuid": "0lXyZw7KLmN1pQ",
        "file_id": "100200300402",
        "title": "培训材料",
        "doc_type": "folder",
        "doc_origin_type": "",
        "link_id": "XyZw7KLmN1pQ",
        "ctime": 1775221152,
        "size": 0,
        "parent_id": "0",
        "creator": {
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
| `data.list` | array | 目录项列表 |
| `data.has_more` | boolean | 是否有更多项 |
| `data.next_page_token` | string | 下一页 token，为空表示无更多页 |

**items 条目字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `kuid` | string | 知识库内唯一标识，**kwiki 操作（delete_item/import_cloud_doc）均使用此 ID** |
| `file_id` | string | 云文档系统 file_id |
| `title` | string | 文件/文件夹名称（不含扩展名） |
| `doc_type` | string | 类型：`o`=智能文档, `w`=Word, `p`=PPT, `s`=Excel, `i`=图片, `v`=视频, `folder`=文件夹 |
| `link_id` | string | 分享链接标识，可通过 `get_file_link(link_id=...)` 获取在线链接 |
| `ctime` | integer | 创建时间（Unix 时间戳，秒） |
| `size` | integer | 文件大小（字节） |

> ⚠️ **注意**：`kwiki.list_items` 不返回 `mtime`（修改时间）。如需按修改时间筛选，
> 使用 `list_files(drive_id=知识库drive_id, parent_id=file_id, page_size=500, order_by="mtime")` 获取 `mtime` 信息。


---

