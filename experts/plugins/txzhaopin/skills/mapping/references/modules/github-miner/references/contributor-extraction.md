# Contributor 信息提取规则

> 从 GitHub 公开页面提取 contributor 关键信息的标准化规则

---

## 一、字段提取清单

每个 contributor 必须提取以下字段（可空但不可猜测）：

| 字段 | 来源 | 示例 | 必填 |
|------|------|------|------|
| `username` | URL `/user/{username}` | `linyx-zh` | ✅ |
| `display_name` | Profile 顶部 H1 | `Yongxin Lin` | ✅ |
| `real_name_zh` | Bio 中文姓名 | `林永鑫` | ⚠️ |
| `company_raw` | Profile Company 字段（原文）| `@bytedance` | ✅ |
| `company_normalized` | 映射到标准公司主体 | `bytedance` | ✅ |
| `company_org_link` | 是否带 @ 前缀 | `True` | ✅ |
| `bio` | Profile Bio | `LLM Engineer @ ByteDance Seed` | ⚠️ |
| `location` | Profile Location | `Beijing, China` | ⚠️ |
| `email` | Profile Email（仅公开）| `xxx@bytedance.com` | ⚠️ |
| `twitter` | Profile Social | `@linyx` | ⚠️ |
| `personal_site` | Profile Website | `https://linyx.dev` | ⚠️ |
| `followers` | Profile 顶部数据 | `1234` | ✅ |
| `following` | Profile 顶部数据 | `100` | ⚠️ |
| `public_repos` | Profile Repositories Tab | `45` | ✅ |
| `created_at` | Profile 注册时间 | `2018-03-15` | ⚠️ |
| `last_active` | 最近 contribution graph | `2026-06-08` | ⚠️ |
| `top_repos` | Pinned + 最高 Star 仓库 | `[vllm-project/vllm: 12k stars]` | ⚠️ |
| `language_distribution` | 主要使用语言 | `Python 65%, Rust 20%, C++ 15%` | ⚠️ |
| `org_memberships` | 公开 Org 成员关系 | `[bytedance, vllm-project, pytorch]` | ✅ |

---

## 二、Affiliation 识别（核心）

### 2.1 优先级（高 → 低）

```
1. 当前 Public Org Membership（最权威）
   ↓
2. Profile Company 字段（@org-mention 形式）
   ↓
3. Profile Company 字段（free text）
   ↓
4. 最近 6 个月 commit 邮箱域名
   ↓
5. Bio 文本（如 "Software Engineer at X"）
   ↓
6. 关联的 Twitter / 个人主页
```

### 2.2 公司归一化（与 authorfilter 共享 25 公司主体表）

GitHub 上的 Company 字段写法多样：

| 原文 | 归一化 |
|------|--------|
| `@google` / `Google` / `Google LLC` | `google` |
| `@bytedance` / `ByteDance` / `字节跳动` / `Bytedance Inc.` | `bytedance` |
| `@Tencent` / `Tencent` / `腾讯` / `腾讯科技` | `tencent` |
| `@microsoft` / `Microsoft` / `MSRA` | `microsoft` |
| `@meta` / `Meta` / `Facebook` | `meta` |
| `@OpenAI` | `openai` |
| `@anthropics` | `anthropic` |
| `@apple` / `Apple Inc.` | `apple` |
| `@nvidia` / `NVIDIA` | `nvidia` |
| `@alibaba` / `Alibaba Group` / `阿里巴巴` | `alibaba` |
| `@AntGroup` / `Ant Group` / `蚂蚁集团` | `ant-group` |
| `@huawei` / `Huawei` / `华为` | `huawei` |
| `@baidu` / `Baidu` / `百度` | `baidu` |
| `@kuaishou` / `Kuaishou Technology` | `kuaishou` |
| `@meituan` / `Meituan` | `meituan` |
| `@JDcom` / `JD.com` | `jd` |
| `@xiaomi` / `Xiaomi` / `Xiaomi Corp` | `xiaomi` |
| `@horizon-robotics` | `horizon-robotics` |
| `@OpenGVLab` / `Shanghai AI Lab` | `shanghai-ai-lab` |
| `@vllm-project` | `vllm-project`（独立开源组织） |
| `@pingcap` | `pingcap` |
| Self-employed / Freelancer / Independent | `independent` |

### 2.3 易混淆陷阱（与 authorfilter 同步）

| 陷阱 | 例子 | 处理 |
|------|------|------|
| 已离职但 Profile 没改 | "Ex-Google now at Anthropic" → Bio 写新公司 | 以 Bio 最新表述为准 |
| Personal email != 公司 | gmail.com 不代表公司 | 看 commit 邮箱域名 |
| 同名不同 Org | `@apple` 既可指 Apple Inc. 也可指 `apple` 个人账号 | 看 Org 成员是否真的有该用户 |
| 多公司任职（Affiliations） | "X | Y" 写两家 | 取首位为主，第二位写到 notes |
| Intern 标识 | "Intern at Google" | 标 `is_intern_likely: true` |
| 中国 GitHub 用户 location 留空 | 但 Bio/email 显示在中国 | 用 Bio 推断 |

