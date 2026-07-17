## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# HKEX 招股书 → org-knowledge-base 数据契约

本契约定义 hkex-prospectus-miner 输出 → `org-knowledge-base` 入库规则。

## 一、机构维度组织

| 类型 | JSON 命名 | 例子 |
|------|----------|------|
| 投行 | `{firm-id}.json` | `gs-ibd.json` / `cicc.json` / `citic-securities.json` |
| 律所 | `{firm-id}.json` | `linklaters.json` / `fangda-partners.json` |
| 会计师 | `{firm-id}.json` | `pwc.json` / `deloitte.json` |
| 发行人(可选) | `deal-{stockcode}-{name}.json` | 仅当需要按 deal 视角查询时启用 |

## 二、关键扩展字段（新增）

延续 `org-knowledge-base` 已有 schema，**在投行/律所/会计师 JSON 中新增以下字段**：

### 2.1 `confirmed_deals_and_rankings`（已存在，扩展用法）

记录该机构在哪些 IPO 项目担任什么角色：

```json
{
  "deal": "牧原食品 港股 IPO",
  "deal_en": "Muyuan Foods HK IPO",
  "stock_code": "2772.HK",
  "issuer_industry": "Consumer/Agriculture",
  "ms_role": "Joint Sponsor / Joint Bookrunner",   // 该机构的角色
  "team_members": ["person-david-hoyer", "person-tiger-zhu"],  // 关联到 personnel.id
  "deal_size_usd": "5亿",
  "date": "2025-06",
  "status": "已上市 / 递表中 / 暂缓",
  "prospectus_url": "https://www1.hkexnews.hk/...",
  "source": "hkex-prospectus-miner v1.0",
  "extracted_at": "2026-06-07T..."
}
```

### 2.2 `personnel[].deal_history`（新增）

每个 banker/lawyer/accountant 记录其参与的 deal：

```json
{
  "id": "person-david-hoyer",
  "name": "David Hoyer",
  "title": "ED, GS HK TMT",
  ...,
  "deal_history": [
    {
      "deal": "牧原食品",
      "stock_code": "2772.HK",
      "role": "Sponsor Principal",
      "date": "2025-06",
      "source": "招股书披露"
    },
    {
      "deal": "阶跃星辰",
      "role": "Joint Bookrunner Lead",
      "date": "2025-09"
    }
  ]
}
```

### 2.3 `personnel[].confidence` 升级机制

| 数据来源 | confidence |
|---------|-----------|
| 招股书签字披露（法定） | `very_high` ⭐⭐⭐⭐⭐ |
| 招股书机构披露 + LinkedIn 交叉 | `high` ⭐⭐⭐⭐ |
| 招股书机构层 + 单源 | `medium` ⭐⭐⭐ |

## 三、字段映射

| 招股书字段 | org-knowledge-base 字段 | 转换规则 |
|-----------|----------------------|---------|
| `sponsor_principals[].name_en` | `personnel[].name` | 直接映射 |
| `sponsor_principals[].name_zh` | `personnel[].name_zh` | 中文名独立字段 |
| `sponsor_principals[].title` | `personnel[].title` | "Managing Director" |
| `sponsor_principals[].department` | `personnel[].team_id` | 推断到 TMT/Healthcare 等 |
| `sponsor_principals[].firm_name` | `personnel[].company_id` | 归一化机构 → 决定写入哪个 JSON |
| `auditor.engagement_partner` | `personnel[].name` | 写入对应会计师 JSON |
| `legal_counsel[].partners[]` | `personnel[].name` | 写入对应律所 JSON |
| `issuer.name_zh` + `name_en` | `confirmed_deals_and_rankings[].deal` | 创建 deal 记录 |

## 四、增量合并规则

### 4.1 机构层面

- 已存在的机构 JSON（如 `gs-ibd.json`） → 在 `confirmed_deals_and_rankings` 数组追加新 deal
- 同一 deal 重复扫描 → 用 `stock_code` 去重，覆盖新字段
- 新机构 → 创建新 JSON 文件

### 4.2 人员层面

**核心匹配规则**：
1. 优先按 `name_en` + `firm_name` 匹配
2. 其次按 `name_zh`（中文名通常更唯一）
3. 找不到 → 创建新 personnel 记录

**合并已有人员**（如 LinkedIn 已挖到的 person）：
- 同名同公司 → 合并：保留 LinkedIn 的 title，新增 `deal_history`
- 同名不同公司 → 警告写入 `notes`，不自动合并

### 4.3 update_history 追加

每次执行追加一条：
```json
{
  "timestamp": "2026-06-07T19:30:00+08:00",
  "source": "hkex-prospectus-miner v1.0",
  "changes": "扫描 12 份 2025 年 IPO 招股书 → 新增 deal 5 个 / 新增人员 3 / 更新人员 2 / 验证人员 8"
}
```

## 五、跨 Skill 联动场景

### 场景 A：与 linkedin-deep-miner 联动

```
linkedin-deep-miner 已挖到：David Hoyer 是 GS HK TMT ED
                            confidence: high (snippet 信任)
                                     ↓
hkex-prospectus-miner 扫描招股书发现：David Hoyer 是 5 个 IPO 的 Sponsor Principal
                            置信度升级: very_high
                                     ↓
org-knowledge-base 渲染时：
  David Hoyer 节点显示 ⭐⭐⭐⭐⭐ + "5 个 IPO 履历" tooltip
```

### 场景 B：交叉公司发现

```
扫描 牧原食品 招股书：
- Joint Sponsors: Goldman Sachs + 中信证券 + Morgan Stanley
- 三家投行的 JSON 都更新 confirmed_deals_and_rankings
- 关联同一个 deal_id "muyuan-2025"
- 在 HTML 渲染时可生成"该 deal 完整中介团队"侧边卡
```

## 六、HTML 渲染要求

调用 `org-knowledge-base/scripts/generate-chart.md` 模板，**新增 deal 履历呈现**：

```
人员节点
├── 姓名 + 职级（已有）
└── ⭐ 5 个 IPO 履历（新增）
    └── hover 显示：牧原 / 阶跃 / 华深智药 ...
```

机构节点旁边可加一个"近期 deals"侧栏列表（最多 10 个）。

## 七、错误降级

| 场景 | 处理 |
|------|------|
| PDF 抽取失败 | 记录到 `open_questions`，不阻塞流程 |
| 机构名无法归一化 | 写入 `unknown-firms.json`，提示人工归类 |
| 人员姓名解析模糊 | confidence=medium，留给后续 Skill 验证 |
| 招股书 PDF >500 页 | 按章节分段 fetch，只抽取关键章节 |

## 八、与 sec-filing-miner 的协调（v2.3 预留）

未来 sec-filing-miner（美股 IPO）和本 Skill 都写入相同 JSON 文件，通过 `confirmed_deals_and_rankings[].source` 字段区分（"hkex-prospectus-miner" vs "sec-filing-miner"），实现一个 banker 跨港美股 deal 履历的统一视图。
