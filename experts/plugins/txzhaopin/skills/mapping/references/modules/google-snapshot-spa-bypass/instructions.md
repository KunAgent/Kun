---
name: google-snapshot-spa-bypass
description: |
  Google Snapshot SPA Bypass 挖掘器。突破 JavaScript 单页应用（SPA）官网的反爬限制，
  通过 Google 缓存的 snippet 批量提取团队成员信息。
  适用于 React/Vue SPA 官网，直接 web_fetch 只能拿到 "Loading..." 的情况。
  触发场景：
  - 目标公司官网是 SPA，直接抓取失败
  - 公司官网有 /team/{1-N} 或 /people/{name} 规律 URL
  - 需要快速覆盖 Tier 2+ VC / Boutique 投行 / 律所团队
  触发短语：
  "官网抓不到"、"官网是 SPA"、"抓不了团队页"、"扫 team 编号"、
  "Google 快照"、"绕官网反爬"、"bypass SPA"、"google-snapshot-spa-bypass"。
description_zh: "Google 快照绕 SPA — 官网抓不到时的奇招"
description_en: "Google Snapshot SPA Bypass — extract SPA team pages via indexed snippets"
version: "1.0.0"
meta_rules:
  - no-hallucination@1.0.0
---

# 🔓 Google Snapshot SPA Bypass · 官网反爬绕过

> 📌 本 Skill 遵守 [`rules/no-hallucination.md`](../../rules/no-hallucination.md)

---

## 一、使用目的

许多现代公司（特别是 VC/PE/律所/精品投行）官网使用 React/Vue SPA 架构，直接用 `web_fetch` 只能拿到 "Loading..." 或空白页。但 **Google 索引器会执行 JS 并缓存 snippet**，这些 snippet 通常包含：

- 团队成员姓名
- 加入时间
- 简短背景 / 覆盖赛道
- 教育背景片段

**本 Skill 提供一套标准流程，把 Google 缓存的碎片拼接成结构化数据。**

---

## 二、触发场景

- 目标公司官网是 SPA，直接抓取失败
- 公司官网有 `/team/{1-N}` 或 `/people/{name}` 这类规律 URL
- 需要快速覆盖 Tier 2+ VC / Boutique 投行 / 律所团队

---

## 三、操作 SOP（4 步）

### Step 1：识别 URL 规律

先 `web_fetch` 官网 `/team` 或 `/about` 页，查看 response 结构：

- 如果是 `<div id="root"></div>` + 大量 JS = 典型 SPA
- 查看源码中的 router 配置或 sitemap，推测 `/team/{N}` 或 `/people/{slug}`

### Step 2：批量扫 Google Snapshot

```
# 一次 web_search 扫 4 个编号
site:{domain}/team/1 OR site:{domain}/team/2 OR site:{domain}/team/3 OR site:{domain}/team/4

# 继续 5-8, 9-12, 13-16, 17-20...
```

### Step 3：提取 snippet 结构化

每条 Google 结果的 snippet 通常包含：
- 姓名（中英文）
- 加入年月
- 覆盖方向（1-2 个关键词）
- 教育背景 1-2 句

写入 JSON：

```json
{
  "id": "person-{slug}",
  "name_cn": "...",
  "name_en": "...",
  "joined_date": "...",
  "coverage": ["..."],
  "source": "{company} 官网 team/{N}（Google 快照）",
  "source_urls": ["https://{domain}/team/{N}"],
  "confidence": "high | medium | low",
  "mining_method": "google-snapshot"
}
```

### Step 4：交叉验证（推荐）

对拿到的名字再用：
- `site:linkedin.com/in/ "{name}" "{company}"` 验证职位
- RocketReach / ContactOut 验证邮箱
- 公司相关新闻验证离职状态

---

## 四、实战案例（云启资本 2026-04-20）

**背景**：`yunqi.vc` 官网是纯 SPA，`web_fetch` 拿不到团队成员。

**执行**：

```
Google 扫 team/1 ~ team/20（5 次 web_search 完成）
```

**收获**（45 分钟）：

| team/# | 姓名 | 加入 | 方向 |
|--------|------|------|------|
| 4 | 冯瑶 | 2015.8 | 产业数字化/出海/AI 应用 |
| 5 | 韩义 | 2018.8 | Enterprise Tech / AI2B / 先进制造 |
| 10 | 桑煜 | 2021 | 具身智能 / 智能驾驶 |
| 11 | 李娜 | 2016.2 | 基金组织 / 品牌 / 投后 |
| 13 | Cynthia Ng | 2014.6 | Finance & IR |
| 16 | 崔巍 | 2024.11 | 人民币基金 IR + 政企合作 |
| 17 | 梁昊 | 2019 | AI 前沿 / 跨境出口 |

**6 人全部命中**，无需花费 LinkedIn Sales Navigator 费用。

---

## 五、适用范围（已验证）

- ✅ 所有中小 VC 官网（云启、真格、险峰、蓝驰、经纬 1.0 版）
- ✅ 精品投行 Boutique（中金前身、华兴早期）
- ✅ 律所合伙人页（盛德、君合、方达）
- ✅ 欧美家族办公室 / Boutique PE 官网
- ⚠️ 大型机构（高盛、摩根等）官网有 SSR，本法价值较低
- ❌ 官网做了 robots.txt 阻止索引的（罕见）

---

## 六、合规

- ✅ Google Snapshot 是搜索引擎**公开缓存**
- ✅ 所有 snippet 原则上都是网站 public 版本
- ❌ 不得用于抓取明确标了 `noindex` 的页面
- ❌ 不得对 Google 高频请求（触发 rate limit）

---

## 七、与其他 Skill 的协作

| Skill | 关系 |
|-------|-----|
| `mapping-universal` | 上游调度（所有业务线 P0，官网挖不到时触发） |
| `linkedin-public-miner` | 下游（snippet 拿到的姓名 → LinkedIn 验证职位） |
| `github-miner` | 互补（研发岗可交叉） |

---

## 八、Changelog

### v1.0.0 · 2026-04-28（合并历史版本）

- 加入标准 frontmatter
- 加入 no-hallucination meta-rule 声明
- 保留原有 4 步 SOP + 云启案例

### v0.1（2026-04-21，历史）

- 首次提交。源自云启资本 Round 2 挖掘实战