---

## 三、影响力评分公式

```python
def calc_score(profile):
    import math
    s_followers = math.log(profile["followers"] + 1) * 2
    s_stars = math.log(profile["stars_received"] + 1) * 3
    s_repos = math.log(profile["public_repos"] + 1)
    s_tenure = profile["tenure_years"] * 0.5
    return s_followers + s_stars + s_repos + s_tenure
```

### 等级分布（实测校准）

| Tier | Score | 真实例子 |
|------|-------|---------|
| **Tier 1（神级）** | > 35 | Linus Torvalds (45+) / Yu Xia 尤雨溪 (40+) |
| **Tier 1（顶级）** | 25-35 | TVM 核心 / vLLM 核心 / Apache PMC |
| **Tier 2（资深）** | 15-25 | Senior Engineer / Lead 层 |
| **Tier 3（一般）** | 8-15 | 中级工程师 / 活跃贡献者 |
| **Tier 4（入门）** | < 8 | Junior / 早期贡献者 |

---

## 四、跳槽轨迹判断

### 4.1 通过 commit 邮箱演进

```
看用户的 commit 列表（按时间排序），看 author email 域名变化：

例：
- 2018-2020: @gmail.com (在校) 
- 2020-2022: @bytedance.com (字节)
- 2022-至今: @anthropic.com (Anthropic)

→ 跳槽轨迹清晰
```

### 4.2 通过 Org 加入/离开

GitHub 公开 Org Member 关系：
- 加入某 Org → 通常意味着入职
- 退出某 Org → 通常意味着离职（但有滞后，可能 3-6 个月）

### 4.3 通过 Pinned Repo 变化

用户的 Pinned Repos（profile 顶部精选项目）变化：
- 之前 pin 的是字节项目 → 现在 pin 的是 Anthropic 项目

---

## 五、LLM 提取 Prompt 模板

### Prompt A：Profile 文本解析

```
你是 GitHub 数据提取专家。从下面的 GitHub Profile 页面文本中，按字段抽取：

【输入】
{profile_html_or_snippet}

【输出 JSON】
{
  "username": "...",
  "display_name": "...",
  "real_name_zh": "...（如能从 Bio 推断）",
  "company_raw": "...（原文）",
  "company_normalized": "...（归一化 ID）",
  "is_org_mention": true/false,
  "bio": "...",
  "location": "...",
  "email": "...（仅当公开）",
  "followers": 数字,
  "following": 数字,
  "public_repos": 数字,
  "twitter": "...",
  "personal_site": "...",
  "is_intern_likely": true/false,
  "in_china": true/false,
  "notes": "..."
}

约束：
- 找不到的字段留 null，不要捏造
- company_normalized 必须从给定的 25 公司主体表选，否则填 raw 值
- is_intern_likely 仅当 Bio 含 "intern"/"实习" 关键词时为 true
```

### Prompt B：Repo Contributors 解析

```
从下面的 GitHub Repo contributors 页面文本中，提取 Top N 贡献者：

【输入】
{contributors_text}

【输出 JSON】
[
  {
    "rank": 1,
    "username": "...",
    "commits": 1234,
    "additions": 50000,
    "deletions": 30000,
    "company_hint": "...（从 commit 邮箱或 username 推测）"
  },
  ...
]
```

### Prompt C：跳槽轨迹分析

```
基于该用户的 commit 邮箱演进，输出跳槽轨迹：

【输入】
{commit_history_with_emails}

【输出 JSON】
{
  "career_path": [
    {"period": "2018-2020", "company_normalized": "...", "evidence": "@bytedance.com 共 234 commits"},
    {"period": "2020-至今", "company_normalized": "...", "evidence": "@anthropic.com 共 89 commits"}
  ],
  "current_company": "...",
  "confidence": "high/medium/low"
}
```

---

## 六、不入库的边界

| 情况 | 不入库原因 |
|------|----------|
| Profile 完全空白（无 Bio / 无 Repo / 无 Activity）| 数据不足 |
| `company_normalized` 为空且无法识别 | 无法定位公司主体 |
| 用户标记为 Bot / 显示 `[bot]` 后缀 | 非真实人 |
| 仅 1 commit 且无其他 activity | 可能是测试账号 |
| 同名重复（多个 Profile 都叫 "John Smith"）| 直到能交叉验证才入库 |

---

## 七、与 authorfilter 的协同

GitHub username 和论文作者姓名匹配：

```python
def cross_match(github_user, paper_authors_list):
    """看 GitHub 用户是不是某篇论文的作者"""
    for author in paper_authors_list:
        # display_name 模糊匹配 + company 匹配
        if (fuzzy_match(github_user["display_name"], author["name"]) and
            github_user["company_normalized"] == author["company_normalized"]):
            return author
    return None
```

匹配上 → confidence 升级到 `very_high`，并把 `paper_history` 加到该 person。
