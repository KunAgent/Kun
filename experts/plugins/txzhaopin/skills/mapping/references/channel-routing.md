# 🧭 Channel Routing · 挖掘渠道映射表

> 从 5 问问卷的"业务线 × 层级 × 深度"自动路由到底层挖掘 Skill 池的决策表。
> 维护者：招聘 Mapping 团队 · v1.0.0

---

## 一、通用底层 Skill 池（所有业务线共享）

| Skill | 用途 | 输入 | 输出 |
|-------|------|------|------|
| `linkedin-public-miner` | LinkedIn Dorking | 公司名 + Title 关键词 | 具名 + 当前职位 + 教育 |
| `google-snapshot-spa-bypass` | 绕 SPA 官网反爬 | 公司官网 URL | 团队页成员列表 |
| `alumni-network-miner` | 校友反查 / 离职追踪 | 公司名 + 关键人物 | 前员工 + 当前去向 |
| `zhihu-miner` | 面经 / 内部情报 | 公司名 + 岗位 | Junior 层候选人 + 内部流程 |

---

## 二、业务线专属调度

### 📈 投资（investment）

| 优先级 | 渠道 | 对应 Skill / 工具 | 命中特点 |
|-------|------|-----------------|---------|
| P0 | LinkedIn Dorking | `linkedin-public-miner` | Senior 层 LinkedIn 实名率 80%+ |
| P0 | 基金官网 Team 页 | web_fetch | Top 100% 全覆盖 |
| P0 | 36氪 / 投资界 / Pitch Hub | web_search | 媒体曝光高 |
| P1 | HKEX 招股书保荐人 | `hkex-prospectus-miner` | 法定披露 100% 具名 |
| P1 | SEC EDGAR F-1/S-1 | `sec-filing-miner` | 美股 IPO 承销团队 |
| P1 | 媒体 Deal 署名 | `deal-news-miner` | 交易角色可追溯 |
| P1 | 公众号（暗涌 / 投中 / 胡润 / 钛媒体） | web_search | 高质量采访 |
| P2 | 知乎 VC/PE 面经 | `zhihu-miner` | Junior 层 |
| P2 | 校友反查（北大 / 清华 / 复旦 / Booth / Wharton） | `alumni-network-miner` | 跨公司联通 |
| P2 | SignalHire / RocketReach | 手动 | 需付费 |

### 💻 研发工程（engineering）

| 优先级 | 渠道 | 对应 Skill / 工具 | 命中特点 |
|-------|------|-----------------|---------|
| P0 | LinkedIn Dorking | `linkedin-public-miner` | Senior 层 |
| P0 | **GitHub 仓库贡献者** | web_search `site:github.com` | 技术可验证 |
| P0 | 公司 Engineering Blog | web_fetch | 作者署名 |
| P1 | **arXiv / Google Scholar 论文作者** | web_search | AI/算法核心人才 |
| P1 | **技术博客**（掘金 / InfoQ / CSDN） | web_search | Mid 层 |
| P1 | 知乎技术大 V | `zhihu-miner` | Junior-Mid |
| P1 | **开源项目 maintainer** | GitHub API / 项目 OWNERS | 技术 Leader |
| P1 | **技术大会演讲者**（QCon / ArchSummit / NeurIPS 中国 Meetup） | web_search | Senior+ |
| P2 | 牛客 / LeetCode 竞赛排名 / ACM 金牌 | web_search | Top 应届 |
| P2 | 脉脉匿名区 | 手动 / Pro | 内部情报 |

### 🎯 产品经理（product）

| 优先级 | 渠道 | 对应 Skill / 工具 | 命中特点 |
|-------|------|-----------------|---------|
| P0 | LinkedIn Dorking | `linkedin-public-miner` | Mid+ |
| P0 | 公司官网 About / 产品页 | web_fetch | Top 层 |
| P0 | **公众号署名**（人人都是产品经理 / PMCAFF / PMtalk） | web_search | 活跃 PM |
| P1 | 知乎产品话题答主 | `zhihu-miner` | 大 V |
| P1 | **Product Hunt 作者** | web_search | 海归 / 创业型 |
| P1 | **起点学院 / 馒头商学院讲师** | web_search | Senior |
| P1 | **产品书籍 / 白皮书作者** | web_search | Senior+ |
| P1 | **小红书 / 即刻 PM 标签** | web_search / 手动 | Mid |
| P2 | 脉脉产品标签 | 手动 / Pro | 全层级 |
| P2 | IT 桔子 / 36氪创始人库 | web_search | 创业背景 |

### 📣 运营（operations）

