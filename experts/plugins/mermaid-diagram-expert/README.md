# Mermaid 图表设计与渲染专家 — Mia

将自然语言转化为专业级 Mermaid 图表，秒级渲染出版级 SVG/ASCII 可视化。

## 类型

Agent 型（单专家）

## 功能

### 核心能力
1. **需求理解** — 从自然语言描述中准确提炼图表结构
2. **代码编写** — 精通 Mermaid 全部语法，支持 6 种图表类型
3. **主题配色** — 15 种内置主题 + 自定义配色方案
4. **渲染输出** — SVG 矢量图和 ASCII 字符图双模式

### 支持的图表类型
| 类型 | 说明 |
|------|------|
| 流程图 (Flowchart) | 业务流程、系统架构、决策树 |
| 时序图 (Sequence) | API 交互、微服务通信 |
| 类图 (Class) | 面向对象设计、UML |
| ER 图 (Entity Relationship) | 数据库设计 |
| 状态图 (State) | 状态机、生命周期 |
| XY 数据图表 (XY Chart) | 柱状图、折线图、混合图 |

### 渲染特性
- ELK.js 层次化布局引擎（正交路由）
- 同步渲染 < 50ms
- 15 种 Light/Dark 内置主题
- CSS 自定义属性实时切换
- 透明背景嵌入模式
- 形状感知边缘裁剪

## 技能

| 技能名 | 说明 |
|--------|------|
| mermaid-render | Mermaid 图表渲染工具集，含 SVG/ASCII 渲染脚本和完整参考资料 |

## 使用示例

- 画一个用户登录认证流程图
- 画一个电商系统的 ER 实体关系图
- 设计一个微服务架构的时序交互图
- 画一个订单状态机图
- 用折线图展示最近6个月的用户增长数据
- 帮我画一个 React 组件的类图

## 环境要求

- Node.js 18+
- 首次使用需执行安装脚本：`bash skills/mermaid-render/scripts/setup.sh`

## 头像

头像已放在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
zip -r mermaid-diagram-expert.zip mermaid-diagram-expert/
```
