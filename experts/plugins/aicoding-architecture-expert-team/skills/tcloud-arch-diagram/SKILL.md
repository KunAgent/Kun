---
name: tcloud-arch-diagram
description: "系统架构图绘制。当需要绘制任何系统架构图、云架构设计图、微服务架构图、Serverless架构图、混合云架构图时使用此技能，支持腾讯云及通用架构场景。基于 Draw.io XML 生成 .drawio 文件，支持二次可视化编辑。"
---

# 系统架构图绘制 · AI 操作手册

你是系统架构图专家。接收到用户描述后，**直接生成** Draw.io XML 文件，不输出任何中间步骤（无需坐标表、无需策略表）。如果架构包含腾讯云产品，使用腾讯云官方图标占位符，生成后自动注入。

---

## 执行流程（一步直出）

```
收到需求 → 内部规划（不输出）→ 生成完整 XML 文件 → 自动注入图标 → 输出完成通知
```

---

## 内部规划规则（AI 思考，不输出给用户）

> 在生成 XML 之前，AI 必须在思考中完成以下所有计算，但不向用户输出过程。

### 规则1：层次识别

从用户描述中提取层次结构，常见层次：
- 外部用户层（无容器，游离节点）
- 接入/安全层（WAF、CDN、CLB、DDoS 等）
- 应用层（微服务、TKE、SCF 等，通常在 VPC 内）
- 数据层（数据库、缓存、存储，通常在 VPC 内）
- 监控/运维层（CM、CLS、CWP 等）

层次不限于以上，根据用户需求灵活调整（可以是左右分栏、3层、6层等）。

### 规则2：坐标计算（均匀居中分布）

**画布宽度**：1654px。容器从 x=30 开始，宽 1594px。

**容器 y 坐标：**
- 层0（外部，无容器）：y=30，高度 120px
- 层1：y=190
- 层n：y = 上一层容器底部 + 60（层间走廊）

**容器高度：**
```
height = 40 + 行数 × (节点高 + 40) + 40
图标节点高=60，文字节点高=40
1行图标=180，2行图标=280，3行图标=390
```

**节点水平均匀分布（强制，防止节点堆积左侧）：**
```
间距 = (1594 - 80 - 节点数×节点宽) ÷ (节点数 - 1)
若间距 > 160px：改为固定间距120px，整组居中
  总占用 = 节点数×宽 + (节点数-1)×120
  起始x = (1514 - 总占用) ÷ 2 + 40

第i个节点相对x = 起始x + i × (节点宽 + 间距)
多行时每行独立计算，行间距60px
```

### 规则3：连线策略（三策略决策树）

**走廊Y = 上层容器底部y + 30**（路径点必须落在这里，禁止落在节点区域）

```
源节点出线数 = 1   → 策略A：exitX=0.5,exitY=1 → 路径点走廊Y → entryX=0.5,entryY=0
源节点出线数 = 2   → 策略B：exitX=0.3/0.7 分槽位
源节点出线数 = 3   → 策略C：exitX=0.25/0.5/0.75 分槽位
源节点出线数 ≥ 4  → 策略D：Bus汇聚节点（强制）
  在走廊Y处放小圆点 Bus 节点（style见4.3）
  源→Bus（1条），Bus→各目标（多条）
```

**只画核心数据流**：全图连线 ≤ 15 条，同层服务间不画线，容器间用代表性连线（1-2条）。

**容器内连线**（parent=容器id，路径点为容器内相对坐标）：
- 相邻无阻挡：直连，不加路径点
- 中间有阻挡：底部绕行，bypassY = 容器高度 - 10

**绝对坐标换算**：
```
节点绝对中心X = 容器.x + 节点相对x + 节点宽/2
节点绝对中心Y = 容器.y + 30 + 节点相对y + 节点高/2
```

---

## XML 生成规范

### 文件模板

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="tcloud-arch-diagram" version="21.0.0">
  <diagram id="arch-main" name="架构图">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1"
      tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1"
      pageWidth="1654" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- 写入顺序：容器 → 节点 → Bus节点 → 连线 -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### 容器

```xml
<mxCell id="layer1" value="接入层（安全 &amp; 分发）"
  style="swimlane;startSize=30;fillColor=#FCE8E6;strokeColor=#C62828;
  fontColor=#C62828;fontStyle=1;fontSize=13;html=0;"
  vertex="1" parent="1">
  <mxGeometry x="30" y="190" width="1594" height="180" as="geometry"/>
</mxCell>
```

**容器颜色：**
| 层次 | fillColor | strokeColor |
|------|-----------|-------------|
| 外部用户 | #F5F5F5 | #9E9E9E |
| 接入/安全层 | #FCE8E6 | #C62828 |
| 应用层（VPC） | #E6F4EA | #00875A |
| 数据层（VPC） | #EDE7F6 | #7B2FA0 |
| 监控/运维层 | #E3F2FD | #1565C0 |

### 节点

**腾讯云产品（占位符格式）：**
```xml
<mxCell id="clb1" value="CLB&#xa;负载均衡"
  style="tcloud-icon:clb;html=0;"
  vertex="1" parent="layer1">
  <mxGeometry x="240" y="40" width="60" height="60" as="geometry"/>
</mxCell>
```

**自定义服务节点：**
```xml
<mxCell id="svc1" value="推荐服务&#xa;(TKE)"
  style="rounded=1;arcSize=15;fillColor=#E8F0FE;strokeColor=#0052D9;
  fontSize=11;fontColor=#333333;html=0;"
  vertex="1" parent="layer2">
  <mxGeometry x="40" y="40" width="120" height="50" as="geometry"/>
</mxCell>
```

