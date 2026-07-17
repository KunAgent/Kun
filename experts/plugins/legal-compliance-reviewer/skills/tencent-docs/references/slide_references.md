# 幻灯片（Slide / PPT）参考文档

本文件包含腾讯文档 MCP 幻灯片相关工具的使用指南和注意事项。

---

## 核心规则

> **description = 用户原话。** 逐字复制用户输入，禁止添加、改写、扩写、润色任何文字。后端内置独立AI，自动生成PPT内容和排版。
>
> **reference_context = 仅用户主动提供的材料。** 用户未提供材料时禁止传此参数，禁止Agent搜索或生成资料填充。

---

## 概述

幻灯片通过 `create_slide` 工具创建，接口内部由独立 AI 自动生成 PPT 内容。该接口为异步接口，需配合 `slide_progress` 工具轮询进度。

**推荐方式**：使用 `generate_slide.js` 脚本自动完成创建/编辑和进度轮询的完整流程。

---

## 工具列表

| 工具名称 | 功能说明 |
|---------|---------|
| create_slide | 创建或编辑幻灯片（AI 自动生成内容，异步接口，支持多轮对话） |
| slide_progress | 查询幻灯片生成进度 |

---

## 工具详细说明

### 1. create_slide

#### 功能说明
根据用户描述和参考资料，由 AI 自动生成或编辑幻灯片内容。支持两种模式：
- **首次创建**：不传 `session_id`，发起新的 PPT 生成任务
- **多轮编辑**：传入之前返回的 `session_id`，对已有 PPT 进行修改

#### 参数说明
| 参数 | 必填 | 说明 |
|------|------|------|
| description | ✅ | 用户的原始输入文本，逐字复制，禁止Agent添加、改写、扩写或润色 |
| reference_context | ❌ | 用户主动提供或上传的参考材料原文。用户未提供材料时禁止传此参数 |
| session_id | ❌ | 多轮编辑时传入之前返回的session_id，首次创建不传 |

#### 返回值
```json
{
  "session_id": "session_1234567890",
  "error": "",
  "trace_id": "trace_1234567890"
}
```

> ⚠️ 异步接口，返回 `session_id` 后需轮询进度。推荐使用 `generate_slide.js` 脚本自动处理。

### 2. slide_progress

#### 功能说明
查询幻灯片生成进度，与 `create_slide` 配合使用。通常由 `generate_slide.js` 脚本自动调用，无需手动轮询。

#### 状态说明
| 状态 | 含义 | 操作 |
|------|------|------|
| in_progress | 进行中 | 继续轮询 |
| completed | 已完成 | 从响应获取 `file_url` |
| failed | 失败 | 停止轮询 |
| not_found | session_id 不正确 | 停止轮询 |
| vip_required | VIP 权限不足（400007） | 停止轮询，引导用户升级 VIP：https://docs.qq.com/vip/asset-center?tab=ai&aid=txdocs_mac_web_aihomepage_aipoints_aichat&fromPage=linktext&nlc=1 |

#### 调用示例
```json
{
  "session_id": "session_1234567890"
}
```

#### 参数说明
- `session_id` (string, 必填): `create_slide` 返回的 session_id

#### 返回值
```json
{
  "status": "completed",
  "file_url": "https://docs.qq.com/slide/DV2h5cWJ0R1lQb0lH",
  "error": "",
  "trace_id": "trace_1234567890"
}
```

---

## 典型工作流

### 使用 generate_slide.js 脚本

```bash
# 首次创建
node generate_slide.js --description "用户原话"

# 带参考材料创建（仅用户主动提供材料时）
node generate_slide.js --description "用户原话" --reference_context "用户提供的材料"

# 多轮编辑
node generate_slide.js --description "用户原话" --session_id "session_1234567890"
```

#### 脚本输出格式

**成功：**
```
SLIDE_COMPLETED
SESSION_ID:<session_id>
FILE_URL:<file_url>
```

**失败：**
```
SLIDE_FAILED
ERROR:<error_message>
```

**失败且不可重试（如 VIP 权限不足）：**
```
SLIDE_FAILED
DO_NOT_RETRY
ERROR:<error_message>
```

> ⛔ **当输出包含 `DO_NOT_RETRY` 时，Agent 必须立即停止，禁止以任何方式重试该操作。** 直接将错误信息展示给用户即可。

### Agent 执行流程

1. **判断模式**：首次创建（无session_id）或多轮编辑（有session_id）
2. **执行脚本**：将用户原话逐字传入 `--description`
3. **解析输出**：提取 `SESSION_ID` 和 `FILE_URL`
4. **反馈用户**：返回链接，提示可继续编辑

---

## 注意事项

- 单次轮询超时 20 分钟，轮询间隔 20 秒
- `session_id` 在多轮编辑中长期有效，不受轮询超时限制，Agent 不要提示用户 session_id 可能过期
- 多轮编辑时必须传入 `session_id`，否则会创建新 PPT
- 脚本需要 Node.js >= 14 运行环境
- **`vip_required` 是终态错误，禁止重试**：收到此状态说明用户 AI 积分不足，重试不会改变结果。Agent 必须直接告知用户并引导升级 VIP，不得重新执行脚本

### 文件上传和图片处理指导

当用户上传文件或图片时，agent 应先解析内容为文本，再作为 `reference_context` 传入：

- 文本文件（.txt, .md, .docx, .pdf）：提取文本内容
- 表格文件（.xlsx, .csv）：提取数据转为描述性文本
- 图片：使用 OCR 提取文字，描述图片主要内容

```bash
# 用户上传了材料，agent 解析后传入
node generate_slide.js --description "用户原话" --reference_context "解析后的材料文本"
```