| 优先级 | 渠道 | 对应 Skill / 工具 | 命中特点 |
|-------|------|-----------------|---------|
| P0 | LinkedIn Dorking | `linkedin-public-miner` | 外企 / 国际化 |
| P0 | **小红书 KOL** | 小红书搜索（需登录） | 内容 / 用户运营 |
| P0 | **抖音职场博主** | web_search | 全运营 |
| P1 | 运营公众号（运营研究社 / 运营派 / 三节课） | web_search | 方法论派 |
| P1 | **案例库署名**（M 奖 / TMA / 金瞳奖） | web_search | Senior+ |
| P1 | **行业报告作者**（艾瑞 / QuestMobile） | web_search | 数据运营 |
| P1 | 运营大会演讲者（MAD Conf / 新榜） | web_search | Senior |
| P2 | 知乎运营答主 | `zhihu-miner` | Mid |
| P2 | 即刻社群 / 飞书运营社群 | 手动 | 圈层深度 |
| P2 | 脉脉运营标签 | 手动 / Pro | 全层级 |

### 🧩 通用 Fallback（generic）

参见 `profile-templates/generic.md` § 三，按岗位类型选 3-5 个渠道。

---

## 三、按深度的调度差异

### ⚡ 快速模式（问卷问题 5 · A · 15-20 分钟）

**只跑 P0 渠道**：
- 3-5 路并行搜索
- 不做 web_fetch 深挖，只抓基本信息
- 只交付 § 1（架构图）+ § 4（水下挖掘建议）
- § 2 / § 3 / § 5 留空 + 标注"快速模式未生成"

### 🎯 标准模式（问卷问题 5 · B · 30-45 分钟）

**跑 P0 + P1 的前 60%**：
- 10-15 路并行搜索
- 3-5 个关键 URL 做 web_fetch
- 五段全出，但 § 3 横向对比只列 2-3 家 peer
- § 5 离职追踪只列 Top 3 已知 Alumni

### 🔬 深度模式（问卷问题 5 · C · 60-90 分钟）

**跑 P0 + P1 + P2 全部**：
- 20+ 路并行搜索
- 10-15 个 URL 深度 web_fetch
- 五段完整交付
- 额外生成"第 2 轮挖掘 brief"（`open_questions` 详细版）
- 触发 `wiki-evolver` 沉淀建议

---

## 四、按层级的调度差异

### Top 层（VP / Partner / 总负责人）

- **命中率最高**：70-100%（公司官网 + 媒体 PR 覆盖）
- **主战场**：官网团队页 / 媒体采访 / LinkedIn 认证
- **无需 P2 渠道**（省时间）

### Senior 层（总监 / Director / MD）

- **命中率中高**：50-80%
- **主战场**：LinkedIn + 媒体 Deal 署名 + 技术博客 / 产品分享
- **必跑 P0 + P1**

### Mid 层（Manager / Principal / Senior Engineer）

- **命中率中等**：30-60%
- **主战场**：LinkedIn + 知乎 / 技术博客 + 脉脉
- **P2 价值开始显现**

### Junior 层（Analyst / Associate / SDE）

- **命中率低**：10-30%
- **主战场**：知乎面经 / 牛客 / 小红书晒 offer
- **必跑 P2**（校园社区 / 实习僧 / 面经平台）
- **注意**：Junior 层开源搜索效率低，建议配合「需账号平台 + 内推」

---

## 五、调度决策树（AI 心中执行）

```
┌─ 画像 = (业务线 × 层级 × 深度)
│
├─ IF 业务线 == "investment":
│    └─ LOAD profile-templates/investment.md
│         └─ 按深度跑 P0/P1/P2 投资专属渠道
│
├─ ELIF 业务线 == "engineering":
│    └─ LOAD profile-templates/engineering.md
│         └─ 必加：GitHub + arXiv + 技术博客
│
├─ ELIF 业务线 == "product":
│    └─ LOAD profile-templates/product.md
│         └─ 必加：公众号署名 + Product Hunt + 即刻
│
├─ ELIF 业务线 == "operations":
│    └─ LOAD profile-templates/operations.md
│         └─ 必加：小红书 + 抖音 + 案例库署名
│
└─ ELSE:
     └─ LOAD profile-templates/generic.md
          └─ 追加 3 个澄清问题 → 动态路由
```

---

## 六、版本记录

- v1.0.0 · 2026-04-28：首版，覆盖 4 业务线 + 通用 fallback
- 未来：按 level 做更细致的渠道 ROI 统计，持续优化 P0/P1/P2 分层
