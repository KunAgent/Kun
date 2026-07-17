---
name: colorful-dark-style
description: "Generate dark-tech colorful HTML pages for presentations, PPT-style pages, feature introductions, and workflow comparisons. Keywords: dark theme, deep color page, tech style, colorful cards, dark display page. NOTE: This skill has NO scripts. Do NOT call run_skill_script. The LLM must generate HTML directly based on the design spec in this file."
---

# 多彩暗黑 Skills

## 概述
这是一个用于生成 **深色科技风多彩暗黑风格** HTML 页面的 Skill。适用于生成展示页面、PPT 风格页面、功能介绍页面、工作流对比页面等。

**触发条件**：当用户需要生成深色科技风、暗黑多彩风格的展示页面、PPT 页面、介绍页面时使用。关键词：暗黑风格、深色页面、科技风、多彩卡片、暗色展示页。

## 设计规范

### 1. 页面基础
- **固定画布**: `width:1920px; height:1080px; overflow:hidden`（PPT 比例）
- **背景色**: `#12141e`（深蓝黑色）
- **字体栈**: `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif`
- **默认文字色**: `#e0e0e0`

### 2. 背景装饰
- **网格点纹理**（通过 `body::before`）:
```css
body::before {
  content:''; position:absolute; inset:0;
  background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 24px 24px;
  pointer-events:none; z-index:0;
}
```
- **左上角光晕**（通过 `body::after`）:
```css
body::after {
  content:''; position:absolute;
  top:-200px; left:-200px;
  width:600px; height:600px;
  background: radial-gradient(circle, rgba(74,125,255,0.06) 0%, transparent 70%);
  pointer-events:none; z-index:0;
}
```

### 3. 色彩体系（6色调色板）
| 名称 | 主色 | 用途 |
|------|------|------|
| 蓝色 | `#4a7dff` / `#7cacff` | 主品牌色、AI 核心能力、链接 |
| 紫色 | `#a855f7` / `#6c5ce7` / `#c084fc` | 渐变搭配、特殊强调 |
| 绿色 | `#00fb8a` | AI/改进/正向指标 |
| 红色 | `#ff5757` / `#ff8a8a` | 痛点/问题/警告 |
| 橙色 | `#ff9000` | 耗时/风险/前提条件 |
| 青色 | `#38bdf8` | 辅助强调色 |

**颜色使用规则**：
- 背景填充：使用 `rgba(主色, 0.03~0.12)` 的低透明度
- 边框：使用 `rgba(主色, 0.1~0.4)` 
- Hover 状态：背景透明度提升到 `0.04~0.08`，边框透明度提升到 `0.3~0.5`
- 文字：直接使用主色或其亮色变体

### 4. 页面标题
```css
.page-header {
  position:absolute; top:60px; left:60px; right:60px;
  display:flex; align-items:center; gap:16px;
  z-index:10;
}
.page-header .icon {
  width:36px; height:36px; border-radius:10px;
  background: linear-gradient(135deg, #4a7dff, #6c5ce7);
  display:flex; align-items:center; justify-content:center;
  font-size:18px;
}
.page-header h1 {
  font-size:26px; font-weight:700;
  background: linear-gradient(90deg, #fff, #a0b4ff);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  letter-spacing:1px;
}
```

### 5. 卡片组件
**通用卡片样式**：
- 背景：`rgba(主色, 0.02~0.04)`
- 边框：`1px solid rgba(主色, 0.08~0.15)`
- 圆角：`10px~16px`
- 内边距：`20px 18px` 或 `32px 28px`（大卡片）
- Hover 效果：`transform:translateY(-2px~-4px)` + 边框/背景色增强 + `box-shadow`

**带顶部彩色条的卡片**：
```css
.card { border-top: 2px solid rgba(主色, 0.4); }
.card::before {
  content:''; position:absolute; top:0; left:0; right:0; height:3px;
  border-radius:16px 16px 0 0;
  background: linear-gradient(90deg, 色1, 色2);
  opacity:0; transition:opacity .3s;
}
.card:hover::before { opacity:1; }
```

### 6. 多彩序号卡片（适用于功能列表等）
- 大号序号：`font-size:48px; font-weight:800; color:rgba(主色, 0.25)`
- 图标容器：`52x52px; border-radius:14px; background:rgba(主色, 0.1)`
- 标题：`font-size:17px; font-weight:700; color:主色亮色变体`
- 描述：`font-size:13px; color:#8b8fa3; line-height:1.8`
- 内联标签：`padding:2px 8px; border-radius:4px; font-size:11px; background:rgba(主色, 0.12); color:主色亮色变体`

