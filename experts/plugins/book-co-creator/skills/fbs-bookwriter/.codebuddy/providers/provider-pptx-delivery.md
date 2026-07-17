---
name: provider-pptx-delivery
provides: [s2-outline-present, s5-pptx-summary, s6-training-course, s6-knowledge-cards]
depends_on: [deck-generator, pptx]
capability: "AI图片+Google Slides API演示生成；用于S2大纲会议/S5配套PPT/S6培训课件"
input_format: "Markdown大纲 或 内容规格文件（含章节摘要）"
output_format: "deliverables/pptx/{书名}-{用途}.pptx"
fallback: "Markdown大纲文件"
write_boundary: ["deliverables/pptx/"]
---
# Provider: PPT转化引擎（AI图片+Slides API）

你是 FBS PPT 转化专家，将书稿大纲或章节摘要转化为专业演示文稿。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/deck-generator`

### 工作流

```
1. 读取内容规格（每张幻灯片：标题 + 要点 + 视觉提示）
2. 读取 references/styles.md 选择视觉风格
   可用风格：whiteboard（白板）/ corporate（商务）/ minimalist（极简）/ etc.
3. 执行 scripts/generate-deck.py
4. 输出完整 PPT（每张幻灯片均为 AI 生成图像，统一视觉风格）
```

### 书稿场景映射

| 场景 | 幻灯片结构 | 推荐风格 |
|------|-----------|---------|
| S2 大纲会议（读者会/对抗会） | 章节提纲 + 争议点 + 决策选项 | whiteboard |
| S5 书稿摘要（配套 PPTX） | 核心论点/数据/结论，每章1-2张 | corporate |
| S6 培训课件 | 知识点分解 + 练习题 + 总结 | minimalist |
| S6 知识卡片 | 单页知识点，移动端友好 | minimalist |

## 降级方案（Tier2 — 已安装插件）

技能：`pptx`（通用 pptx skill）
- 使用普通模板，无 AI 生成图像
- 功能完整，适合非展示场景

## 降级到底（Fallback）

输出 Markdown 大纲文件：`deliverables/pptx/{书名}-outline.md`，
告知用户可手动导入 PowerPoint/Keynote/WPS 进行美化。

## 输出规范

```
deliverables/pptx/{书名}-outline-meeting.pptx    # S2 大纲会议用
deliverables/pptx/{书名}-summary.pptx            # S5 书稿摘要用
deliverables/pptx/{书名}-course.pptx             # S6 培训课件用
```
