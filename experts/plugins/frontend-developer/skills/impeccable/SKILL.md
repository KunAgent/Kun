---
name: impeccable
description: |
  Create distinctive, production-grade frontend interfaces with high design quality.
  Use this skill when the user asks to build web components, pages, artifacts, posters, or applications
  (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when
  styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic
  AI aesthetics.

  Trigger scenarios — use when the user mentions any of:
  - UI design, frontend design, web design, interface design, 界面设计, 前端设计
  - responsive layout, mobile adaptation, breakpoints, 响应式, 自适应, 适配
  - animation, motion, micro-interaction, transitions, 动画, 动效, 微交互
  - UX copy, microcopy, error messages, labels, UX 文案, 文案优化
  - performance optimization, bundle size, rendering, 性能优化, 渲染, 加载速度
  - accessibility audit, a11y, WCAG, 无障碍, 可访问性
  - design review, design critique, UX evaluation, 设计评审, 设计审查
  - typography, fonts, type hierarchy, 字体, 排版, 字号
  - color palette, color scheme, theming, 配色, 色彩, 主题
  - layout, spacing, visual rhythm, grid, 布局, 间距, 视觉节奏
  - simplify UI, declutter, reduce noise, 精简, 简化, 去噪
  - design system, components, tokens, 设计系统, 组件库, token
  - edge cases, error handling, i18n, overflow, 边缘情况, 容错, 国际化
  - onboarding, empty state, first-run experience, 引导, 空状态, 新手体验
  - visual impact, make it bold, more personality, 视觉冲击, 更大胆, 更有个性
  - tone down, calmer, less aggressive, 降噪, 更柔和, 更克制
  - polish, finishing touches, pre-launch QA, 打磨, 最终检查
  - extraordinary effects, shaders, scroll-driven, 炫酷效果, 非凡视觉
  - normalize, consistency, design drift, 规范化, 一致性
  - extract components, refactor patterns, 提取组件, 复用模式
description_zh: "高品质 UI/UX 设计工具集：帮助生成独特、生产级的前端界面，涵盖视觉风格、布局排版、动效交互、质量保障、设计系统等全方位设计能力，避免泛 AI 审美"
description_en: "UI/UX design quality toolkit for creating distinctive, production-grade frontend interfaces with high design standards across visual style, layout, motion, quality assurance, and design systems"
version: 2.0.0
homepage: https://github.com/pbakaus/impeccable
license: Apache 2.0. Based on Anthropic's frontend-design skill. See NOTICE.md for attribution.
allowed-tools: Read,Write,Bash
---

# Impeccable — 高品质前端设计工具集

基于 [Impeccable](https://impeccable.style) 项目，帮助生成**独特、生产级**的前端界面设计，避免泛 AI 审美。

---

## 设计上下文（开始前必读）

设计技能在没有项目上下文时会产生泛化输出。**开始任何设计工作前，必须确认设计上下文。**

**必需上下文**：
- **Target audience**：谁使用这个产品？在什么情境下？
- **Use cases**：他们要完成什么任务？
- **Brand personality/tone**：界面应该给人什么感觉？

> **CRITICAL**：不能通过阅读代码库来推断上下文。代码只告诉你构建了什么，不是为谁构建或应该有什么感觉。

**收集顺序**：
1. 如果当前指令中已有 **Design Context** 部分，直接使用
2. 读取项目根目录的 `.impeccable.md` 文件
3. 如果都没有，**必须先执行上下文收集流程** → 读取 [teach-impeccable.md](references/teach-impeccable.md)

---

## 核心美学原则

### 设计方向

选择 **大胆** 的美学方向。大胆的极大化和克制的极简化都行——关键是**意图性**，不是强度。

- **Purpose**：解决什么问题？谁在使用？
- **Tone**：选一个极端：极简、混沌极大化、复古未来、有机自然、奢华精致、玩具般俏皮、杂志编辑风、野兽派、装饰艺术、柔和粉彩、工业实用风……
- **Constraints**：技术要求（框架、性能、可访问性）
- **Differentiation**：让人记住的一个点是什么？

实现的代码必须是：生产级且可用 · 视觉惊艳且令人难忘 · 具有清晰美学观点的统一风格 · 每个细节都经过精心打磨。

### The AI Slop Test

> 如果你把这个界面展示给某人并说"这是 AI 做的"，他们会立刻相信吗？如果是，那就是问题所在。
> 独特的界面应该让人问"这是怎么做出来的？"，而不是"哪个 AI 做的？"

### DO / DON'T 速查

| 维度 | ✅ DO | ❌ DON'T | 深入阅读 |
|------|-------|---------|---------|
| **字体** | 独特展示字体 + 精致正文字体；模块化比例；clamp() 流体尺寸 | Inter/Roboto/Arial/Open Sans；等宽当"技术感"；标题上方大图标+圆角 | [typography.md](references/typography.md) |
| **色彩** | oklch/color-mix/light-dark；中性色调偏向品牌色 | 纯黑 #000 / 纯白 #fff；AI 配色（青+深色、紫蓝渐变、霓虹点缀）；默认深色+发光 | [color-and-contrast.md](references/color-and-contrast.md) |
| **空间** | 变化间距创造节奏；clamp() 流式间距 | 万物皆卡片 / 卡片套卡片；英雄指标模板；居中一切 | [spatial-design.md](references/spatial-design.md) |
| **动效** | 状态变化动效；指数缓动 (ease-out-quart/expo) | 动画化布局属性；回弹/弹性缓动 | [motion-design.md](references/motion-design.md) |
| **交互** | 渐进式披露；有教育意义的空状态 | 重复信息；所有按钮都设为主要 | [interaction-design.md](references/interaction-design.md) |
| **响应** | 容器查询 @container | 移动端隐藏关键功能 | [responsive-design.md](references/responsive-design.md) |
| **文案** | 每个词都有存在价值 | 重复用户已能看到的信息 | [ux-writing.md](references/ux-writing.md) |
| **细节** | 有意图的装饰强化品牌 | 毛玻璃滥用；圆角+通用阴影；无意义火花线 | — |

### 实现原则

- 实现复杂度匹配美学愿景
- 做出意想不到的创意选择，绝不趋同
- 每次设计都应不同：变化明暗主题、不同字体、不同美学
- AI 有能力做出非凡的创意工作——不要保留

---

## 场景化能力导航

当你识别到用户需求属于以下场景时，**读取对应的参考文件**获取详细工作流程和指令。

### 🎨 视觉风格调整

| 场景 | 何时使用 | 参考文件 |
|------|---------|---------|
| 增强视觉冲击力 | 设计看起来平淡、安全、缺乏个性 | [bolder.md](references/bolder.md) |
| 降低视觉攻击性 | 设计过于大胆、刺眼、令人不安 | [quieter.md](references/quieter.md) |
| 策略性添加色彩 | 界面单调、灰暗、缺乏色彩表达 | [colorize.md](references/colorize.md) |
| 非凡视觉效果 | 需要 shader、scroll-driven、60fps 等炫酷实现 | [overdrive.md](references/overdrive.md) |

### 📐 布局与排版

| 场景 | 何时使用 | 参考文件 |
|------|---------|---------|
| 修复布局和间距 | 布局不对、间距不一致、视觉层次弱 | [arrange.md](references/arrange.md) |
| 改进字体排版 | 字体选择不当、层次不清、大小失调 | [typeset.md](references/typeset.md) |
| 响应式适配 | 需要跨设备、跨屏幕尺寸适配 | [adapt.md](references/adapt.md) |

### ✨ 动效与体验

| 场景 | 何时使用 | 参考文件 |
|------|---------|---------|
| 添加动效和微交互 | 界面需要动画、过渡、悬浮效果 | [animate.md](references/animate.md) |
| 添加愉悦感和个性 | 界面功能正确但缺乏灵魂和记忆点 | [delight.md](references/delight.md) |
| 新用户引导设计 | 需要设计引导流程、空状态、首次体验 | [onboard.md](references/onboard.md) |

### 🔍 质量保障

| 场景 | 何时使用 | 参考文件 |
|------|---------|---------|
| 全面技术审查 | 需要 a11y/性能/响应式/反模式检查 | [audit.md](references/audit.md) |
| UX 设计评审 | 需要视觉层次/信息架构/认知负载评估 | [critique.md](references/critique.md) |
| 最终上线打磨 | 发布前对齐、间距、一致性最终检查 | [polish.md](references/polish.md) |
| 生产环境加固 | 错误处理、i18n、溢出、边缘情况 | [harden.md](references/harden.md) |
| 前端性能优化 | 加载慢、渲染卡顿、包体积过大 | [optimize.md](references/optimize.md) |

### 🏗 设计系统化

| 场景 | 何时使用 | 参考文件 |
|------|---------|---------|
| 提取设计系统 | 需要提取组件、token、可复用模式 | [extract.md](references/extract.md) |
| 规范化到设计系统 | 界面偏离设计系统标准需要纠正 | [normalize.md](references/normalize.md) |
| 精简到本质 | 界面过于复杂需要简化和去噪 | [distill.md](references/distill.md) |
| 改进 UX 文案 | 文案不清晰、错误信息不友好 | [clarify.md](references/clarify.md) |

### 🔧 项目设置

| 场景 | 何时使用 | 参考文件 |
|------|---------|---------|
| 初始化设计上下文 | 项目首次使用 impeccable，需收集设计上下文 | [teach-impeccable.md](references/teach-impeccable.md) |

---

### 设计领域深入参考

当需要某个设计领域的深入理论和实践指导时，读取以下参考文件：

| 领域 | 参考文件 |
|------|---------|
| 排版系统 | [typography.md](references/typography.md) |
| 颜色与对比度 | [color-and-contrast.md](references/color-and-contrast.md) |
| 空间设计 | [spatial-design.md](references/spatial-design.md) |
| 动效设计 | [motion-design.md](references/motion-design.md) |
| 交互设计 | [interaction-design.md](references/interaction-design.md) |
| 响应式设计 | [responsive-design.md](references/responsive-design.md) |
| UX 文案 | [ux-writing.md](references/ux-writing.md) |
| 启发式评分 | [heuristics-scoring.md](references/heuristics-scoring.md) |
| 用户画像 | [personas.md](references/personas.md) |
| 认知负载 | [cognitive-load.md](references/cognitive-load.md) |

---

## 来源

- [Impeccable 项目](https://github.com/pbakaus/impeccable) by Paul Bakaus
- [Impeccable 官网](https://impeccable.style)
- 基于 Anthropic 的 [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) 技能
- License: Apache 2.0
