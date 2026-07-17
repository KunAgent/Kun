# 品牌提取协议（Brand Extraction Protocol）

当用户提供已有品牌资产（网站 URL、品牌手册、设计文件、截图等）时，执行以下 5 步协议将其转化为可消费的设计规范。

---

## 5 步法

### Step 1: Locate（定位）

确认品牌资产的来源和位置：
- 品牌官网 URL
- 品牌手册文件路径（PDF/Figma/Sketch）
- 设计稿截图
- 已有代码仓库中的样式文件
- 用户口述的品牌特征

**输出**：资产清单列表

### Step 2: Download（获取）

获取品牌资产内容：
- 网站 → 使用 WebFetch 获取 HTML/CSS
- 文件 → 使用 Read 工具读取
- 截图 → 视觉分析提取特征
- 口述 → 结构化记录

**输出**：原始品牌素材

### Step 3: Grep Hex（提取色值）

从品牌资产中提取核心色值：

**提取目标**：
- 主色（Primary）：品牌最具辨识度的颜色
- 辅色（Secondary）：补充色
- 背景色（Background）：页面/卡片背景
- 文本色（Text）：正文颜色
- 强调色（Accent）：CTA、链接、高亮

**提取方法**：
- 从 CSS 文件搜索 `color:`, `background:`, `--` 变量
- 从 HTML class 推断 Tailwind/Bootstrap 色值
- 从截图估算近似 HEX 值
- 从品牌手册直接读取

**输出**：色值对照表（HEX + 用途说明）

### Step 4: Codify（编码）

将提取结果编码为标准化的 `brand-spec.md` 格式：

```markdown
# Brand Specification: {品牌名}

## Colors
| Token | HEX | Usage |
|-------|-----|-------|
| --brand-primary | #{value} | {用途} |
| --brand-secondary | #{value} | {用途} |
| --brand-bg | #{value} | {用途} |
| --brand-text | #{value} | {用途} |
| --brand-accent | #{value} | {用途} |

## Typography
- Heading font: {font-family}
- Body font: {font-family}
- Font weights used: {weights}

## Visual Characteristics
- Border radius: {sharp / rounded / pill}
- Shadow style: {none / subtle / elevated}
- Spacing density: {tight / normal / loose}
- Icon style: {outline / filled / custom}

## Voice & Tone
- {品牌语调描述}
```

### Step 5: Vocalise（语言化）

用自然语言描述品牌的视觉语言，便于 AI 在生成时理解品牌的"感觉"：

```markdown
## Brand Voice

{品牌名}的视觉语言是{形容词1}、{形容词2}和{形容词3}的。
它通过{视觉手法1}传达{情感1}，用{视觉手法2}建立{情感2}。
最具辨识度的特征是{特征}。
生成时应避免{反模式}，始终保持{核心气质}。
```

---

## 执行注意事项

1. **不要过度推断**：如果只有有限素材，只编码确定的部分，不确定的标注为"待确认"
2. **保留原始值**：不要"优化"用户品牌的色值，即使对比度不理想也如实记录
3. **标注来源**：每个提取的值标注来源（"from CSS var", "from screenshot", "from brand guide p.12"）
4. **建议改进**：如果发现可访问性问题（如对比度不够），在备注中建议而非自行修改
5. **融合策略**：品牌色值 + 匹配的设计系统结构 = 项目专属设计令牌
