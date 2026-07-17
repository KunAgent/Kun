# 通用图表美化方法论

以下原则适用于所有类型的图表工具（TikZ、Matplotlib、Mermaid、Plotly 等）。

---

## 1. 配色策略

| 原则 | 说明 | 示例 |
|------|------|------|
| **色彩数量** | 主色 ≤ 7 种，每种组件类型独立语义 | 橙蓝绿紫粉黄灰 |
| **对比度** | 背景与前景对比度 ≥ 4.5:1 (WCAG AA) | 白底 + `black!70` 文字，不用纯黑 |
| **语义一致** | 相同类型组件用同色系 | 所有 Attention 层用橙色 |
| **饱和度** | 学术图饱和度 50-60%，不刺眼 | Material Design 色板 |
| **透明度微调** | 次要组件降低不透明度 | `green1!70` 让 Norm 层不抢眼 |

### 推荐配色方案 (Material Design 柔和色)

```latex
% TikZ 配色定义
\definecolor{orange1}{HTML}{FFB74D}   % Attention 层 - 温暖橙
\definecolor{blue1}{HTML}{64B5F6}     % FFN 层 - 清爽蓝
\definecolor{green1}{HTML}{81C784}    % Norm 层 - 柔和绿
\definecolor{purple1}{HTML}{BA68C8}   % Embedding - 淡紫
\definecolor{pink1}{HTML}{F48FB1}     % Softmax - 粉色
\definecolor{yellow1}{HTML}{FFF176}   % Positional - 明黄
\definecolor{gray1}{HTML}{BDBDBD}     % Linear - 中性灰
```

```python
# Matplotlib 配色
colors = {
    'attention': '#FFB74D',
    'ffn': '#64B5F6',
    'norm': '#81C784',
    'embedding': '#BA68C8',
    'softmax': '#F48FB1',
    'positional': '#FFF176',
    'linear': '#BDBDBD',
}
```

