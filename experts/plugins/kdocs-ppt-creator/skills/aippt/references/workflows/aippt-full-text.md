# AI 生成演示文稿（全文）

> aippt.execute 单接口全文生成链路：支持 html（两次调用 + follow_up）和 basic（一次调用，经典简约模式）两种模式，覆盖主题/文档场景

**适用场景**：用户希望通过主题描述或已有文档生成演示文稿。

**触发词**：生成PPT、生成演示文稿、做PPT、做个PPT、文档转PPT、文件转PPT、文档生成PPT、把文档做成PPT、根据文档生成演示文稿、原子化生成PPT、生成全文PPT、生成完整PPT、全文生成演示文稿、做一份完整PPT、生成整套PPT、文档生成完整PPT

**工具链**：用户希望 AI 生成完整 PPT（主题/文档转 PPT） → `aippt.execute`（多轮 SSE 交互，详见 `references/aippt.md`）

## 执行流程

> **前置阅读**：执行前必须阅读 `references/aippt.md` 了解相关工具的使用方法和参数要求。
> 该流程使用 `aippt.execute` 单接口完成 PPT 生成完整链路。
> 调用前需确定两个核心参数：**task_type**（生成来源）和 **mode**（生成模式）。
> 每次调用超时设为 **1800000 毫秒**：--timeout 1800000。

### 参数决策

#### 1. 确定 task_type（根据用户输入判断）

| 场景 | task_type | input |
|---|---|---|
| 用户给出主题/描述，无文档 | `theme_ppt` | `[{type:"text", content:"用户主题"}]` |
| 用户提供了文档链接 | `doc_ppt` | `[{type:"text", content:"根据文档生成PPT"}, {type:"link_id", content:"<link_id>"}]` |

> `link_id`：从金山文档链接路径末尾提取 link_id（如 `https://365.kdocs.cn/l/xxxxx` 中的 `xxxxx`），无需先调用 get_share_info。

#### 2. mode（向用户确认）

| mode | 名称（展示给用户） | 调用次数 | 说明 |
|---|---|---|---|
| `html` | 智能布局模式 | 两次 | 网页智能布局，有 follow_up 问卷交互 |
| `basic` | 经典简约模式 | 一次 | Skill 做风格分类，无 follow_up，一次调用完成全链路 |

向用户展示模式供选择时**仅使用"名称"列的文案**（不要把 `html`/`basic` 这类参数值暴露给用户）。
用户选择后再在内部将其映射回对应的 mode 值。用户未明确指定时默认 `html`。

---

### 执行流程 A：html 模式（两次调用）

```
步骤 0: 向用户确认生成模式（AskQuestion）
        展示文案（不要暴露参数名）：
        → 选项A「智能布局模式」：网页智能布局，适用于数据汇报
        → 选项B「经典简约模式」：经典简约风格，一次生成完成
        用户选择后内部映射：智能布局模式 → mode="html"；经典简约模式 → 走流程 B

步骤 1: aippt.execute(task_type=<场景对应值>, mode=<用户选择的模式>, input=<场景对应input>)
        → SSE 推进到 get_questions.done（need_interaction=true）
        → 从 payload 提取 interaction_type="follow_up"
        → 记录 session_id、checkpoint_id、interrupt_id（恢复调用必须原样回传）

步骤 2: 向用户展示 follow_up 问题（AskQuestion），收集选择
        → choice 题：单选，展示 options，可自定义（allow_custom=true）
        → multi_choice 题：多选
        → text 题：对话确认，可留空
        → 整理为 interaction_response.data.items: [{type, field, label, options/text_input}]

步骤 3: aippt.execute(task_type=<同步骤1>, mode=<同步骤1>, interaction_response={
            type: "follow_up",
            data: {
                session_id: "<来自步骤1>",
                checkpoint_id: "<来自步骤1>",
                interrupt_id: "<来自步骤1>",
                items: [...]
            }
        })
        → SSE 推进：gen_outline.start → gen_outline.done →
          style_generate.start → style_generate.done → gen_ppt.start → gen_ppt.done →
          upload_cloud.start → upload_cloud.done → finish
        → 从 upload_cloud.done payload 的 link_url 字段提取云文档链接，展示给用户
```

---

### 执行流程 B：basic 经典简约模式（一次调用）

> `basic` 模式无需 follow_up 交互，Skill 端先做风格/场景分类，一次调用完成全链路。
> `basic` 模式的 `text` 类型 input 项可额外携带 `scene_tags` 和 `style_tags`。

#### 风格/场景分类（可选）

Skill 用大模型从固定标签列表中分类，一次请求输出 `{"scene": "xxx", "style": "xxx"}`，分别传入 `scene_tags` 和 `style_tags`。不传时后端也能返回通用推荐，只是精准度降低。

**可选场景标签**：财务系统、生产管理、教学课件、毕业答辩、培训课件、企业招聘、企业宣传、企业文化、企业培训、党政党建、政府报告、商业计划书、活动策划、营销计划、行业报告、产品发布会、竞聘述职、通用PPT、总结汇报 等 49 类

**可选风格标签**：简约风、商务风、渐变风、中国风、小清新、可爱卡通、科技风

#### SSE 事件序列（basic）

| 事件类型 | 说明 |
|---|---|
| `auth_check.start` / `.done` | 权限检查 |
| `gen_outline.start` / `.done` | 大纲生成（payload 含 `root_node` 结构化大纲） |
| `get_templates.start` / `.done` | 模板推荐（payload 含 `items` 模板列表） |
| `gen_ppt.start` / `.done` | 幻灯片生成（payload 含 `slide_file_urls`） |
| `upload_cloud.start` / `.done` | 上传云空间（payload 含 `file_id`、`file_name`、`link_url`） |
| `done` | 流程结束，`finish_reason: "stop"` |

```
步骤 0: Skill 风格/场景分类（可选）
        → 用大模型匹配 scene_tags 和 style_tags
        → 如 {"scene": "总结汇报", "style": "商务风"}

步骤 1a（主题场景）: aippt.execute(task_type="theme_ppt", mode="basic", input=[{
          type: "text",
          content: "用户主题",
          scene_tags: ["总结汇报"],
          style_tags: ["商务风"]
        }])
        → auth_check → gen_outline（~15-20s）→ get_templates → gen_ppt（~20-30s）→ upload_cloud → done

步骤 1b（文档场景）: aippt.execute(task_type="doc_ppt", mode="basic", input=[
          {type: "text", content: "根据文档生成PPT", scene_tags: ["总结汇报"], style_tags: ["商务风"]},
          {type: "link_id", content: "<link_id>"}
        ])
        → auth_check → gen_outline（~30-40s，需解析文档）→ get_templates → gen_ppt（页数取决于文档长度，~60-90s）→ upload_cloud → done

步骤 2: 从 upload_cloud.done payload 提取 link_url，展示给用户
```
