# 个人知识库（kwiki）工具完整参考文档

本文件说明金山文档 Skill 中个人知识库相关的 `kwiki.*` 工具如何使用。它们面向"知识库空间"和"知识库内资料管理"场景，适合创建知识库、浏览库内目录、导入已有云文档，以及整理知识库中的文件和文件夹。

## 通用说明

### 何时使用 `kwiki.*`

- 需要新建一个个人知识库或资料库空间
- 需要查询已有知识库列表，或按名称/ID 获取某个知识库详情
- 需要浏览知识库根目录或某个知识库文件夹下的资料
- 需要把**已有云文档**导入知识库
- 需要在知识库里新建文件夹或在线文件，并对库内资料做删除、下载

### 特别说明

> - 仔细阅读接口参数说明，不猜测，不胡编乱造
> - 本地上传不走 `kwiki.*`

### 链接输出规范

接口返回的数据中，`url` 字段为**相对路径**（如 `/l/xxx?source=kmwiki` 或 `/wiki/l/xxx`），`kuid`字段为**知识库/文件夹/文件id**。**Agent 在拼接完整链接时，必须遵循以下规则，不猜测：**

1. **拼接规则**：`https://www.kdocs.cn` + `data.url 原值`。
2. **手动构造**：若接口未返回 `url` 但返回了 `kuid`，格式为 `https://www.kdocs.cn/wiki/l/${kuid}`。

### 标识说明

在 `kwiki.*` 场景里，常见会用到以下标识：

- `drive_id`: 知识库对应的云盘 ID
- `group_id`: 知识库所属组 ID
- `kuid`: 知识库或知识库内文件/文件夹的标识

经验上：

- 知识库本身的 `kuid` 常见为 `0s...`
- 知识库内文件夹/文件的 `kuid` 常见为 `0l...`

如果用户只给了知识库名称，通常先用 `kwiki.list_knowledge_views` 搜，再把返回的 `drive_id` / `group_id` / `kuid` 传给后续工具。

> **注意**： `kuid` 仅用于 kwiki 专属操作（`delete_item`/`import_cloud_doc` 等）。

---

## 一、知识库空间

> 知识库空间的创建、查询、更新、关闭

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`kwiki.create_knowledge_view`](kwiki/create_knowledge_view.md) | 创建个人知识库 | `space_name`, `status` |
| [`kwiki.list_knowledge_views`](kwiki/list_knowledge_views.md) | 查询知识库列表 |  |
| [`kwiki.get_knowledge_view`](kwiki/get_knowledge_view.md) | 获取单个知识库详情 | `drive_id`\|`name` |
| [`kwiki.update_knowledge_view`](kwiki/update_knowledge_view.md) | 修改知识库基础配置 | `drive_id`, `cover_img`, `status` |
| [`kwiki.close_knowledge_view`](kwiki/close_knowledge_view.md) | 关闭（删除）知识库 | `drive_id` |

## 二、库内资料

> 空间内文件夹与文件的浏览、创建、删除、从云盘导入

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`kwiki.list_items`](kwiki/list_items.md) | 列出知识库目录下的内容 | `kuid` |
| [`kwiki.import_cloud_doc`](kwiki/import_cloud_doc.md) | 将已有云文档导入知识库 | `kuid`, `file_infos` |
| [`kwiki.create_item`](kwiki/create_item.md) | 在知识库中创建文件或文件夹 | `doc_type`, `kuid`, `title` |
| [`kwiki.delete_item`](kwiki/delete_item.md) | 删除知识库中的文件或文件夹 | `kuid` |

## 错误速查表

> ⛔ **强制规则**：命中下方任一错误条目时，**必须立即按「处理方式」向用户提示，禁止尝试其他接口绕过或反复重试。**

| 错误特征 | 原因 | 处理方式 |
|----------|------|----------|
| `code: 403000006`，`msg: "当前版本仅支持个人用户"` | 当前登录的是企业/团队账号，该知识库接口仅对个人账号开放 | 提示用户切换至个人账号后重试 |
| `conflict` / `lock` / 写入冲突 | 并发操作同一知识库节点（如同时创建/移动/删除兄弟节点）导致锁竞争 | 指数退避重试（2s → 4s → 8s，最多 3 次）；批量操作兄弟节点时改为串行逐条执行 |
