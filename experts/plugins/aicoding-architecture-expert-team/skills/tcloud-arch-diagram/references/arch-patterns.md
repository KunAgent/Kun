# 腾讯云架构图绘图规范

本文件定义架构图的布局策略、组件尺寸、间距规则和防穿越详细规范。

---

## 一、画布与网格规范

### 基础设置

```xml
<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1"
  tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1"
  pageWidth="1654" pageHeight="1169" math="0" shadow="0">
```

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| pageWidth | 1654 | A3 横向宽度（像素） |
| pageHeight | 1169 | A3 横向高度 |
| gridSize | 10 | 对齐网格精度（10px） |
| grid | 1 | 启用网格对齐 |

---

## 二、组件尺寸规范

### 图标节点（云产品）

| 参数 | 值 |
|------|----|
| width | 60 |
| height | 60 |
| 标签位置 | verticalLabelPosition=bottom |
| 标签字号 | fontSize=11 |
| 标签颜色 | fontColor=#333333 |

### 文本标签（纯文字节点）

| 参数 | 值 |
|------|----|
| width | 100 |
| height | 30 |
| style | rounded=1;arcSize=20;fontSize=11 |

### 容器（VPC/子网/AZ）

| 类型 | width | height | startSize |
|------|-------|--------|-----------|
| VPC | ≥ 500 | ≥ 300 | 30 |
| 子网 | ≥ 300 | ≥ 200 | 24 |
| 可用区 | ≥ 280 | ≥ 180 | 24 |

> 容器尺寸根据内容自适应，以上为最小值。

### 容器高度计算公式

```
height = startSize + 行数 × (最大节点高度 + 行间距) + 上下padding × 2

参数默认值：
  startSize   = 30   （泳道标题）
  行间距       = 40px
  上下padding  = 30px

示例（2行图标节点）：height = 30 + 2×(60+40) + 60 = 290px
```

| 内容行数 | 节点类型 | 推荐 height |
|---------|---------|------------|
| 1 行 | 图标节点(60px) | 180 |
| 2 行 | 图标节点(60px) | 280 |
| 3 行 | 图标节点(60px) | 390 |
| 1 行 | 文字节点(40px) | 160 |
| 2 行 | 文字节点(40px) | 230 |

### 容器-子节点 parent 绑定规则（强制）

- 容器内的所有节点 `parent` **必须**设为容器 id
- 子节点的 `x/y` 是相对于容器左上角内容区的偏移量
- 内容区起点 = 容器左上角向下偏移 `startSize`（通常 30px）

```xml
<!-- 容器 -->
<mxCell id="zone1" style="swimlane;startSize=30;..." vertex="1" parent="1">
  <mxGeometry x="80" y="150" width="700" height="280"/>
</mxCell>
<!-- 子节点：parent="zone1"，x/y 为容器内相对坐标 -->
<mxCell id="n1" style="..." vertex="1" parent="zone1">
  <mxGeometry x="50" y="50" width="60" height="60"/>
</mxCell>
```

---

## 三、布局分层策略

