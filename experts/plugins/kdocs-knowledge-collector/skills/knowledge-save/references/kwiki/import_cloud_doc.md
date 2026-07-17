# kwiki.import_cloud_doc

## 1. kwiki.import_cloud_doc

#### 功能说明

把已有云文档导入到知识库中，可导入副本或快捷方式。这是「导入已有云文档」工具，不是「上传本地文件」工具。


#### 操作约束

- **后置验证**：`kwiki.list_items` 确认文档已导入

**幂等性**：否 — 重复调用会导入多份，先确认是否已成功

> 如果用户提供的是本地文件内容，应改用 `upload_file`

#### 调用示例

复制导入云文档：

```json
{
  "action": "copy",
  "kuid": "0s_8002345678",
  "file_infos": [
    {
      "file_ids": [
        100200300403
      ],
      "group_id": 6200987654
    }
  ]
}
```


#### 参数说明

- `kuid` (string, 必填): 目标知识库 kuid（格式 `0s_...`）或知识库内文件夹 kuid，来自 `list_knowledge_views` / `list_items`
- `action` (string, 可选): 导入方式，copy 为副本，shortcut 为快捷方式。可选值：`copy` / `shortcut`；默认值：`copy`
- `file_infos` (array[object], 必填): 待导入云文档列表，每项含 `file_ids`（云文档 file_id 数组）和 `group_id`（文档所属群组 ID）

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "url": "/wiki/l/0s_8001234567"
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.url` | string | 知识库相对路径，拼接 `https://www.kdocs.cn` + url 得到完整链接 |


---

