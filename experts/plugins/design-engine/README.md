# 设计引擎团队（Design Engine Team）

AI 驱动的设计原型专家团，将你的想法转化为品牌级设计产出。

## 类型

Team 型（专家团）

## 功能

6 位专业角色组成的 AI 设计团队，覆盖从需求发现到最终交付的完整设计工作流：

1. **需求发现** — 通过 5 维度问卷明确设计需求
2. **设计系统选择** — 从 71 套品牌级设计系统中匹配最佳方案
3. **原型生成** — 生成 9 种类型的高保真 HTML 原型
4. **质量审查** — 5 维度评审 + Anti-Slop 门控确保品牌级质量
5. **多格式导出** — 支持 HTML / PDF / PPTX / ZIP 导出

## 核心优势

- **71 套设计系统**：覆盖 Linear、Stripe、Vercel、Apple、Tesla、Notion 等顶级品牌
- **Anti-Slop 机制**：严格的质量门控，杜绝 AI 生成的平庸设计
- **5 种视觉方向**：Editorial Monocle / Modern Minimal / Tech Utility / Brutalist / Soft Warm
- **品牌提取协议**：5 步法从已有品牌资产中提取设计规范

## 技能（Skills）

| 技能名 | 说明 |
|--------|------|
| design-systems | 71 套品牌级设计系统知识库 + 9 段结构规范 + 品牌提取协议 |
| quality-review | 5 维度评审标准 + Anti-Slop 检测清单 + P0/P1/P2 门控 |
| prototype-templates | 9 种原型模板结构定义 + 代码规范 |

## 团队成员

| 角色 | 名称 | 职责 |
|------|------|------|
| 主理人 | Atlas | 全流程编排，需求分派，结果综合 |
| 需求发现师 | Scout | 引导用户明确设计需求（场景/受众/调性/品牌/规模） |
| 设计系统专家 | Palette | 从 71 套系统中选择最佳方案，生成设计令牌 |
| 原型构建师 | Forge | 基于设计系统生成 HTML/CSS 高保真原型 |
| 质量审查官 | Lens | 5 维评审 + Anti-Slop 检测，确保品牌级质量 |
| 导出专家 | Porter | 多格式导出（HTML/PDF/PPTX/ZIP） |

## 使用示例

- "用 Stripe 风格设计一个 SaaS 落地页"
- "设计一套移动端引导流程"
- "用 Linear 风格做一个数据仪表盘"

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
zip -r design-engine.zip design-engine/
```

## 致谢

本专家团的设计方法论和知识体系部分参考了 [Open Design](https://github.com/nexu-io/open-design)（Apache-2.0）项目的设计系统规范、Anti-Slop 机制和质量控制框架。
