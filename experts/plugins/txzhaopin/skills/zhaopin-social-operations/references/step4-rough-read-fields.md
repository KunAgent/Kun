# 阶段 3b：粗筛规则参考（v6.1.1）

## 本文件定位

详细说明 `rough_screen.py` 的内部逻辑，供调试和理解使用。

> 主流程定义在 SKILL.md → 阶段 3b，本文件是补充参考。

---

## v6.1.2 变化

- **`top_rids.json` 输出瘦身**：兼容小上下文模型的 `read_file` 字符上限（如 Hunyuan3.0 的 100k 字符）。`top_detail` 分档输出：
  - **前 10 条**（阶段 4 表格 + 粗筛说明要用）：基础字段 + `highLightOthers`（前 3 条，每条只留 `shortContent` 截断 150 字符）+ `score_breakdown` 的 hits 摘要（`company_hits`/`title_hits`/`keyword_hits`）
  - **11-30 条**（精读候选池，模型不直接看）：只保留基础身份字段，去掉 `highLightOthers` 和 `score_breakdown` 明细
- `top_rids` 数组（30 个完整 UUID）不变，精读 `deep_read.py` 正常运行
- `--dump rough_audit.json` 仍输出完整原始 30 条数据，审计能力不丢
- 预期文件体积：~275 KB → ~10-15 KB（减小 96%）

## v6.1.1 变化

- **删除 `must.companies` 硬过滤**：粗筛只能看 `lastEmployerName`（最近一家），无法
  判断候选人是否早年待过目标公司，会误杀"早年腾讯 + 最近创业公司"这类人。公司硬
  约束改由搜索端 `mustCompanies`（`social_search.py` 自动下发到每条 route 的
  `allCompany`）兜底，由 MCP 后端基于简历全部工作经历做命中。
- `bonus.tier1_companies` 加权逻辑不变（维度 2，权重 2.5）。
- 其余硬约束（城市/年限/学历/学校）不变。

---

## 粗筛脚本用法

```bash
python rough_screen.py \
    --input candidates.jsonl \
    --profile profile.json \
    --top-n 30
```

可选：`--dump rough_audit.json`（落盘审计，排查用）

---

## 硬约束检查（不满足直接 excluded）

| 检查项 | 逻辑 |
|---|---|
| 城市 | `workPlace` 或 `expectWorkCitys` 包含 `must.locations` 任一项；**v6.1.0**：若 `must.supportNoExpectCity=true` 且简历 `expectWorkCitys` 为空 → 也通过（对齐搜索端双子请求语义）|
| 工作年限 | `workYearsNumber` 在 `[must.workYears.min, must.workYears.max]` 闭区间内 |
| 学历 | `lastEduLevel` 的等级 ≥ `must.minDegree` 等级（高中<大专<本科<硕士<博士） |
| 学校层次 | `educationList` 任一项的 985/211/C9/海外/双一流 tag 命中 `must.schoolLevels` |
| ~~用户明指公司~~ | **v6.1.1 已删除**：由搜索端 `mustCompanies` 兜底 |

---

## 打分逻辑（v6.1.0 四维加权）

```
total_score = highlight × 1.0
            + company  × 2.5
            + title    × 2.0
            + keyword  × 1.5
```

### 维度 1 · highlight（权重 1.0，无上限）
- **来源**：`len(highLightOthers)`（保留原搜索相关性，防止完全跑偏）
- **意图**：搜索命中条数越多，搜索相关性越高

### 维度 2 · company（权重 2.5，上限 2）
- **来源**：`lastEmployerName` 子串匹配 `bonus.tier1_companies`
- **规则**：每命中一个不同 tier1 公司 +1，上限 2
- **意图**：大厂背景是极强的行业对口信号，解决"标签对但行业跑偏"问题

### 维度 3 · title（权重 2.0，上限 3）
- **来源**：`lastEmployerTitle` 子串匹配
- **规则**：
  - 命中 `bonus.position_keywords` 每个 +1
  - 命中 `bonus.seniority_keywords` 每个 +0.5
  - 每个关键词只记 1 次，上限 3
- **意图**：职位名是最强的岗位锚定信号

### 维度 4 · keyword（权重 1.5，上限 5）
- **来源**：`highLightOthers[*].shortContent + allContent` 聚合成大文本（剥 HTML）
- **规则**：大小写不敏感，命中 `bonus.skill_keywords + bonus.domain_keywords` 每个关键词 +1（不同关键词只记 1 次），上限 5
- **意图**：区分"高亮里出现技术/业务关键词"vs"高亮里随便命中了个泛词"

