# AuthorFilter → org-knowledge-base 数据契约

> 把顶会论文标注结果（Excel）转换为 org-knowledge-base 标准 JSON，沉淀到公司主体维度的知识库。

---

## 1. 数据契约总原则

| 原则 | 说明 |
|------|------|
| **公司维度** | 按公司主体（阿里巴巴 / 蚂蚁集团 / 字节跳动 / 腾讯 / Meta / Google / 华为 ...）拆 JSON 文件 |
| **AI Lab 是部门** | 腾讯 ARC Lab / 微软 MSRA / Meta FAIR 等是公司下的 `team_id`，不是独立 JSON |
| **来源标记** | `source: "authorfilter v1.0"` 与其他来源（linkedin/hkex/sec）共存 |
| **去重逻辑** | 相同 `name` + 相同 `affiliation_company` → 视为同一人，merge `paper_history` |
| **跨公司合作** | 一篇论文若有多家企业作者，每家公司 JSON 都加该论文的对应作者（独立记录） |
| **不入库类别** | K=`无华人` / K=`存疑` / K=`全学生` 都不入库（仅 K=`工业界` 的论文进入流程）|

---

## 2. 公司主体识别规则

### 2.1 公司主体表（25 个标准化主体）

| L 列原始值（论文标注） | 标准化 company_id | 标准化 name | name_en |
|-----------------------|-------------------|------------|---------|
| 阿里巴巴 / 阿里巴巴 达摩院 / 阿里巴巴 淘天集团 | `alibaba` | 阿里巴巴 | Alibaba Group |
| 蚂蚁集团 / Ant Group | `ant-group` | 蚂蚁集团 | Ant Group |
| 字节跳动 Seed / 字节跳动 Research / TikTok | `bytedance` | 字节跳动 | ByteDance |
| 腾讯 WeChat Vision / 腾讯 ARC Lab / 腾讯 优图实验室 / 腾讯 AI Lab / 腾讯 Hunyuan | `tencent` | 腾讯 | Tencent |
| 华为 / 华为诺亚方舟 | `huawei` | 华为 | Huawei |
| 百度 / 百度研究院 / 百度 Apollo / 百度 文心 | `baidu` | 百度 | Baidu |
| 商汤 SenseTime / SenseNova | `sensetime` | 商汤 | SenseTime |
| 快手 Kuaishou Technology | `kuaishou` | 快手 | Kuaishou |
| 京东 JD.COM / 京东 AI Research | `jd` | 京东 | JD.COM |
| 美团 | `meituan` | 美团 | Meituan |
| 小米 Xiaomi Research / 小米 EV / 小米AI Lab | `xiaomi` | 小米 | Xiaomi |
| 地平线 Horizon Robotics | `horizon-robotics` | 地平线 | Horizon Robotics |
| 上海AI Lab / Shanghai AI Laboratory | `shanghai-ai-lab` | 上海AI Lab | Shanghai AI Laboratory |
| 北京智源 / BAAI | `baai` | 北京智源 | BAAI |
| 鹏城实验室 | `pengcheng-lab` | 鹏城实验室 | Pengcheng Laboratory |
| 智元机器人 / AGIBOT | `agibot` | 智元机器人 | AGIBOT |
| 理想汽车 | `lixiang` | 理想汽车 | Li Auto |
| 小鹏汽车 | `xpeng` | 小鹏汽车 | XPeng |
| Meta Reality Labs / Meta FAIR / Meta AI | `meta` | Meta | Meta Platforms |
| Google DeepMind / Google Research | `google` | Google | Google |
| Apple | `apple` | Apple | Apple Inc. |
| Microsoft / 微软 MSRA | `microsoft` | 微软 | Microsoft |
| NVIDIA Research | `nvidia` | NVIDIA | NVIDIA |
| Adobe Research | `adobe` | Adobe | Adobe |
| 其他（不在上表的）| `{slugified}` | 论文原文标注 | - |

### 2.2 部门识别（同一公司下的子团队）

如 L 列 = "腾讯 ARC Lab"，则：
- `company_id` = `tencent`
- `team_id` = `arc-lab`
- `team_name` = `ARC Lab`

如 L 列 = "Meta FAIR"，则：
- `company_id` = `meta`
- `team_id` = `fair`
- `team_name` = `FAIR (Fundamental AI Research)`

部门别名详见 `to_mapping_kb.py` 中的 `DEPT_ALIAS` 表。

---

## 3. 论文记录字段

每个企业作者 → 公司 JSON 的 `personnel` 列表 + `papers` 列表（双向引用）。

### 3.1 personnel 字段（人员维度）

```json
{
  "id": "person-zhang-wei-tencent",
  "name": "Wei Zhang 张伟",
  "affiliation_in_paper": "Tencent ARC Lab",
  "department_id": "team-research",
  "team_id": "arc-lab",
  "title": "AI Researcher",
  "title_abbr": "Researcher",
  "background_brief": "Tencent ARC Lab · 已发表 3 篇顶会论文",
  "paper_history": [
    {
      "paper_id": "paper-cvpr2026-mixflow",
      "paper_title": "MixFlow Training",
      "venue": "CVPR 2026",
      "author_position": 3,
      "is_corresponding_author": false,
      "is_first_author": false,
      "co_authors_at_company": ["Li Si 李四"],
      "external_collaborators": ["复旦大学", "上海AI Lab"]
    }
  ],
  "is_intern_likely": false,
  "source": "authorfilter v1.0",
  "source_urls": ["https://arxiv.org/abs/2403.xxxxx"],
  "confidence": "very_high",
  "added_at": "2026-06-10T00:25:00+08:00",
  "updated_at": "2026-06-10T00:25:00+08:00",
  "notes": "论文首页明确标注 Tencent ARC Lab"
}
```