### 标准分层模型（从上到下）

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 0: 外部用户 / Internet（独立图标，不含容器）              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: 接入层（CLB / WAF / CDN / API Gateway）               │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: 应用层（CVM / TKE / SCF / Lighthouse）                │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: 数据层（TencentDB / Redis / COS / CFS / CBS）         │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: 网络层（VPC / NAT Gateway / 专线）                    │
└─────────────────────────────────────────────────────────────────┘
```

**监控/安全服务**：可放置在右侧独立泳道，或使用虚线边界框标注所有受监控组件。

### 垂直坐标参考

| 层 | y 起点 | 层高 |
|----|--------|------|
| 外部用户 | 20 | 100 |
| 接入层 | 160 | 160 |
| 应用层 | 370 | 200 |
| 数据层 | 620 | 180 |
| 网络层 | 850 | 160 |

---

## 四、间距规范

### 组件间距

| 场景 | 最小值 | 推荐值 |
|------|--------|--------|
| 同层相邻组件（水平） | 60px | 80px |
| 相邻层之间（垂直） | 60px | 80px |
| 组件与容器内边界 | 20px | 30px |
| 相邻容器之间 | 20px | 40px |
| 走线走廊宽度 | 40px | 60px |
| 相邻泳道间边界走廊 | 160px | 200px |

### 连接点位置（exitX/exitY/entryX/entryY）

- 顶部出口：`exitX=0.5;exitY=0;exitDx=0;exitDy=0`
- 底部出口：`exitX=0.5;exitY=1;exitDx=0;exitDy=0`
- 左侧出口：`exitX=0;exitY=0.5;exitDx=0;exitDy=0`
- 右侧出口：`exitX=1;exitY=0.5;exitDx=0;exitDy=0`

---

## 五、防穿越规则（最高优先级）

> **线条穿过图标是架构图最严重的质量问题。以下所有规则强制执行。**

### 5.1 走线走廊机制

每个布局区域必须预留专用走廊：

```
┌──────────────────────────────────────────────────────────┐
│  VPC 容器                                                  │
│  ┌───────────┐  ← 走廊(40px)  ┌───────────┐              │
│  │  CVM-1    │                │  CVM-2    │              │
│  │  (60×60)  │                │  (60×60)  │              │
│  └───────────┘                └───────────┘              │
│                                                           │
│  ← boundaryGap(160px) →                                  │
│                                                           │
│  ┌───────────┐  ← 走廊(40px)  ┌───────────┐              │
│  │  MySQL    │                │  Redis    │              │
│  └───────────┘                └───────────┘              │
└──────────────────────────────────────────────────────────┘
```

**走廊规则**：
- 纵向走廊（`corridorX`）：预留在同层组件列之间，用于水平连线
- 横向走廊（`corridorY`）：预留在相邻层之间，用于垂直连线
- 跨层主干线必须通过层间横向走廊，不得穿越中间层的组件区

### 5.2 路径点显式指定规范

**何时必须提供 `<Array as="points">`**：

| 情况 | 是否必须提供 points |
|------|-------------------|
| 跨容器/跨泳道 | 必须 |
| 跨越 2 层以上 | 必须 |
| 同侧连接数 ≥ 2 | 必须 |
| 经过密集组件区域 | 必须 |
| 单层内简单相邻连接 | 推荐 |

**路径点坐标计算规则**：

连线路径按以下模板规划（以向下连线为例）：

```
source_bottom  →  (srcX, corridorY_start)
               →  (dstX, corridorY_start)   ← 水平段，走在走廊内
               →  (dstX, dst_top)
```

示例 XML：
```xml
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;
  jettySize=auto;exitX=0.5;exitY=1;exitDx=0;exitDy=0;
  entryX=0.5;entryY=0;entryDx=0;entryDy=0;
  strokeColor=#0052D9;strokeWidth=2;"
  edge="1" parent="1" source="cvm1" target="mysql1">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="180" y="480"/>   <!-- 走廊Y = 480，位于两层之间 -->
      <mxPoint x="320" y="480"/>
    </Array>
  </mxGeometry>
</mxCell>
```

### 5.3 连接槽位分配（禁止重叠）

同一节点同一侧的多条连线必须使用不同的连接点坐标：

| 线数 | 顶/底侧槽位（X） | 左/右侧槽位（Y） |
|------|-----------------|-----------------|
| 1 条 | 0.5 | 0.5 |
| 2 条 | 0.3, 0.7 | 0.3, 0.7 |
| 3 条 | 0.25, 0.5, 0.75 | 0.25, 0.5, 0.75 |
| 4 条 | 0.2, 0.4, 0.6, 0.8 | 0.2, 0.4, 0.6, 0.8 |
| > 4 条 | 需要增加锚点节点 | 需要增加锚点节点 |

### 5.4 并行线分轨（禁止重叠）

走廊内多条并行线必须分轨，避免重叠：

```
走廊（宽度 60px）内 3 条并行线分轨：
  线 1：x = corridorX + 0  (laneIndex=0)
  线 2：x = corridorX + 18 (laneIndex=1, laneStep=18)
  线 3：x = corridorX + 36 (laneIndex=2)
```

计算公式：`offset = laneIndex × laneStep`，`laneStep ≥ 18px`

### 5.5 最小安全距离

| 约束 | 最小值 |
|------|--------|
| 路径点与任意非源/目标组件边界的距离 | 40px |
| 路径点与容器边界的距离 | 20px |
| 线条与组件边框平行贴行的缓冲 | 20px |

### 5.6 远距离跨层连接拆分

**禁止**：一根线从第 1 层直穿到第 4 层。

**必须**使用以下方案之一：

**方案 A：逻辑锚点拆分**
```
Layer 1: [CLB] ──→ [锚点 A1]
                        │ (竖直穿越)