**Bus 汇聚节点（≥4 条出线时）：**
```xml
<mxCell id="bus1" value=""
  style="ellipse;fillColor=#000000;strokeColor=none;html=0;"
  vertex="1" parent="1">
  <mxGeometry x="550" y="490" width="8" height="8" as="geometry"/>
</mxCell>
```

**文字规范（强制）：**
- 所有节点 style 必须包含 `html=0;`
- value 只写纯文本，禁止 `<b>` `<br>` 等 HTML 标签
- 多行文字用 `&#xa;`

### 连线

**基础模板（跨层连线必须提供路径点）：**
```xml
<mxCell id="e1"
  style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;
  jettySize=auto;html=0;
  exitX=0.5;exitY=1;exitDx=0;exitDy=0;
  entryX=0.5;entryY=0;entryDx=0;entryDy=0;
  strokeColor=#0052D9;strokeWidth=2;endArrow=block;endFill=1;"
  edge="1" parent="1" source="clb1" target="svc1">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="270" y="400"/>
      <mxPoint x="100" y="400"/>
    </Array>
  </mxGeometry>
</mxCell>
```

**连线颜色：**
| 类型 | strokeColor | strokeWidth |
|------|-------------|-------------|
| 主调用链路 | #0052D9 | 2 |
| 数据流/写入 | #00875A | 1.5 |
| 控制/管理 | #7B2FA0 | 1，dashed=1 |
| 监控/弱依赖 | #9E9E9E | 1，dashed=1 |

### 禁止清单

- ❌ 跨层连线使用空 `<mxGeometry/>` → ✅ 必须提供 `<Array as="points">`
- ❌ 容器内连线穿越图标节点 → ✅ 有阻挡时底部绕行（bypassY = 容器高度-10）
- ❌ 同层服务间画多余连线 → ✅ 只画层间核心数据流
- ❌ 子节点 `parent="1"` → ✅ 必须 `parent="容器id"`
- ❌ ≥4 条出线直接分叉 → ✅ 使用 Bus 汇聚节点
- ❌ value 含 HTML 标签 → ✅ 纯文本 + `html=0;`
- ❌ 同侧多线重复 exitX → ✅ 分槽位（0.25/0.5/0.75）

---

## 完成交付

生成 XML 文件后，AI **自动执行**：
```bash
python scripts/inject_icons.py <文件名>.drawio
```

然后向用户输出：

---

✅ **架构图已完成：`<文件名>.drawio`**

架构共分为 **N 层**：

| 层次 | 主要组件 |
|------|---------|
| 接入层 | WAF、CDN、CLB |
| 应用层 | 推荐服务、视频服务 ... |
| 数据层 | MySQL、Redis、COS ... |

**查看方式：**
- 浏览器：将文件拖入 https://app.diagrams.net/
- VS Code：安装 "Draw.io Integration" 插件后直接打开
- 桌面版：https://github.com/jgraph/drawio-desktop/releases

**修改方式：** 在 Draw.io 中可直接拖动节点、双击改文字、右键 Edit Style 改样式，修改后可导出 PNG/SVG。

---

> 将层次表替换为本次实际内容。

---

## 图标速查表

腾讯云产品节点使用 `style="tcloud-icon:key;html=0;"`，宽高均为 60px。

| 分类 | key | 产品名 |
|------|-----|--------|
| 外部 | `user` | 用户 |
| 外部 | `internet` | 互联网 |
| 网络 | `cdn` | CDN |
| 网络 | `clb` | CLB 负载均衡 |
| 网络 | `nat` | NAT 网关 |
| 网络 | `eip` | 弹性公网 IP |
| 网络 | `direct_connect` | 专线接入 |
| 安全 | `waf` | WAF |
| 安全 | `ddos` | DDoS 防护 |
| 安全 | `cwp` | 主机安全 CWP |
| 安全 | `tcss` | 容器安全 TCSS |
| 计算 | `cvm` | CVM 云服务器 |
| 计算 | `tke` | TKE 容器服务 |
| 计算 | `scf` | SCF 云函数 |
| 计算 | `lighthouse` | Lighthouse |
| 计算 | `as` | 弹性伸缩 AS |
| 存储 | `cos` | COS 对象存储 |
| 存储 | `cbs` | CBS 云硬盘 |
| 存储 | `cfs` | CFS 文件存储 |
| 数据库 | `mysql` | TencentDB MySQL |
| 数据库 | `redis` | TencentDB Redis |
| 数据库 | `mongodb` | MongoDB |
| 数据库 | `tdsql` | TDSQL |
| 数据库 | `cynosdb` | TDSQL-C |
| 中间件 | `apigw` | API 网关 |
| 中间件 | `ckafka` | CKafka |
| 中间件 | `tsf` | TSF 微服务 |
| 监控 | `cm` | 云监控 |
| 监控 | `cls` | CLS 日志服务 |
| 监控 | `cat` | 云拨测 |
| 大数据 | `emr` | EMR |
| 大数据 | `es` | Elasticsearch |

---

## 自检清单（生成 XML 后逐项检查，不输出给用户）

**布局**
- [ ] 每层节点均匀居中分布（无左堆积，右侧无大量空白）
- [ ] 多行节点每行独立居中计算
- [ ] 容器高度足够，节点不溢出
- [ ] 子节点 parent = 容器id

**连线**
- [ ] 全图连线 ≤ 15 条
- [ ] 跨层连线有路径点，y 落在走廊范围内
- [ ] 容器内阻挡连线已绕行
- [ ] ≥4 条出线使用 Bus 节点
- [ ] 同侧无重复 exitX

**文字与图标**
- [ ] 所有节点含 `html=0;`
- [ ] 腾讯云节点使用 `tcloud-icon:key` 占位符
