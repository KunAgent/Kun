# 获取文件标识指南

大多数工具需要 `file_id` 和 `drive_id` 参数。按用户提供的信息选择定位方式：

`create_file` / `create_file_with_content` / `upload_file`（新建）中 `drive_id`、`parent_id` 的传参规则：
- 可省略：用户未说明目标文件夹。
- 必须传入：用户已说明目标文件夹且已定位到对应 `drive_id`、`parent_id`；能传却省略视为错误。

`download_file` / `rename_file` / `share_file` / `cancel_share` / `copy_file` 的 **`drive_id` 非必填**：**已有明确的 drive_id 则传**，**没有则省略**。

| 用户提供 | 定位方式 |
|---------|---------|
| 文件名/关键词 | `search_files` → 返回结果中包含 `file_id` 和 `drive_id` |
| 文档链接 | `read_file(url=链接)` 返回内容与 `file_id`/`drive_id`；不需读内容时用 `get_share_info(link_id)`（见下方链接解析） |
| 已知 `file_id` | `get_file_info(file_id)` → 补充获取 `drive_id` |
| 创建文件（指定文件夹） | `search_files` 等查到目标文件夹 → 传 `drive_id` + 该文件夹 `file_id` 作为 `parent_id` |
| 创建文件（用户未指定文件夹） | `drive_id`、`parent_id` 可不填，直接 `create_file` / `create_file_with_content` / `upload_file`（新建） |

> 根目录的 `parent_id` 固定为 `"0"`。

#### 文档链接解析

当链接域名为 `365.kdocs.cn` 或 `www.kdocs.cn` 时，按路径格式提取末尾的 `link_id`：

| 路径格式 | 提取规则 |
|---------|---------|
| `/l/<link_id>` | 文件分享链接 |
| `/folder/<link_id>` | 文件夹分享链接 |
| `/view/l/<link_id>` | 文件预览链接 |

提取后调用 `get_share_info(link_id)` 获取 `file_id` 和 `drive_id`。

> **AIPPT 文档转 PPT 快捷方式**：当用户提供金山文档链接并要求生成 PPT 时，从 URL 提取的 `link_id` 可直接以 `type: "link_id"` 传入 `aippt.execute` 的 `input` 数组，无需先调用 `get_share_info` 获取 `file_id`。
