# AI PPT（aippt）工具完整参考文档

本文件包含金山文档 Skill 中 **AI PPT** 相关工具的使用指南。

**适用范围**：`aippt.execute` 通用技能路由接口，支持通过主题描述或已有文档生成演示文稿。

---

## 通用说明

### AI PPT 工具概述

AI PPT 仅包含一个通用接口 `aippt.execute`，通过 `task_type` 参数路由到不同的生成流水线：

| task_type | 场景 | input 构成 |
|---|---|---|
| `theme_ppt` | 用户给出主题描述，AI 联网研究后生成 | `[{type:"text", content:"主题"}]` |
| `doc_ppt` | 用户提供文档（链接 / link_id），基于文档内容生成 | `[{type:"text", content:"指令"}, {type:"link_id", content:"<link_id>"}]` |

### 关键行为

- 每次调用返回 SSE 流，当步骤事件携带 `need_interaction: true` 时 SSE 关闭，需收集用户输入后再次调用
- `input` 与 `interaction_response` 互斥，不同时传
- 最终结果提取方式：从 `upload_cloud.done` payload 的 `link_url` 字段获取
- 每次调用超时设为 1800000 毫秒：--timeout 1800000

### 文档引用方式

文档转 PPT 场景下，`input` 数组中的文档引用使用 `link_id`（从金山文档链接路径末尾提取的 link_id，无需先调 `get_share_info`）。

---

## 一、PPT 生成

### 1. aippt.execute

#### 功能说明

`aippt.execute` 是 AI PPT 的**通用技能路由接口**，通过 `task_type` 参数路由到不同的生成流水线。

**已支持的能力：**

| task_type | 名称 | 场景 |
|---|---|---|
| `theme_ppt` | 主题生成 PPT | 用户输入一句话主题，AI 联网研究后生成 |
| `doc_ppt` | 文档生成 PPT | 用户已有文档（金山文档链接 / link_id），AI 基于文档内容生成 |
| `single_page` | 单页生成幻灯片 | 用户输入主题，AI 生成单页 HTML 幻灯片 |

**调用协议：**

每次调用返回一个 SSE 流，推送若干步骤事件（`*.start` / `*.done`）。
当某个事件携带 `need_interaction: true` 时，SSE 流关闭，调用方
收集用户输入后通过 `interaction_response` 发起下一次调用。
如此循环，直到 `*.done` 事件携带最终结果。

不同能力的调用次数不同：有的能力一次调用即可完成，有的需要多轮交互。
具体的调用次数、`input` 内容、`interaction_response` 结构、
以及中间步骤序列，均由各能力自行定义，详见 `response_detail`。

- 每次调用超时设为 1800000 毫秒
- 最后的 `*.done` 事件携带最终生成结果：从 `upload_cloud.done` 取 `link_url`



#### 操作约束

- **前置检查**：首次调用必须明确选择 task_type，并按该 skill 的交互事件继续恢复调用
- **提示**：收到 need_interaction=true 时先收集用户答案，再发起下一次调用，避免空恢复请求

**幂等性**：否 — 为流式生成任务，重复调用可能创建重复产物；重试前先确认是否已有进行中或已完成结果

> `input` 与 `interaction_response` 互斥，不同时传
> SSE 流中 `need_interaction: true` 出现时，记录 payload 后等待用户输入，再次调用
> 最终结果从 `upload_cloud.done` payload 的 `link_url` 字段获取云文档链接
> `mode` 参数在首次和恢复调用中保持一致

#### 调用示例

首次调用 — 主题生成：

```json
{
  "task_type": "theme_ppt",
  "mode": "html",
  "input": [
    {
      "type": "text",
      "content": "长颈鹿主题的儿童科普 PPT"
    }
  ]
}
```

首次调用 — 文档生成：

```json
{
  "task_type": "doc_ppt",
  "mode": "html",
  "input": [
    {
      "type": "text",
      "content": "根据文档生成PPT"
    },
    {
      "type": "link_id",
      "content": "co4Kyv9Ofayq"
    }
  ]
}
```

单页生成幻灯片 — 一次调用完成：

```json
{
  "task_type": "single_page",
  "mode": "html",
  "input": [
    {
      "type": "text",
      "content": "人工智能"
    }
  ],
  "options": {
    "width": 1280,
    "height": 720
  }
}
```