### 7. 流程步骤
```css
.flow-step {
  padding:12px 14px; font-size:12px; font-weight:600;
  border-radius:6px; white-space:nowrap;
}
.flow-step.normal { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#c0c4d6; }
.flow-step.pain { background:rgba(255,87,87,0.12); border:1px solid rgba(255,87,87,0.35); color:#ff5757; }
.flow-step.ai { background:rgba(0,251,138,0.1); border:1px solid rgba(0,251,138,0.3); color:#00fb8a; }
.flow-step.ai-accent { background:linear-gradient(135deg,rgba(74,125,255,0.15),rgba(168,85,247,0.15)); border:1px solid rgba(74,125,255,0.4); color:#7cacff; }
.flow-arrow { color:rgba(255,255,255,0.2); font-size:16px; margin:0 2px; }
```

### 8. 分隔线
```css
.divider {
  height:1px;
  background: linear-gradient(90deg, transparent, rgba(74,125,255,0.3), rgba(0,251,138,0.3), transparent);
}
.divider-arrow {
  width:36px; height:36px; border-radius:50%;
  background:rgba(0,251,138,0.12);
  border:1px solid rgba(0,251,138,0.3);
  box-shadow:0 0 20px rgba(0,251,138,0.2);
}
```

### 9. 标签/徽章
```css
.efficiency-tag {
  padding:3px 8px; border-radius:4px;
  font-size:10px; font-weight:600;
  background:rgba(0,251,138,0.1); color:#00fb8a;
}
.vs-badge {
  padding:3px 12px; border-radius:10px;
  font-size:11px; font-weight:700;
  background: linear-gradient(135deg, #4a7dff, #6c5ce7);
  color:#fff;
  box-shadow:0 0 16px rgba(74,125,255,0.3);
}
```

### 10. 前提/警告条
```css
.prerequisite {
  padding:14px 16px;
  background:rgba(255,144,0,0.06);
  border:1px solid rgba(255,144,0,0.2);
  border-radius:8px;
  font-size:11.5px; color:#ff9000; line-height:1.6;
  display:flex; align-items:center; gap:8px;
}
```

### 11. 图例与装饰
```css
.legend { display:flex; gap:20px; }
.legend-item { display:flex; align-items:center; gap:6px; font-size:12px; color:#8b8fa3; }
.legend-dot { width:8px; height:8px; border-radius:50%; }
.decoration {
  position:absolute; bottom:20px; right:60px;
  font-size:11px; color:rgba(255,255,255,0.15);
}
```

### 12. 辅助文字
- 标签文字：`font-size:11px; color:#8b8fa3`
- 描述文字：`font-size:11.5px~13px; color:#8b8fa3; line-height:1.7~1.8`
- 内容文字：`font-size:12px; color:#c0c4d6; line-height:1.6`
- 强调文字：`color:#7cacff`（蓝色强调）、`color:#ff9000`（橙色强调）、`color:#ff5757`（红色强调）

## 页面布局原则

1. **绝对定位布局**：主要区域使用 `position:absolute` 精确控制位置
2. **标准间距**：页面边距 `60px`，元素间距 `12px~20px`
3. **z-index 层级**：背景装饰 `0`，内容区域 `5`，分隔线 `5~6`，标题/装饰 `10`
4. **Grid 布局**：卡片使用 `grid-template-columns:repeat(N, 1fr)` 等分排列
5. **Flex 布局**：流程步骤、标题、图例等使用 flex 横向排列

## 动效规范

- **过渡时间**：`0.3s~0.4s`
- **缓动函数**：`cubic-bezier(.4,0,.2,1)` 或默认 `ease`
- **Hover 上浮**：`transform:translateY(-2px)` 小卡片，`translateY(-4px)` 大卡片
- **Hover 阴影**：`box-shadow:0 12px 40px rgba(0,0,0,0.3)`
- **顶部渐变条淡入**：通过 `::before` 伪元素，hover 时 `opacity:0→1`

## 生成规则

1. 所有页面必须是**单文件 HTML**，CSS 内联在 `<style>` 标签中
2. 图标优先使用 **emoji**，如需 SVG 则内联
3. 页面语言设为 `zh-CN`
4. 根据内容自动选择合适的布局：
   - 功能列表类 → 多彩序号卡片横排
   - 流程对比类 → 上下分区 + 分隔线
   - 信息展示类 → 卡片网格
5. 每个页面右下角加装饰文字
6. 每张卡片使用不同主题色，按顺序循环使用调色板中的颜色