### 向后兼容
- `profile.bonus` 为空对象 → 维度 2/3/4 全 0，仅维度 1 起作用 → 等同旧 v4.1 纯高亮行为

### 示例：两个候选对比

同一职位 Q1 游戏客户端搜索：

| 候选 | 最近雇主 | 职位 | 高亮条数 | tier1 命中 | title 命中 | keyword 命中 | 总分 |
|---|---|---|---|---|---|---|---|
| A | 比亚迪 | 高级开发工程师 | 5 | 0 | 0 | 0 (技术栈与游戏无关) | 5×1.0 = **5** |
| B | 网易互娱 | 游戏开发工程师 | 3 | 1 (网易) | 1 (游戏开发) | 2 (Unity, 战斗系统) | 3×1.0 + 1×2.5 + 1×2.0 + 2×1.5 = **10.5** |

旧版只看高亮数：A（5）> B（3），A 排前 → 错误
新版四维加权：B（10.5）> A（5），B 排前 → 正确

---

## 分档阈值（v6.1.0）

| 档位 | 条件 | 说明 |
|---|---|---|
| A 档 | `score ≥ 8` | 强匹配 |
| B 档 | `score ≥ 3` | 中匹配 |
| C 档 | `score ≥ 0` | 弱匹配（通过硬约束） |
| excluded | 硬约束失败 | 直接剔除 |

---

## Top N 选取顺序

A 档全部 → B 档按 score 降序 → C 档按 score 降序，取前 N 个。

---

## 输出方式

- **主产物（文件）**：`top_rids.json`（v6.1.2 瘦身后）
  ```json
  {
    "top_rids": ["uuid1", "uuid2", ...],   // 完整 30 个 UUID（精读 deep_read 用）
    "top_detail": [
      // 前 10 条：完整精简版
      {
        "rid": "...",
        "name": "...",
        "lastEmployerName": "...",
        "lastEmployerTitle": "...",
        "lastEduSchool": "...",
        "lastEduLevel": "...",
        "workYearsText": "...",
        "score": 10.5,
        "tier": "A",
        "evidence": "网易[tier1] + title命中:游戏开发 + 关键词:Unity/战斗系统 + 高亮3处",
        "highLightOthers": [
          {"shortContent": "..."}    // 截断 150 字符，去 HTML 标签
        ],
        "score_breakdown": {
          "company_hits": ["网易"],
          "title_hits":   ["游戏开发"],
          "keyword_hits": ["Unity","战斗系统"]
        }
      },
      // 11-30 条：极简身份版（无 highLightOthers / 无 score_breakdown）
      {
        "rid": "...",
        "name": "...",
        "lastEmployerName": "...",
        "lastEmployerTitle": "...",
        "lastEduSchool": "...",
        "lastEduLevel": "...",
        "workYearsText": "...",
        "score": 8.0,
        "tier": "A",
        "evidence": "..."
      }
    ],
    "stats": {...}
  }
  ```
  ⚠️ Agent 必须用 `read_file top_rids.json` 获取完整 UUID 列表，**不要尝试从 stdout 解析 rid**。

- **审计档（可选）**：`--dump rough_audit.json` 输出完整原始 30 条（含 allContent/完整 score_breakdown），仅排查问题用。

- **stdout（轻量摘要）**：
  ```json
  {"status": "ok", "output_file": "/abs/path/top_rids.json", "top_count": 30, "stats": {...}}
  ```
  仅用于确认脚本是否成功，不含完整 rid 列表。

---

## 闸门判断

- **A + B ≥ 10 条** → 精读预算充足，进阶段 4
- **A + B < 10 条** → 需要动用 C 档补足，或回阶段 2 扩大搜索
- **A + B + C < 5 条** → 检索质量差，强烈建议回阶段 1 调整画像

---

## 对话输出格式（展示给用户）

```
## 📋 粗筛完成

| 档位 | 人数 | 说明 |
|---|---|---|
| 💎 A 档（总分 ≥8） | 5 | 必精读 |
| ⭐ B 档（总分 3-7） | 8 | 按预算精读 |
| ✅ C 档（总分 <3） | 12 | 兜底 |
| ❌ 排除 | 22 | 硬约束不满足 |

排除原因 TOP 3：
1. 城市不符 (12 人)
2. 工作年限不符 (6 人)
3. 学历不符 (4 人)

🚪 A+B = 13 人 ≥ 10，精读预算充足 → 进入阶段 4
```