原子化全文生成 — 主题生成（mode=basic，含风格分类标签）：

```json
{
  "task_type": "theme_ppt",
  "mode": "basic",
  "input": [
    {
      "type": "text",
      "content": "AI发展趋势",
      "scene_tags": [
        "总结汇报"
      ],
      "style_tags": [
        "科技风",
        "商务风"
      ]
    }
  ]
}
```

原子化全文生成 — 文档生成（mode=basic，含风格分类标签）：

```json
{
  "task_type": "doc_ppt",
  "mode": "basic",
  "input": [
    {
      "type": "text",
      "content": "根据文档生成PPT",
      "scene_tags": [
        "行业报告"
      ],
      "style_tags": [
        "商务风"
      ]
    },
    {
      "type": "file_id",
      "content": "100239253236"
    }
  ]
}
```

恢复调用 — 提交 follow_up 答案（所有 task_type 通用，下面以 doc_ppt，mode 为 html 为例）：

```json
{
  "task_type": "doc_ppt",
  "mode": "html",
  "interaction_response": {
    "type": "follow_up",
    "data": {
      "session_id": "9dbea4d8-b9f7-419c-a4ad-208d4515b8d5",
      "checkpoint_id": "419e8c77-5442-459e-87eb-2637ba53e132",
      "interrupt_id": "45caf5dc-2dd4-48a7-9ba3-8ba2edc67cdd",
      "items": [
        {
          "type": "choice",
          "field": "制作目标",
          "label": "制作目标",
          "options": [
            "内部技术培训宣讲"
          ]
        },
        {
          "type": "multi_choice",
          "field": "重点方面",
          "label": "重点方面",
          "options": [
            "生物特性",
            "文化关联"
          ]
        },
        {
          "type": "text",
          "field": "补充说明",
          "label": "补充说明",
          "text_input": "重点突出接入步骤"
        }
      ]
    }
  }
}
```


#### 参数说明

- `task_type` (string, 必填): 技能类型，决定执行哪条生成流水线。
枚举值：`theme_ppt`（主题生成 PPT）/ `doc_ppt`（文档生成 PPT）/ `single_page`（单页生成幻灯片）

- `mode` (string, 可选): 生成模式。`html`（HTML 渲染）/ `basic`（经典简约模式，一次调用完成）。默认 `html`

- `input` (array[object], 可选): 技能输入内容数组，每项为 `{type, content, ...}` 对象。与 `interaction_response` 互斥。
type 枚举：
- `text`：文本指令或主题描述
- `link_id`：从金山文档链接提取的 link_id

当 `mode` 为 `basic` 时，`text` 类型的 input 项可额外携带：
- `scene_tags`：场景标签数组，如 `["总结汇报"]`
- `style_tags`：风格标签数组，如 `["科技风", "商务风"]`（可多选）

- `interaction_response` (object, 可选): 用户对交互问卷的回答，与 `input` 互斥。
结构固定为 `{type, data}`，其中 `type` 和 `data` 的内容因 skill 而异，
详见 `response_detail` 中各 skill 的说明。

- `options` (object, 可选): 生成选项。当 `task_type` 为 `single_page` 时必须传入，固定为 `{"width": 1280, "height": 720}`。


#### 返回值说明

```json
// 最终结果在 upload_cloud.done：
{
  "id": "skill-xxx",
  "delta": {
    "type": "upload_cloud.done",
    "payload": {
      "file_id": "100249092919",
      "file_name": "AI发展趋势.pptx",
      "link_url": "https://www.kdocs.cn/l/clq08Q2vM2Ec"
    }
  },
  "is_partial": false
}

```

SSE 流通过 `message` 事件推送步骤状态，最终以 `finish` 事件结束。
当某步骤事件携带 `need_interaction: true` 时，SSE 流关闭，需要收集用户输入后再次调用。

---


## 工具速查表

| # | 工具名 | 分类 | 功能 | 必填参数 |
|---|--------|------|------|----------|
| 1 | `aippt.execute` | generate | AI PPT 通用执行接口，按 task_type 路由生成 | `task_type` |

## 附录

### 错误处理

| 情况 | 说明 |
|------|------|
| SSE error 事件 | 包含错误码和描述，检查 task_type 和 input 参数是否正确 |
| 超时 | 单次调用上限 1800000 毫秒，超时需重新发起 |
