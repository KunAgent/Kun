# 腾讯云架构图示例

本文件提供典型架构场景的**布局规划参考**，帮助 AI 快速建立坐标体系。
完整 XML 可参照 `references/arch-patterns.md` 中的连线规范自行生成。

---

## 示例 1：Web 三层架构

**场景**：接入层（CLB + WAF）→ 应用层（2 台 CVM）→ 数据层（MySQL + Redis）

### 布局表

| 节点名 | 泳道 | 层 | x | y | 图标 key |
|--------|------|----|----|-----|---------|
| 用户 | 外部 | 0 | 390 | 30 | `user` |
| WAF | 接入层 | 1 | 210 | 200 | `waf` |
| CLB | 接入层 | 1 | 490 | 200 | `clb` |
| CVM-A | 应用层 | 2 | 210 | 420 | `cvm` |
| CVM-B | 应用层 | 2 | 490 | 420 | `cvm` |
| MySQL | 数据层 | 3 | 210 | 630 | `mysql` |
| Redis | 数据层 | 3 | 490 | 630 | `redis` |

### 走廊规划

| 走廊 | Y 坐标 | 说明 |
|------|--------|------|
| 层0→1 | 140 | 用户→接入层 |
| 层1→2 | 350 | 接入层→应用层 |
| 层2→3 | 560 | 应用层→数据层 |
| 列间X | 350 | WAF列 与 CLB列 之间 |

### 关键连线片段

```xml
<!-- 跨层连线（CLB → CVM-A，经走廊 Y=350）-->
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;
  jettySize=auto;exitX=0.3;exitY=1;exitDx=0;exitDy=0;
  entryX=0.5;entryY=0;entryDx=0;entryDy=0;
  strokeColor=#0052D9;strokeWidth=2;endArrow=block;endFill=1;"
  edge="1" parent="1" source="clb1" target="cvm_a">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="505" y="350"/>   <!-- 走廊入口（CLB列） -->
      <mxPoint x="240" y="350"/>   <!-- 走廊出口（CVM-A列） -->
    </Array>
  </mxGeometry>
</mxCell>

<!-- 同层水平连线（WAF → CLB，同层直连无需走廊）-->
<mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;
  jettySize=auto;exitX=1;exitY=0.5;exitDx=0;exitDy=0;
  entryX=0;entryY=0.5;entryDx=0;entryDy=0;
  strokeColor=#0052D9;strokeWidth=2;endArrow=block;endFill=1;"
  edge="1" parent="1" source="waf1" target="clb1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>

<!-- 并行线分轨（CVM-A → MySQL 和 CVM-A → Redis 共用走廊 Y=560，laneIndex 不同）-->
<mxCell id="e3" style="edgeStyle=orthogonalEdgeStyle;...exitX=0.5;exitY=1;...entryX=0.5;entryY=0;..."
  edge="1" parent="1" source="cvm_a" target="mysql1">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="240" y="560"/>   <!-- laneIndex=0 -->
    </Array>
  </mxGeometry>
</mxCell>
<mxCell id="e4" style="edgeStyle=orthogonalEdgeStyle;...exitX=0.7;exitY=1;...entryX=0.3;entryY=0;..."
  edge="1" parent="1" source="cvm_a" target="redis1">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="258" y="560"/>   <!-- laneIndex=1, x+18 -->
      <mxPoint x="505" y="560"/>
    </Array>
  </mxGeometry>
</mxCell>
```

---

## 示例 2：Serverless 架构

**场景**：用户 → API Gateway → SCF 云函数（A/B/C）→ COS / MySQL / CKafka

### 布局表

| 节点名 | 层 | x | y | 图标 key |
|--------|----|----|----|---------|
| 用户 | 0 | 400 | 30 | `user` |
| API Gateway | 1 | 370 | 180 | `apigw` |
| SCF-A | 2 | 200 | 380 | `scf` |
| SCF-B | 2 | 380 | 380 | `scf` |
| SCF-C | 2 | 560 | 380 | `scf` |
| COS | 3 | 200 | 580 | `cos` |
| MySQL | 3 | 400 | 580 | `mysql` |
| CKafka | 3 | 600 | 580 | `ckafka` |

### 走廊规划

| 走廊 | Y 坐标 | 说明 |
|------|--------|------|
| 层0→1 | 130 | |
| 层1→2 | 300 | API GW 底部3槽位分轨到各 SCF |
| 层2→3 | 500 | 各 SCF 汇聚后分流到存储层 |

### 关键连线规则

- API GW 底部 3 个槽位（exitX=0.25/0.5/0.75）分别连 SCF-A/B/C
- SCF → 存储层：走廊 Y=500，3 条线使用 laneIndex=0/1/2（x 偏移 0/18/36）

---

## 示例 3：微服务横向连线防穿越

**场景**：同层多个微服务之间横向调用，必须通过底部走廊绕行。

### 关键规则

同层服务 A → 服务 B（中间有服务 C 阻挡）：
- **错误**：直接连 source→target，线条会穿越 C
- **正确**：两条线都从底部出，走廊绕行，再从顶部入

```xml
<!-- 同层绕行：svc_a → svc_b，绕过中间的 svc_c -->
<mxCell id="e_ab" style="edgeStyle=orthogonalEdgeStyle;...
  exitX=0.5;exitY=1;...entryX=0.5;entryY=0;..."
  edge="1" source="svc_a" target="svc_b">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="200" y="480"/>   <!-- svc_a 底部出，进走廊 -->
      <mxPoint x="400" y="480"/>   <!-- 走廊中段绕过 svc_c -->
    </Array>
  </mxGeometry>
</mxCell>
```

---

## 走廊坐标快速参考

| 区域 | y 起点 | 层间走廊 Y |
|------|--------|-----------|
| 外部用户 | 30 | — |
| 层0→1 走廊 | — | 130 |
| 接入层 | 170 | — |
| 层1→2 走廊 | — | 340 |
| 应用层 | 380 | — |
| 层2→3 走廊 | — | 560 |
| 数据层 | 600 | — |
