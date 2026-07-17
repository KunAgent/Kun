# github-miner → org-knowledge-base 数据契约

> 与 linkedin-deep-miner / authorfilter / hkex-prospectus-miner 共享同一公司维度 JSON。

---

## 1. 数据契约总原则

| 原则 | 说明 |
|------|------|
| **公司维度** | 与 authorfilter 共用 25 公司主体表（tencent.json / bytedance.json / google.json ...） |
| **部门归属** | 通过 GitHub Org 子组织 + Bio 文本推断 |
| **多源共存** | `source: "github-miner v1.0"` 与其他来源（linkedin/authorfilter）字段同等共存 |
| **去重逻辑** | 同 username + 同 company → merge；同 real_name + 同 company → 标记 `cross_skill_match` |
| **置信度** | `Public Org Member` = very_high，`Profile Company 字段` = high，`仅 commit email` = medium |

---

## 2. personnel 字段（GitHub 视角）

```json
{
  "id": "person-{username}-{company_id}",
  "name": "Yongxin Lin 林永鑫",
  "github_username": "linyx-zh",
  "department_id": "dept-engineering",
  "team_id": "infra",
  "title": "Software Engineer",
  "title_abbr": "SWE",
  "background_brief": "ByteDance Seed · vLLM 核心贡献者 · GitHub 1234 followers",
  "github_data": {
    "profile_url": "https://github.com/linyx-zh",
    "bio": "LLM Engineer @ ByteDance Seed",
    "company_raw": "@bytedance",
    "is_org_mention": true,
    "location": "Beijing, China",
    "email_public": null,
    "twitter": "@linyx",
    "personal_site": "https://linyx.dev",
    "followers": 1234,
    "following": 100,
    "public_repos": 45,
    "tenure_years": 6,
    "in_china": true,
    "is_intern_likely": false,
    "org_memberships": ["bytedance", "vllm-project", "pytorch"],
    "top_repos": [
      {"name": "vllm-project/vllm", "stars": 12000, "role": "core-contributor"},
      {"name": "pytorch/pytorch", "stars": 70000, "role": "contributor"}
    ],
    "language_distribution": {"Python": 65, "Rust": 20, "C++": 15},
    "influence_score": 28.5,
    "tier": "Tier 1",
    "last_active": "2026-06-08"
  },
  "career_path_inferred": [
    {"period": "2020-2022", "company_normalized": "google", "evidence": "@google.com email in commits"},
    {"period": "2022-至今", "company_normalized": "bytedance", "evidence": "Org member + bio mention"}
  ],
  "source": "github-miner v1.0",
  "source_urls": ["https://github.com/linyx-zh"],
  "confidence": "very_high",
  "added_at": "...",
  "updated_at": "...",
  "notes": "Org membership + bio + commit email 三重确认"
}
```

---

## 3. 与 authorfilter / linkedin-deep-miner 的字段共存

同一个 person，可能有 3 种来源同时入库到 `tencent.json` 中：

```json
{
  "name": "张三",
  "_sources": {
    "linkedin": {
      "source": "linkedin-deep-miner v1.0",
      "snippet": "...",
      "title_from_linkedin": "Senior Software Engineer at Tencent",
      "added_at": "..."
    },
    "github": {
      "source": "github-miner v1.0",
      "github_username": "zhangsan",
      "github_data": {/* 完整 GitHub profile */},
      "added_at": "..."
    },
    "authorfilter": {
      "source": "authorfilter v1.0",
      "paper_history": [/* CVPR 2026 等 */],
      "added_at": "..."
    }
  },
  "confidence": "very_high",
  "cross_skill_verified": true
}
```

**推荐合并策略**：保留所有 source 子节点，让 mapping-universal 总调度器在 HTML 渲染时显示 "由 X+Y+Z 三个 Skill 共同确认"。

---

## 4. 部门归属推断

GitHub 没有直接的"部门"字段，但可通过 **Bio + Org 子组织** 推断：

| 信号 | 推断部门 |
|------|---------|
| Org 子组织 = `TencentARC` | 腾讯 ARC Lab |
| Org 子组织 = `vllm-project` 且公司=`bytedance` | ByteDance Seed Team（vLLM 多由 Seed 维护） |
| Bio 含 "Hunyuan" | 腾讯 Hunyuan 团队 |
| Bio 含 "Seed" 且公司=bytedance | ByteDance Seed |
| Bio 含 "Apollo" 且公司=baidu | 百度 Apollo |
| Bio 含 "WeChat Vision" 且公司=tencent | 腾讯 WeChat Vision |
| 都没有 | `dept-engineering`（兜底） |

详见 `references/contributor-extraction.md` 的 4.2 节。

---

## 5. 跨 Skill 联动建议

入库后自动触发的联动：

| 触发条件 | 联动 Skill | 用途 |
|---------|-----------|------|
| `tier >= Tier 2` | linkedin-deep-miner | 验证当前 LinkedIn 头衔 |
| GitHub username 已存在于 authorfilter 入库人员 | 自动 cross-match | 升级 confidence |
| `tier == Tier 1` | deal-news-miner | 看媒体是否有人事报道 |

---

## 6. 不入库的边界场景

| 情况 | 原因 |
|------|------|
| Profile 完全空白 | 数据不足 |
| 仅 1-2 commits 的小号 | 噪音 |
| Bot 账号 | 非真实人 |
| company_normalized 为空且 Bio 无线索 | 无法定位公司 |
| Org Member 但 last activity > 24 个月 | 可能停用，标 stale 但仍入库 |

---

## 7. JSON 模板

如果是首次创建某公司 JSON（没经过 authorfilter / linkedin），用：

```json
{
  "company_id": "bytedance",
  "name": "字节跳动",
  "name_en": "ByteDance",
  "industry": "Tech / Internet",
  "version": "1.0",
  "schema_version": "v4",
  "created_at": "2026-06-10T01:00:00+08:00",
  "updated_at": "2026-06-10T01:00:00+08:00",
  "scope_note": "由 github-miner v1.0 从公开 GitHub Org + Profile 沉淀",
  "org_structure": {
    "id": "root",
    "name": "字节跳动",
    "children": [
      {
        "id": "dept-engineering",
        "name": "研发体系",
        "children": [
          {"id": "team-seed", "name": "Seed Team"},
          {"id": "team-research", "name": "ByteDance Research"},
          {"id": "team-volcengine", "name": "Volcengine"}
        ]
      }
    ]
  },
  "personnel": [/* 通过 github-miner 入库的人员 */],
  "papers": [],
  "github_orgs_tracked": ["bytedance", "volcengine", "ByteDance-Seed"],
  "update_history": [
    {
      "timestamp": "2026-06-10T01:00:00+08:00",
      "source": "github-miner v1.0",
      "changes": "首次入库 87 名 Org members"
    }
  ]
}
```
