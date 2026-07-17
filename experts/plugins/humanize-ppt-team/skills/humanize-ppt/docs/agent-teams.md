# Humanize PPT Agent Teams

## 结论

Humanize PPT 的下一阶段不是把更多 PPT 工具塞进一个 Skill，而是做成一个 **Agent Teams Orchestrator**。

Humanize PPT Agent 是主 Agent。它加载 `humanize-ppt` Skill，负责 AST 大纲、任务拆解、路由决策、产物验收和交付编排。下游每个专门 Agent 加载一个明确的 Skill，只负责自己的那一段工作。

```text
Humanize PPT Agent / Main Orchestrator
→ Guizang Agent / 中文稳定
→ Zara Agent / 风格探索 + HTML 生成 + 上线
→ HyperFrames Agent / 视频片段
→ Presenter Agent / 演讲模式
→ QA Agent / 内容、视觉、路径、交付检查
```

这能解释清楚：Humanize PPT 不是 PPT 模板合集，而是控制 Agent Team 干活的主控层。

---

## 1. 主 Agent：Humanize PPT Agent

### 加载 Skill

```text
humanize-ppt
```

### 职责

Humanize PPT Agent 不直接承担所有生成任务。它负责：

1. 读取原始资料；
2. 按 AST 理论生成观众状态转移路径；
3. 输出标准生产契约；
4. 判断应该调用哪些 Skill Agent；
5. 给每个子 Agent 下发明确命令；
6. 汇总产物；
7. 做最终 QA；
8. 决定是否进入演讲模式、上线或导出。

### 输入

```text
source.md / doc / pdf / transcript / old slides
```

### 输出

```text
workdir/
  deck_brief.md
  ast_outline.md
  slide_plan.json
  speaker_intent.md
  asset_manifest.md
  video_slots.json
  router_plan.json
  run_manifest.json
```

---

## 2. 子 Agent 分工

## 2.1 Guizang Agent：中文稳定

### 加载 Skill

```text
guizang-ppt-skill
```

### 适合任务

- 中文内容稳定成稿；
- 中文标题和排版优先；
- 不需要太多视觉方向探索；
- 需要快速得到可讲的 HTML PPT。

### 接收输入

```text
slide_plan.json
speaker_intent.md
asset_manifest.md
```

### 输出

```text
outputs/guizang/
  index.html
  assets/
  render_report.md
```

---

## 2.2 Zara Agent：风格探索 + HTML 生成 + 上线

### 加载 Skill

```text
frontend-slides
# 或同作者 Zara templates 相关能力
```

### 适合任务

- 多视觉方向预览；
- 模板探索；
- 更强传播感；
- 需要上线或导出完整 HTML。

### 接收输入

```text
slide_plan.json
style_brief.md
asset_manifest.md
```

### 输出

```text
outputs/zara/
  directions/
    direction-a/index.html
    direction-b/index.html
    direction-c/index.html
  selected/index.html
  deploy_url.txt
  render_report.md
```

---

## 2.3 HyperFrames Agent：视频片段

### 加载 Skill

```text
hyperframes / video generation workflow
```

### 适合任务

- 页面中需要动态解释；
- 中间插入视频；
- 需要把某个流程做成短动效；
- 需要为 PPT 准备 video slots。

### 接收输入

```text
video_slots.json
asset_manifest.md
style_brief.md
```

### 输出

```text
outputs/hyperframes/
  videos/
  poster_frames/
  video_report.md
```

---

## 2.4 Presenter Agent：演讲模式

### 加载 Skill

```text
html-ppt-skill
# 或 presenter-adapter runtime
```

### 适合任务

- PPT 已经定稿；
- 需要当前页/下一页；
- 需要 speaker notes；
- 需要计时器和演讲控制；
- 需要 audience view / speaker view 分离。

### 关键原则

> 演讲模式不是一种 PPT 风格，而是 PPT 定稿后的增强层。

### 接收输入

```text
selected_deck/index.html
speaker_intent.md
slide_plan.json
```

### 输出

```text
outputs/presenter/
  index.html
  notes.json
  presenter_report.md
```

---

## 2.5 QA Agent：质检与交付

### 加载 Skill

```text
humanize-ppt
# 可叠加 requesting-code-review / visual QA / deployment checks
```

### 职责

- 检查 AST 是否被保留；
- 检查页面是否塞入模型推理噪音；
- 检查中文标题是否自然；
- 检查文字是否溢出；
- 检查视频路径、图片路径；
- 检查 presenter 是否能打开；
- 检查 deploy URL 是否 200。

### 输出

```text
outputs/qa/
  qa_report.md
  fix_list.md
  final_manifest.json
```

---

## 3. Router Plan

主 Agent 生成 `router_plan.json`，决定每个子 Agent 是否运行。

示例：

```json
{
  "source": "examples/02-hermes-install-guide/source.md",
  "goal": "做成适合讲解 Hermes 安装逻辑的 PPT",
  "routes": [
    {
      "agent": "guizang-agent",
      "skill": "guizang-ppt-skill",
      "purpose": "生成中文稳定版"
    },
    {
      "agent": "zara-agent",
      "skill": "frontend-slides",
      "purpose": "生成三个风格探索方向并准备上线"
    },
    {
      "agent": "presenter-agent",
      "skill": "html-ppt-skill",
      "purpose": "在最终选定的 deck 外层增加演讲者模式"
    },
    {
      "agent": "qa-agent",
      "skill": "humanize-ppt",
      "purpose": "验收内容、人感、路径、演讲模式和上线 URL"
    }
  ]
}
```

---

## 4. 命令式协作协议

每个子 Agent 都应被主 Agent 用明确命令调用，不能自由发挥。

### 命令格式

```text
You are [Agent Name].
Load skill: [Skill Name].
Input directory: [workdir]
Read:
- deck_brief.md
- ast_outline.md
- slide_plan.json
- speaker_intent.md
- asset_manifest.md

Task:
[exact task]

Write outputs to:
[exact output directory]

Do not:
- rewrite the AST goal
- consume raw source unless explicitly allowed
- change another agent's outputs
- invent missing assets without marking them

Return:
- output paths
- decisions made
- known issues
- verification result
```

---

## 5. V0.2 开发目标

V0.2 的目标不是一次性自动化所有外部 Skill，而是先做出可验证的 Agent Teams 骨架。

### V0.2 Scope

1. 增加 `router_plan.json`；
2. 增加 `run_manifest.json`；
3. 增加 `commands/` 目录，保存给每个子 Agent 的命令；
4. 增加 `outputs/` 目录规范；
5. 在本地 Demo Runner 中模拟 Agent Team 全流程；
6. 先接通一个真实子 Agent 路径，优先 guizang 或 Zara；
7. Presenter Adapter 继续作为后处理层；
8. QA Agent 必须输出验收报告。

### 非目标

- 不在 V0.2 里强行实现所有 Skill 的真实调用；
- 不把所有模板互转；
- 不让子 Agent 直接读原始资料；
- 不把演讲模式和上线绑定在一起。

---

## 6. 一句话产品表达

> Humanize PPT Agent 是 PPT Agent Team 的主控大脑：先用 AST 把资料变成人感大纲，再指挥 guizang、Zara、HyperFrames、Presenter 等专门 Agent 分工完成页面、视频、演讲模式和上线交付。