### 3.2 papers 字段（论文维度，新增 section）

```json
"papers": [
  {
    "paper_id": "paper-cvpr2026-mixflow",
    "title": "MixFlow Training: Stabilizing Diffusion via Hybrid Sampling",
    "venue": "CVPR 2026",
    "venue_year": 2026,
    "research_direction": "扩散模型训练稳定性",
    "arxiv_url": "https://arxiv.org/abs/2403.xxxxx",
    "company_authors": [
      {"name": "Wei Zhang 张伟", "position": 3, "team": "ARC Lab"},
      {"name": "Li Si 李四", "position": 5, "team": "ARC Lab"}
    ],
    "external_collaborators": ["复旦大学", "上海AI Lab"],
    "first_author_external": true,
    "first_author_affiliation": "复旦大学",
    "is_industry_led": false,
    "added_at": "2026-06-10T00:25:00+08:00",
    "source_excel": "cvpr2026.xlsx Row 47"
  }
]
```

---

## 4. JSON 模板（最小完整版）

新建公司 JSON 时使用：

```json
{
  "company_id": "tencent",
  "name": "腾讯",
  "name_en": "Tencent",
  "industry": "Tech / AI / Internet",
  "industry_subcategory": "AI Research",
  "version": "1.0",
  "schema_version": "v4",
  "created_at": "2026-06-10T00:25:00+08:00",
  "updated_at": "2026-06-10T00:25:00+08:00",
  "scope_note": "由 authorfilter v1.0 从顶会论文沉淀的 AI 研究员；可与 linkedin-deep-miner / 内部信息共存",
  "org_structure": {
    "id": "root",
    "name": "腾讯",
    "children": [
      {
        "id": "dept-research",
        "name": "AI 研究体系",
        "children": [
          {"id": "team-arc-lab", "name": "ARC Lab"},
          {"id": "team-ai-lab", "name": "AI Lab"},
          {"id": "team-hunyuan", "name": "Hunyuan"},
          {"id": "team-wechat-vision", "name": "WeChat Vision"},
          {"id": "team-youtu", "name": "优图实验室"}
        ]
      }
    ]
  },
  "personnel": [/* 人员列表 */],
  "papers": [/* 论文列表 */],
  "update_history": [
    {
      "timestamp": "2026-06-10T00:25:00+08:00",
      "source": "authorfilter v1.0（首次入库）",
      "changes": "从 cvpr2026.xlsx 入库 12 位企业作者 / 7 篇论文"
    }
  ]
}
```

---

## 5. 去重逻辑

### 5.1 人员去重

```python
def find_existing_person(personnel_list, name, company_id):
    """姓名 + 公司主体 双重匹配"""
    for p in personnel_list:
        if normalize_name(p["name"]) == normalize_name(name):
            return p
    return None
```

匹配到现有 → merge `paper_history`（不重复创建）  
未匹配 → 新建 person 记录

### 5.2 论文去重

按 `arxiv_url` 或 `paper_title` 标准化后做 key。

---

## 6. confidence 规则

| 场景 | confidence |
|------|-----------|
| 论文首页 affiliation 明确标注公司 | **very_high** |
| 论文首页只标 AI Lab 全称（如 "Tencent AI Lab"）| very_high |
| K 列标"工业界"但 L 列含"存疑"标记 | medium |
| 仅根据姓名推断（违反原则）| ❌ 禁止入库 |

---

## 7. 跨 Skill 联动建议（人工触发）

入库后，对 paper_history 数量 ≥ 3 的高产研究员，建议跑：
- **linkedin-deep-miner**：验证当前是否还在该公司（防 stale）
- **github-miner**：验证开源贡献质量

联动指令示例：
> "对 tencent.json 中论文数 ≥ 3 的人，跑 linkedin 验证当前职位"

---

## 8. 不入库的边界场景

以下情况 **不写入** org-knowledge-base：

| 情况 | 原因 |
|------|------|
| K = 全学生 | 学校信息已在论文中，不属于公司知识库 |
| K = 无华人 | （Mapping 体系当前只关注华人/中国市场）|
| K = 存疑 | 数据不可靠 |
| L 列为空 | 无法定位公司主体 |
| L = 上海AI Lab，但论文里有同等贡献的 Tencent 作者 | 上海AI Lab 单独入库；Tencent 作者在腾讯 JSON 单独入 |
| Intern 但论文标的是学校 | 论文怎么标就怎么入（intern 但学校来源 → 不入企业 JSON）|

---

## 9. 与 ArtStation 数据契约的一致性

两个 Skill 的契约设计同源：

| 维度 | ArtStation | AuthorFilter |
|------|-----------|--------------|
| 公司维度文件 | `mihoyo.json` | `tencent.json` |
| 子团队字段 | `team_id`（角色组/场景组）| `team_id`（ARC Lab / FAIR）|
| 兜底文件 | `freelance-artists.json` | `independent-researchers.json` |
| 来源字段 | `source: "artstation-talent-finder v1.0"` | `source: "authorfilter v1.0"` |
| 增量合并 | 按 username | 按 name + company |

**收益**：未来 `mapping-universal` 总调度器可以用同一套合并逻辑处理两个 Skill 的输出。
