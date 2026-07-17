# 阶段 1：画像生成与用户确认（v4 参考）

## 本文件定位

本文件是 SKILL.md 阶段 1 的**补充参考**，包含：
1. AI 扩展白名单规则
2. profile.json 结构（供阶段 3 粗筛脚本使用）
3. 画像 JSON 中间格式示例（模型内部使用，不对用户展示）

> 主流程定义在 SKILL.md → 阶段 1，本文件不重复。

---

## AI 扩展的严格白名单 🔴

只有以下字段允许扩展，**用户明确指定时也一律禁止扩展**：

| 字段 | 是否允许扩展 | 说明 |
|---|---|---|
| `locations`（城市） | ❌ **绝对禁止** | 用户说深圳就深圳 |
| `supportNoExpectCity`（v6.1.0 新增，布尔） | 🟡 **用户决策位** | 必须问用户："是否纳入期望城市为空的候选？"。用户不答默认 `false` |
| `workYears`（工作年限） | ❌ **绝对禁止** | 用户说 5-8 年就 5-8 年 |
| `minDegree`（学历） | ❌ **绝对禁止** | - |
| `schoolLevels`（学校层次） | ❌ **绝对禁止** | - |
| `schoolNames`（具体学校名） | ❌ **绝对禁止** | - |
| `companies`（用户明确指定时） | ❌ **绝对禁止** | 用户说"只要字节" → 不可扩展到阿里/美团 |
| `companies`（用户未提时） | ✅ 允许 | **🆕 v6.2.0**：由模型基于用户的岗位/行业/技术栈**现场生成** TOP 10 候选公司供用户勾选（详细生成约束见 SKILL.md 阶段 2 公司锚定路一节） |
| `position_keywords`（职位名称） | ✅ 允许 | 扩展同义词/相近岗位 |
| `skill_keywords`（核心技能） | ✅ 允许 | 扩展同义词、上下游技能 |
| `domain_keywords`（业务领域） | ✅ 允许 | 扩展相关业务、领域上下游 |
| `project_keywords`（项目经验） | ✅ 允许 | 扩展类似项目类型的同义表达 |

---

## profile.json 结构（阶段 3 粗筛脚本入参）

模型在画像确认后，需要生成 `profile.json` 供 `rough_screen.py` 使用：

```json
{
  "must": {
    "locations": ["深圳"],
    "supportNoExpectCity": false,
    "workYears": {"min": 5, "max": 8},
    "minDegree": "本科",
    "schoolLevels": ["985","211"],
    "companies": []
  },
  "bonus": {
    "tier1_companies": ["字节跳动","阿里","美团"],
    "position_keywords": ["存储","后台"],
    "seniority_keywords": ["高级","专家","资深"],
    "skill_keywords": ["分布式存储","对象存储"],
    "domain_keywords": ["云存储","网盘"]
  }
}
```

**字段转换规则**：
- 画像中「必要条件」→ `must` 对应字段
- 画像中「加分条件」→ `bonus` 对应字段
- `must.supportNoExpectCity`（v6.1.0 新增）：由用户在阶段 1 的"城市口径确认"环节决定，同时写入 search_params.json 和 profile.json，两边保持一致
- `must.companies`（v6.1.1 语义明确）：用户明指的必要公司列表，语义是"候选人必须在**全部工作经历**中待过这些公司之一"。
  - 阶段 2 **必须**把它写入 `search_params.json` 的 `common_params.mustCompanies`，`social_search.py` 自动下发所有 route 的 `allCompany`
  - 粗筛层不做硬过滤（会误杀最近不在目标公司的人），由搜索端兜底
  - 精读层也不做公司核对（搜索端已保证）
  - ⚠️ **不要**把"优先 XX 公司"放在 `must.companies`，应放在 `bonus.tier1_companies`
- `bonus.tier1_companies` 建议始终填充（用户已指公司时也要填）——两者职责不同：
  - `must.companies`：所有结果必然命中（搜索端硬约束）
  - `bonus.tier1_companies`：粗筛加权排序（哪家大厂排前面）
- `bonus` 全部字段参与粗筛四维加权打分（v6.1.0，见 step4-rough-read-fields.md），**填写质量直接影响粗筛命中率**，建议每个子字段填 3-10 个关键词

---

## 画像内部 JSON 示例（非必须，模型可直接转换为 profile.json）

```json
{
  "raw_query": "帮我找 5-8 年的推荐算法专家，字节最佳，在深圳",
  "must": {
    "locations": {"values": ["深圳"], "source": "user_input"},
    "workYears": {"min": 5, "max": 8, "source": "user_input"},
    "minDegree": {"value": "本科", "source": "ai_expanded", "reason": "推荐算法岗默认本科起步"}
  },
  "bonus": {
    "position_keywords": {"values": ["算法专家","推荐算法工程师"], "source": "ai_expanded"},
    "skill_keywords": {"values": ["推荐算法","召回","排序","CTR"], "source": "ai_expanded"}
  },
  "soft_criteria": ["最好有冷启动项目 0-1 搭建经验"],
  "confirmed": false
}
```

模型可选择：直接在阶段 1 结尾生成 profile.json，或在阶段 2 结束后再转换。

---

## 🆕 v6.2.0：`bonus.tier1_companies` 是会话内的唯一公司清单源

自 v6.2.0 起，`data/tier1-companies-by-domain.json` 已下线，公司清单全部由 LLM 现场生成。为避免"阶段 1 一份 / 阶段 2 又一份"的抖动，建立如下唯一来源约定：

| 阶段 | 动作 | 数据 |
|---|---|---|
| 阶段 1（画像生成） | LLM 基于岗位/行业**现场生成** 10-20 家公司，写入 `profile.bonus.tier1_companies` | 唯一数据源（single source of truth）|
| 阶段 2（搜索参数生成 · 公司锚定路） | **直接照搬** `profile.bonus.tier1_companies` 作为该路的 `allCompany`，禁止重新列 | 复用 |
| 阶段 3（粗筛 · 维度 2 加权打分） | `rough_screen.py` 直接读 `profile.bonus.tier1_companies` 做子串匹配 | 复用 |

**禁止做的事**：
- ❌ 阶段 2 重新组织一份和阶段 1 不一样的 tier1 清单
- ❌ 在 `search_params.json` 里手动列公司（除非该路是公司锚定路，且是从 `profile.bonus.tier1_companies` 复制过来的）
- ❌ 用户明指公司时把 `must.companies` 的内容塞进 `bonus.tier1_companies`（两者职责完全不同，详见上一节）

**LLM 生成 `bonus.tier1_companies` 的硬约束**（完整版见 SKILL.md 阶段 2 公司锚定路一节）：
- 数量 10-20 家、用腾讯 ATS 规范名、真实存在仍运营、综合大厂与行业垂类合理搭配、行业垂类 ≥ 5 家
- 生成前自检"ATS 是否搜得到"，避免幻觉公司名
- 同一会话只生成一次，阶段 2/3 全部复用
