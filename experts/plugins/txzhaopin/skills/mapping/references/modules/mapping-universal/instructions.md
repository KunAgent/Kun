---
name: mapping-universal
description: >
  通用招聘 Mapping 总调度器（Full Mapping Skill v3.0 总入口）。
  当招聘经理给一份 JD 或一个挖掘需求时，本 Skill 自动：
  ① 解析 JD 行业/岗位/职级/地域
  ② 决定调用哪些底层挖掘 Skill（7 个备选）
  ③ 并行/串行编排底层 Skill 执行
  ④ 多源数据归一化合并
  ⑤ 生成五段式 HTML 招聘报告
  ⑥ 自动入库 org-knowledge-base 知识库（下次秒级命中）

  触发场景：
  - "帮我挖 XX 公司的 XX 团队"
  - "做一份 XX 岗位的招聘 mapping"
  - "XX 公司组织架构"
  - "挖 XX 算法团队 / 产品经理 / 美术 / banker"
  - "XX 公司水下人选"
  - "招聘 mapping" / "team mapping" / "org mapping"

  触发短语：
  "帮我挖"、"做 mapping"、"招聘 mapping"、"XX 团队挖一下"、
  "组织架构挖"、"水下人选"、"mapping-universal"、"全行业 mapping"。

  不触发：纯候选人查询（→ wiki-reader）、纯简历入库（→ wiki-compiler）。
agent_created: true
---

## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# Mapping-Universal — 通用招聘 Mapping 总调度器

## 一、定位

本 Skill 是 Full Mapping Skill 体系的**总入口**。当用户给出一份招聘需求（JD / 挖人意图 / 公司团队画像）时，由本 Skill 调度下方 7 个底层 Skill 协同完成挖掘。

```
┌────────────────────────────────────────────────────────────┐
│  mapping-universal （总调度器 - 本 Skill）                   │
├────────────────────────────────────────────────────────────┤
│       ↓             ↓             ↓             ↓          │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│ │ linkedin│  │  hkex   │  │   sec   │  │deal-news│  ← P0 金融 │
│ │  -deep  │  │prospectus│  │ -filing │  │ -miner  │          │
│ └─────────┘  └─────────┘  └─────────┘  └─────────┘         │
│       ↓             ↓             ↓                         │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐                       │
│ │ author- │  │ github- │  │ artstn  │  ← P0 研发/AI/游戏    │
│ │ filter  │  │ miner   │  │ -finder │                       │
│ └─────────┘  └─────────┘  └─────────┘                       │
│                              ↓                              │
│              ┌───────────────────────────┐                  │
│              │  org-knowledge-base       │  ← 沉淀中枢       │
│              │  （25 公司主体 JSON）      │                  │
│              └───────────────────────────┘                  │
└────────────────────────────────────────────────────────────┘
```

---

## 二、6 阶段总工作流

```
[Stage 1] 5 问问卷对齐招聘画像（含 JD 解析）
[Stage 2] 知识库查重（命中直接返回 HTML）
[Stage 3] 业务线分流 + 加载画像模板
[Stage 4] 调度底层 Skill 并行/串行搜索
[Stage 5] 数据归一化 + 多源合并
[Stage 6] 生成 5 段式 HTML 报告 + 沉淀知识库
```

详见 `scripts/orchestration.md`。
画像模板：`profile-templates/`（investment / engineering / product / operations / generic 5 个业务线）。
渠道路由完整版：`channel-routing.md`（含 P0/P1/P2 分层 + 按层级差异）。
HTML 报告模板：`templates/mapping-report.html.tpl`（深色主题五段式）。

---

## 三、Stage 1: 5 问问卷（必走）

向用户问 5 个问题（一次性提出，不要逐个问）：

```
为了精准 mapping，请回答以下 5 个问题（顺序回答即可）：

1. **目标公司**：要挖哪家公司？（如 GS HK / 腾讯 / 米哈游）
2. **目标部门/岗位**：哪个团队？哪个岗位？（如 IBD / 算法 / 美术 / 投资经理）
3. **目标职级**：MD/VP/Director/Lead/Senior/IC？
4. **地域**：HK / 北京 / 上海 / 全球？
5. **优先级模式**：
   - A. 现状画像优先（找在职的人，认识渠道）
   - B. 履历溯源优先（看做过哪些 deal/项目）
   - C. 能力深度优先（看技术/学术深度）
   - D. 全面 mapping（兼顾所有）
```

