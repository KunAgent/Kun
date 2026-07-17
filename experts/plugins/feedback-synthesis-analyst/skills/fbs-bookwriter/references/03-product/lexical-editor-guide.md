# Lexical Markdown 编辑器适配指南

> **优先级**：P2 · **版本**：1.0 · **日期**：2026-04-09
> **适用宿主**：WorkBuddy（内置 lexical-markdown-editor 扩展）

## 概述

WorkBuddy内置基于Lexical框架的Markdown编辑器扩展，包含898个JS文件，提供所见即所得编辑能力。FBS-BookWriter可利用此编辑器增强书稿编辑体验。

## 编辑器能力

| 能力 | 说明 |
|------|------|
| 所见即所得 | Markdown语法实时渲染 |
| 结构化大纲 | 标题层级导航 |
| 快捷格式 | 加粗/斜体/链接/代码等快捷键 |
| 语法高亮 | 代码块语法着色 |

## FBS集成策略

### 当前状态
FBS的书稿编辑依赖宿主默认编辑器（VS Code文本编辑器），未专门适配Lexical编辑器。

### 适配路径

1. **识别编辑器类型**：FBS在打开书稿文件时，检测宿主是否提供Lexical编辑器
2. **格式兼容**：确保FBS输出的Markdown格式与Lexical解析器兼容
3. **大纲视图**：利用编辑器的标题层级导航功能，替代FBS自建的章节目录

### 格式兼容要点

| FBS格式 | Lexical兼容 | 说明 |
|---------|-------------|------|
| `# 一级标题` | ✅ | 标准ATX标题 |
| `## 二级标题` | ✅ | 标准ATX标题 |
| `> 引用` | ✅ | 标准引用块 |
| `| 表格 |` | ✅ | 标准GFM表格 |
| `---` | ✅ | 水平分隔线 |
| `{{模板变量}}` | ⚠️ | 非标准，Lexical会显示为纯文本 |
| `::: admonition` | ❌ | 非标准，需转换为blockquote |

### 建议

- FBS 输出保持标准 Markdown，确保 Lexical 兼容
- 非标准语法（`{{模板变量}}`、`::: admonition`）在正文写作阶段避免使用，保留为内部模板标记

## 参考资源

- Lexical框架：https://lexical.dev/
- WorkBuddy内置扩展路径：`D:\WorkBuddy\resources\app\extensions\lexical-markdown-editor\`