**推荐配色工具**:
- [Adobe Color](https://color.adobe.com) - 配色轮盘
- [Coolors](https://coolors.co) - 快速生成调色板
- [Material Design Colors](https://m2.material.io/design/color) - Google 官方色板

---

## 2. 样式系统 - 继承与层级

### 基础样式 + 继承机制

```latex
% TikZ 样式定义 - 避免重复代码
box/.style={
    rectangle, draw=black!70, line width=0.5pt,
    minimum width=2.4cm, minimum height=0.7cm,
    align=center, font=\footnotesize\sffamily,
    rounded corners=2pt,
},
attn/.style={box, fill=orange1},           % 继承 box，只覆盖颜色
ffn/.style={box, fill=blue1},
norm/.style={box, fill=green1!70, minimum height=0.55cm, font=\scriptsize\sffamily},  % 更小尺寸
```

### 尺寸区分原则

| 组件类型 | 高度 | 字体 | 说明 |
|----------|------|------|------|
| 主要组件 (Attention/FFN) | 0.7cm | `\footnotesize` | 视觉焦点 |
| 次要组件 (Norm) | 0.55cm | `\scriptsize` | 辅助层，不抢眼 |
| 小型组件 (Positional) | 0.5cm | `\scriptsize` | 最小层级 |

---

## 3. 字体层级

```
标题 (Title):        \small\bfseries (约 10pt 粗体)
组件标签 (Label):    \footnotesize\sffamily (约 8pt 无衬线)
次要标签:            \scriptsize\sffamily (约 7pt)
注释 (Caption):      \tiny (约 5pt)
```

**原则**:
- 同一图表最多 3-4 种字体大小
- 统一使用无衬线字体 (`\sffamily`)
- 英文推荐: `Helvetica / Arial / Roboto`
- 中文推荐: `思源黑体 / 微软雅黑`
- 标题用 `gray!80` 不抢主体视觉

---

## 4. 间距系统 - 变量化控制

### 定义全局间距变量

```latex
\def\gap{0.45}      % 同模块内组件间距
\def\biggap{0.7}    % 跨模块间距 / 重要分隔

% 使用示例
\node[attn, above=\biggap of enc_add] (enc_mha) {...};
\node[norm, above=\gap of enc_mha] (enc_n1) {...};
```

**优点**:
- 全局统一，修改一处即可调整整体
- 两级间距区分模块内/模块间关系

### 留白原则
- 左右留白 ≥ 5% 画布宽度
- 上下留白 ≥ 3% 画布高度
- `border=15pt` (TikZ standalone) 提供充足边距

---

## 5. 线条与箭头 - 三级设计

### 线条粗细规范

| 元素 | 推荐粗细 | 颜色 | 用途 |
|------|----------|------|------|
| 主要连接线 | 0.5pt | `black!70` | 数据流、主要关系 |
| 次要连接线 | 0.4pt | `black!40` | 残差连接、辅助 |
| 强调连接线 | 0.7pt | `blue!60` | 跨模块连接 (如 Encoder→Decoder) |
| 边框 | 0.5pt | `black!70` | 组件边框 |
| 模块框 | 0.8pt | `black!40` | 分组边框，淡色 |

### 箭头样式定义

```latex
% 三级箭头系统
arr/.style={-{Stealth[length=5pt, width=4pt]}, line width=0.5pt, black!70},      % 主连接
arrgray/.style={-{Stealth[length=4pt, width=3pt]}, line width=0.4pt, black!40},  % 残差/次要
arrblue/.style={-{Stealth[length=5pt, width=4pt]}, line width=0.7pt, blue!60},   % 跨模块高亮
```

**箭头比例**: `length=5pt, width=4pt` 与 0.5pt 线宽协调，不过大

---

## 6. 残差连接 - 精确偏移

### 避免线条重叠

```latex
% 微小偏移避免与主线重叠
\draw[arrgray] ($(enc_add.north)+(0.05,0)$)      % 起点偏移 0.05
    -- ++(0,0.25)                                 % 向上延伸
    -| ($(enc_mha.east)+(0.4,0)$)                % 绕行距离 0.4
    |- ($(enc_n1.east)+(0,0)$);                  % 连接目标
```

### 左右交替绕行

| 残差连接 | 绕行方向 | 原因 |
|----------|----------|------|
| Encoder 残差1 | 绕右 | 避免与左侧 Positional Encoding 冲突 |
| Encoder 残差2 | 绕左 | 与残差1 交替，视觉平衡 |
| Decoder 残差1 | 绕左 | 避免与右侧 Positional Encoding 冲突 |
| Decoder 残差2 | 绕右 | 交替 |
| Decoder 残差3 | 绕左 | 交替 |

---

## 7. 模块框 - 背景层设计

```latex
\begin{scope}[on background layer]
\node[draw=black!40,           % 淡灰边框，不抢眼
      line width=0.8pt,        % 比组件边框略粗
      inner xsep=18pt,         % 水平内边距
      inner ysep=10pt,         % 垂直内边距
      rounded corners=4pt,     % 圆角比组件(2pt)更大，层级区分
      fit=(comp1)(comp2)(comp3)] (box) {};
\end{scope}
```

**原则**:
- `on background layer` 确保框在组件后面
- 边框颜色比组件淡 (`black!40` vs `black!70`)
- 圆角比组件大，形成层级感
- 内边距充足，不拥挤

---

## 8. 标注设计

```latex
% N× 标记 - 右上角
\node[font=\scriptsize\sffamily, anchor=west] 
    at ($(enc_box.north east)+(0.1,-0.1)$) {$\times N$};

% 模块标题 - 顶部居中，灰色不抢眼
\node[font=\small\sffamily\bfseries, gray!80, above=0.15cm of enc_box.north] {Encoder};
```

**原则**:
- 数学符号用 `$...$` 模式，专业感
- 标题用 `gray!80` 淡化，不抢主体
- 位置用 `anchor` 精确控制

---

## 9. 数据墨水比 (Data-Ink Ratio)

**Edward Tufte 原则**: 最大化有意义信息，最小化装饰元素

```python
# ❌ 过度装饰
plt.grid(True, which='both', linestyle='-', linewidth=1)
plt.legend(shadow=True, fancybox=True, framealpha=1)

# ✅ 简洁清晰
plt.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
plt.legend(frameon=False)
```

**TikZ 中的体现**:
- 不使用阴影 (`shadow`)
- 边框用 `black!70` 而非纯黑
- 模块框用 `black!40` 更淡

---

## 10. 快速美化清单

在生成图表前检查:

- [ ] 是否使用了样式继承，避免重复代码？
- [ ] 颜色是否有语义一致性？
- [ ] 线条是否分主次（粗细/颜色）？
- [ ] 残差连接是否有偏移，避免重叠？
- [ ] 间距是否用变量统一控制？
- [ ] 模块框是否在背景层，颜色是否淡化？
- [ ] 字体是否有明确层级（最多 3-4 种）？
- [ ] 标注是否用灰色淡化？

---

## 参考资料

- [Ten Simple Rules for Better Figures (PLOS Computational Biology)](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003833)
- [The Visual Display of Quantitative Information - Edward Tufte](https://www.edwardtufte.com/tufte/books_vdqi)
- Transformer V5 实现: `pic/transformer/transformer_v5.tex`
