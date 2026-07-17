# kwiki.create_item

## 1. kwiki.create_item

#### 功能说明

在指定父级 kuid 下新建文件夹或指定类型的云文档。


#### 操作约束

- **后置验证**：`kwiki.list_items` 确认创建成功

**幂等性**：否 — 重复调用会创建多个条目，先确认是否已成功

> 传知识库 `kuid` 则创建在根目录，传文件夹 `kuid` 则创建在该文件夹下

#### 调用示例

创建文件夹：

```json
{
  "doc_type": "folder",
  "kuid": "0s_8002345678",
  "title": "培训材料"
}
```

创建文字文档：

```json
{
  "doc_type": "w",
  "kuid": "0l_parent_xxx",
  "title": "销售常见问题"
}
```


#### 参数说明

- `doc_type` (string, 必填): 文档类型。可选值：`folder` / `w` / `s` / `o` / `p` / `d`
  - `folder`=文件夹
  - `w`=在线文字
  - `s`=表格
  - `o`=智能文档
  - `p`=演示文稿
  - `d`=轻维表
- `kuid` (string, 必填): 目标知识库或目标文件夹 kuid——传知识库 kuid（`0s_...`）创建在根目录，传文件夹 kuid 创建在该文件夹下
- `title` (string, 必填): 新建文件或文件夹的标题名称

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "kuid": "0lXyZw7KLmN1pQ",
    "title": "培训材料",
    "url": "/l/XyZw7KLmN1pQ?source=kmwiki"
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.kuid` | string | 新建项的 kuid |
| `data.title` | string | 新建项标题 |
| `data.url` | string | 相对路径，拼接 `https://www.kdocs.cn` + url 得到完整链接 |


---

