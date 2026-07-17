# automation_update 字段全解

本文件是给 skill 在调用 `automation_update` 工具时的"字段说明书"。
所有定时任务的创建、修改、查看、删除，**必须**通过该工具，**禁止**直接操作底层数据库文件或任何 sqlite/文件系统操作。

---

## 一、五种 mode

| mode | 用途 | 必填字段 |
|------|------|----------|
| `list` | 列出所有定时任务（摘要） | 无 |
| `view` | 查看一条任务的完整配置 | `id` |
| `create` | 新建任务 | `name`, `prompt`, `scheduleType`, (rrule 或 scheduledAt) |
| `update` | 修改任务 | `id`，其他字段按需 |
| `delete` | 软删除任务 | `id` |

---

## 二、字段总表

| 字段 | 类型 | 必填条件 | 说明 |
|------|------|----------|------|
| `id` | string | view/update/delete | 任务唯一标识，由系统返回 |
| `name` | string | create | 用户可见名称，多个任务建议带时间后缀 |
| `prompt` | string | create | 触发时投喂给 agent 的指令文本 |
| `scheduleType` | "once" \| "recurring" | create | 默认 recurring |
| `rrule` | string | recurring 时必填 | RFC 5545 RRULE，见 rrule-cookbook.md |
| `scheduledAt` | ISO 8601 | once 时必填 | 例：`2026-06-15T14:30` |
| `cwds` | string | 可选 | 工作目录列表，多个用逗号分隔 |
| `validFrom` | ISO 8601 | 可选 | 任务在此日期之前不会触发 |
| `validUntil` | ISO 8601 | 可选 | 任务在此日期之后不会触发 |
| `status` | "ACTIVE" \| "PAUSED" | 可选 | update 时可改，默认 ACTIVE |
| `connectorIds` | string[] | 可选 | 执行时需要激活的 MCP 连接器 |
| `expertId` | string | 可选 | 执行时绑定的专家身份 |
| `modelId` | string | 可选 | 指定执行模型 |
| `modelIsThinking` | boolean | 可选 | 是否启用思考模式 |

---

## 三、prompt 字段写作规则

### 应该这么写
- 直接写"做什么"："总结今天 GitHub 上我参与的 PR，按仓库分组列出未回复的评论。"
- 必要的输入指令："读取工作目录下今天日期的 markdown 文件，提取 TODO，按优先级排序。"
- 输出去向（如果需要推送）：由用户在 configurable 中提供 webhook，再以占位符形式注入 prompt。**禁止**在模板里硬编码任何个人 Webhook / Token。

### 不要这么写
- ❌ 别写时间："每天 9 点帮我..." —— 时间归 rrule 管。
- ❌ 别写"如果没数据就不输出" —— 让 agent 自然处理无内容场景。
- ❌ 别塞超长上下文 —— prompt 是触发指令，不是知识库；要长内容请引用文件。

---

## 四、cwds 的语义

- 单工作区：`/Users/me/projects/my-project`
- 多工作区：`/Users/me/projects/a,/Users/me/projects/b`
- 不填：使用任务创建时所处的工作区
- 任务执行时，agent 会在这些目录中获得 read/write 权限（按平台规则）

---

## 五、删除规则

- `mode=delete` 是**软删除**：从 list / view 视图中消失，但底层记录保留可恢复。
- **绝对禁止**用以下方式删除：
  - 任何形如 `rm <数据库文件>` 的命令
  - 任何 `sqlite3 ... "DELETE FROM ..."` 操作
  - 任何文件系统操作
- 批量删除：循环调用 `mode=delete`，每次一条 id，不要尝试在一次调用里删多个。