不问的话直接默认 D + 全行业基础 Skill。

---

## 四、Stage 2: 知识库查重（关键性能优化）

```python
# 伪代码
def check_kb_hit(company_id, dept, level):
    json_path = f"iWiki 用户目录/01-公司组织库/{company_id}.json"
    if not exists(json_path): return None
    
    data = load_json(json_path)
    matches = [p for p in data["personnel"]
               if matches_dept(p, dept) and matches_level(p, level)]
    
    if len(matches) >= 5:
        return {
            "hit": True,
            "match_count": len(matches),
            "html_url": f"iWiki 用户目录/01-公司组织库/{company_id}.html",
            "last_updated": data["updated_at"]
        }
    return None
```

**命中策略**：
- 完全命中（数据 < 30 天）→ 直接返回，告知用户"已有现成数据"
- 部分命中（数据 30-90 天）→ 增量挖掘，只补缺的
- 完全空白 → 走完整流程

---

## 五、Stage 3: 业务线分流（核心路由表）

按照 JD 关键词，决定调用哪些底层 Skill：

### 5.1 金融行业（投行 / PE / 咨询 / 投资）

| JD 关键词 | 调用 Skill 序列（优先级排序）|
|----------|---------------------------|
| "Investment Banking" / "IBD" / "投行" | linkedin → hkex → sec → deal-news |
| "PE" / "Private Equity" / "私募股权" | linkedin → deal-news → sec-filing（仅看美股 PE 退出）|
| "投资经理" / "Investment Manager" | linkedin → deal-news（看其参与过的 deal）|
| "Counsel" / "律师" / "Partner" | hkex → sec-filing（律所通过招股书披露）|

### 5.2 AI / 算法 / 研发

| JD 关键词 | 调用 Skill 序列 |
|----------|--------------|
| "算法工程师" / "AI Engineer" / "ML" | github-miner → authorfilter → linkedin → deal-news |
| "Research Scientist" / "研究员" | authorfilter → linkedin → github-miner |
| "Senior Software Engineer" / "高级研发" | github-miner → linkedin |
| "Lead / Principal Engineer" | linkedin → github-miner → deal-news |

### 5.3 游戏 / 美术 / CG

| JD 关键词 | 调用 Skill 序列 |
|----------|--------------|
| "Concept Artist" / "原画" | artstation-talent-finder → linkedin（找 Lead 层）|
| "3D Artist" / "建模师" | artstation-talent-finder |
| "Art Director" / "美术总监" | linkedin → artstation-talent-finder |
| "Technical Artist" / "TA" | linkedin → github-miner（看 shader 项目）|

### 5.4 产品 / 运营 / BD

| JD 关键词 | 调用 Skill 序列 |
|----------|--------------|
| "Product Manager" / "产品经理" | linkedin → deal-news |
| "Operations" / "运营" | linkedin |
| "BD" / "Business Development" | linkedin → deal-news |

### 5.5 通用降级

如果无法识别 JD 类型 → 默认 `linkedin-deep-miner`（覆盖最广）

---

## 六、Stage 4: Skill 调度

### 6.1 并行 vs 串行

```python
# 并行（互不依赖）
parallel:
  - linkedin-deep-miner
  - hkex-prospectus-miner
  - sec-filing-miner

# 串行（后者依赖前者）
sequential:
  step 1: linkedin-deep-miner（找到当前在职名单）
  step 2: github-miner（用 step 1 的姓名验证 GitHub）
  step 3: deal-news-miner（用 step 1 + 2 的人查媒体爆料）
```

### 6.2 失败容错

任何底层 Skill 失败 → 跳过，记录到 `open_questions`，不影响整体流程。

### 6.3 预算控制

| 模式 | 调用预算 | 说明 |
|------|---------|------|
| 快速模式 | 单 Skill 4-6 次 search/fetch | 5 分钟内完成 |
| 标准模式 | 3 Skill × 8-10 次 | 15-20 分钟 |
| 深度模式 | 5+ Skill × 15+ 次 | 30-60 分钟 |

---

## 七、Stage 5: 数据归一化

各 Skill 输出格式略有差异，统一归一化为：

```json
{
  "name": "...",
  "company_normalized": "...",
  "title": "...",
  "level": "MD/VP/Director/Senior/...",
  "department": "...",
  "team": "...",
  "city": "...",
  "_sources": {
    "linkedin": {...},
    "hkex": {...},
    "sec": {...},
    "github": {...},
    "authorfilter": {...},
    "deal-news": {...}
  },
  "confidence": "very_high|high|medium",
  "cross_skill_verified": true/false
}
```

