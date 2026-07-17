# kwiki.delete_item

## 1. kwiki.delete_item

#### 功能说明

删除后进入知识库回收站，7 天内可通过 restore_deleted_file 恢复。支持删除文件夹（包括非空文件夹，会连带删除内部所有内容）。


#### 操作约束

- **前置检查**：`kwiki.list_items` 确认对象名称和位置
- **用户确认**：删除操作不可逆（非空文件夹会连带删除），必须向用户确认

**幂等性**：否 — 不可恢复操作，禁止自动重试

> 仅支持单个删除，批量清理时需循环调用
> 删除后进入知识库回收站，7 天内可通过 `restore_deleted_file(file_id=...)` 恢复
> **也支持删除文件夹**（包括空文件夹和非空文件夹），非空文件夹会连带删除内部所有内容

#### 调用示例

删除指定条目：

```json
{
  "kuid": "0lPqRs8WxYzAbC"
}
```


#### 参数说明

- `kuid` (string, 必填): 待删除文件或文件夹的 kuid

#### 返回值说明

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "message": "文件已移至回收站，7天内可恢复",
    "trash_url": "https://www.kdocs.cn/enttrash/0"
  }
}

```

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.message` | string | 操作结果描述 |
| `data.trash_url` | string | 回收站页面链接 |


---