Layer 4: [锚点 A2] ──→ [MySQL]
```

**方案 B：中间汇聚节点（Bus）**
```
[CVM-1] ──┐
[CVM-2] ──┤──→ [Bus] ──→ [MySQL]
[CVM-3] ──┘
```

锚点节点样式：
```
ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=none;
width=8;height=8;
```

---

## 六、连接线样式规范

### 连线强制属性

所有连线必须包含：

```
edgeStyle=orthogonalEdgeStyle;   ← 强制正交
rounded=0;                        ← 不弯曲
orthogonalLoop=1;                 ← 正交循环处理
jettySize=auto;                   ← 自动调整起始长度
exitX=<值>;exitY=<值>;exitDx=0;exitDy=0;    ← 显式出口
entryX=<值>;entryY=<值>;entryDx=0;entryDy=0; ← 显式入口
```

### 箭头和端点

| 场景 | 末端样式 |
|------|---------|
| 单向数据流 | `endArrow=block;endFill=1` |
| 双向通信 | `startArrow=block;startFill=1;endArrow=block;endFill=1` |
| 弱关联/虚线 | `dashed=1;dashPattern=8 4;endArrow=open` |

---

## 七、标签规范

### 连线标签（流量/协议）

```xml
<mxCell ... value="HTTPS:443" style="edgeLabel;fontSize=10;...">
  <mxGeometry x="-0.1" y="5" relative="1" as="geometry">
    <mxPoint as="offset"/>
  </mxGeometry>
</mxCell>
```

**标签位置**：`x=-0.1`（靠近中点），`y=5`（偏上，不遮挡连线）

### 图标节点标签

- 标签始终在图标正下方（`verticalLabelPosition=bottom`）
- 显示产品简称（如 `CVM` 或 `Web Server`），必要时加实例标识（如 `CVM-Master`）
- 字号 11px，颜色 `#333333`

---

## 八、推荐布局流程

绘制架构图前，先规划布局表：

| 节点名 | 泳道 | 层 | 行 | 列 | 类型 | 图标 |
|--------|------|----|----|----|------|------|
| 用户 | 外部 | 0 | 1 | 1 | external | 用户 |
| CLB | 接入层 | 1 | 1 | 1 | network | CLB |
| WAF | 接入层 | 1 | 1 | 2 | security | WAF |
| CVM-A | 应用层 | 2 | 1 | 1 | compute | CVM |
| CVM-B | 应用层 | 2 | 1 | 2 | compute | CVM |
| MySQL主 | 数据层 | 3 | 1 | 1 | database | TencentDB MySQL |
| Redis | 数据层 | 3 | 1 | 2 | database | TencentDB Redis |

同时规划：
- 纵向走廊 X 坐标（层间走廊）
- 横向走廊 Y 坐标（列间走廊）
- 每条连线的 laneIndex

---

## 九、常见问题与解决方案

### Q1: 连线穿越中间组件

**原因**：依赖 Draw.io 自动路由，路径点未显式指定。

**解决**：为所有跨层连线添加 `<Array as="points">`，路径点绕过中间组件区域（y 坐标设为层间走廊的 y 值）。

### Q2: 多条线从同一点出发，重叠在一起

**原因**：多条边使用了相同的 exitX/entryX 值。

**解决**：按"连接槽位分配"规则分配不同的 exit/entry 值，并在走廊内分轨（不同 laneIndex）。

### Q3: 跨多层的连接线路径混乱

**原因**：跨层直连，未拆分。

**解决**：使用锚点或 Bus 节点，拆分为多段短连线。

### Q4: 容器内连线穿越容器边界

**原因**：容器内外节点直接连接，路径未绕开容器角。

**解决**：连线路径点的 x/y 坐标必须位于容器边界外至少 20px，或通过容器的专用出入口锚点中转。

### Q5: 字体显示乱码（显示 `<b>` 等 HTML 标签原文）

**原因**：节点 `value` 中包含 HTML 标签，但 style 没有声明 `html=0`，Draw.io 直接渲染了原始标签字符。

**解决**：
1. 所有节点 style 中加 `html=0;`
2. value 只写纯文本，不含任何 HTML 标签
3. 多行文字用 XML 实体 `&#xa;` 换行

```xml
<!-- 正确 -->
<mxCell value="CVM-A&#xa;Web Server" style="##TCLOUD_ICON[cvm]##;html=0;" .../>

<!-- 错误（会显示乱码）-->
<!-- <mxCell value="<b>CVM-A</b><br>Web Server" style="..." .../> -->
```

### Q6: 容器与子节点重叠/位置错乱

**原因**：子节点 `parent` 写成根层 `"1"` 而非所属容器 id，导致节点不跟随容器；或容器 height 不足导致内容溢出。

**解决**：
1. 容器内所有节点 `parent` 改为容器 id
2. 子节点 x/y 改为相对容器内容区的偏移量（绝对坐标 - 容器.x，绝对y - 容器.y - startSize）
3. 按高度公式重新计算容器 height