**多源合并规则**：
- 多 Skill 同时挖到同一人 → confidence 自动升级
- 字段冲突时（如 LinkedIn 写 "MD"，HKEX 招股书签字写 "Director"）→ 保留两个版本，标 `notes`

详见 `references/skill-routing.md`。

---

## 八、Stage 6: 5 段式 HTML 报告

输出报告必须包含以下 5 段（按顺序）：

```html
[1. 执行摘要]
- 挖掘目标 / 调用 Skill / 总人数 / Top Insights

[2. 团队组织架构图]
- 树形图（来自 org-knowledge-base 标准模板）
- 按部门/职级聚合

[3. 关键人物名单（Top N 高优先级）]
- 跨 Skill 验证过的高 confidence 人选
- 含联系方式建议（LinkedIn URL / GitHub / 论文 / 媒体露出）

[4. 数据置信度热力图]
- 哪些字段是 very_high（多源验证）
- 哪些字段是 medium（单源 / snippet）
- 哪些是 open_questions（未挖到）

[5. 待办与下一步]
- 知识库已更新文件清单
- 建议手动 follow-up 的人选
- 时效性提醒（数据 > 6 个月时建议重跑）
```

---

## 九、典型案例

### 案例 1：JD = "GS HK TMT MD/ED Coverage Banker"

```
Stage 1: 解析 → company=GS, dept=TMT, level=MD/ED, geo=HK
Stage 2: 查重 → gs-ibd.json 已存在（37 人），但 30 天未更新
Stage 3: 路由 → 金融行业 → linkedin + hkex + sec + deal-news
Stage 4: 并行执行 4 个 Skill
Stage 5: 合并到 gs-ibd.json
Stage 6: 输出 HTML（聚焦 TMT MD/ED 的子图 + 新增 deal 履历）
```

### 案例 2：JD = "ByteDance LLM Inference Engineer (vLLM 经验)"

```
Stage 1: 解析 → company=bytedance, dept=Seed/AI, level=Senior, skill=vllm
Stage 2: 查重 → bytedance.json 已有 authorfilter 入库的 12 人
Stage 3: 路由 → AI/研发 → github (优先) + authorfilter + linkedin
Stage 4: 串行：先 github 找 vllm contributors at @bytedance → 再 linkedin/authorfilter cross verify
Stage 5: 入库 bytedance.json（标 vllm-skill: true）
Stage 6: HTML 输出 vLLM 专项小图
```

### 案例 3：JD = "米哈游 角色原画 Senior"

```
Stage 1: company=mihoyo, dept=美术, level=Senior, geo=Shanghai
Stage 2: 查重 → mihoyo.json 已有 artstation 入库的 12 人
Stage 3: 路由 → 游戏/美术 → artstation (优先) + linkedin (Lead)
Stage 4: artstation 跑过则跳过，直接调 linkedin 找 Lead Concept Artist
Stage 5: 入库 mihoyo.json
Stage 6: HTML 美术线树形图
```

---

## 十、输出契约

最终入库到 `iWiki 用户目录/01-公司组织库/{company_id}.json`，HTML 渲染到 `charts/{company_id}.html`。

详见 `references/skill-routing.md` 和 `references/intent-parsing.md`。

---

## 十一、版本

- **v1.0** (2026-04-28): 首版发布。覆盖 4 业务线（investment / engineering / product / operations）+ 通用 fallback；5 问问卷；五段式 HTML 报告。
  - 资产：`README.md` / `channel-routing.md` / `profile-templates/×5` / `templates/mapping-report.html.tpl`
- **v3.0** (2026-06-10): 整合 7 个底层挖掘 Skill（linkedin-deep-miner / hkex-prospectus-miner / sec-filing-miner / deal-news-miner / authorfilter / github-miner / artstation-talent-finder），新增意图解析 + 调度编排能力。
  - 新增：`references/intent-parsing.md` / `references/skill-routing.md` / `scripts/orchestration.md`
  - v3.0 完全兼容 v1.0 的画像模板和 HTML 模板，把 v1.0 的"通用渠道概念"具象为对 7 个独立可执行 Skill 的精确派发。
- 与 wiki-reader / wiki-evolver 互补（一个挖掘、一个查询、一个进化）
