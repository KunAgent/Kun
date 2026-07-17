---
name: github-miner
description: >
  GitHub 人才挖掘器。通过 GitHub 公开数据（用户 profile / 仓库贡献者 / commit 历史 /
  Stars / Followers / Organization 成员 / 公司开源项目 Committer）挖掘研发/算法/AI 人才。
  这是研发岗招聘 Mapping 的最高质量渠道 —— 代码是**不可伪造的履历**，比 LinkedIn 更硬核。
  触发场景：
  - 挖某公司的研发/算法/AI 团队
  - 需要验证候选人的技术真实水平（不看 JD 吹嘘，看 commit 记录）
  - 找某开源项目的核心 maintainer
  - 找某语言/框架的顶级贡献者
  触发短语：
  "GitHub 挖 XX 团队"、"扒 XX 公司 GitHub"、"XX 开源项目作者"、
  "找 Rust/Go/Python 高手"、"核心贡献者"、"GitHub contributors"、
  "开源 maintainer"、"commit 反查"、"github-miner"。
agent_created: true
---

# GitHub-Miner — GitHub 公开数据人才挖掘

## 一、定位与核心能力

GitHub 是研发岗招聘 Mapping 的**最高质量数据源**——

| 维度 | LinkedIn | GitHub |
|------|---------|--------|
| 信息可伪造性 | 中（JD 自填） | **极低（代码不可造假）** |
| 时效性 | 中（更新滞后） | **高（commit 实时）** |
| 技术深度 | 低 | **极高（看代码风格、仓库星标、issue 回复）** |
| 跳槽轨迹 | 模糊 | **清晰**（GitHub Org 加入/离开有明确 commit 记录） |
| 隐私边界 | 公开 profile snippet | **仅公开数据**（Star / Follow / Public Repos / Public Org） |

**本 Skill 严格遵守 GitHub Terms of Service**：仅利用公开 profile + 公开搜索结果。不做 token 化爬取、不破解 rate limit、不获取 private repo 数据。

---

## 二、5 阶段工作流

```
[Stage 1] 意图解析       → 提取：目标公司/语言/项目/职级
[Stage 2] GitHub 搜索    → web_search + GitHub 公开 search URL
[Stage 3] Profile 验证   → web_fetch 用户主页确认 affiliation
[Stage 4] 影响力评分     → 基于 Stars / Followers / Contribution graph 量化
[Stage 5] 入库渲染       → 与 org-knowledge-base 数据契约入库
```

详细工作流见 `scripts/workflow-orchestration.md`。

---

## 三、5 大检索模式

### 模式 A：按 Organization 挖团队（最推荐）

```
目标：挖某公司的整个开源团队
查询：
- https://github.com/orgs/{org}/people（公开成员页）
- site:github.com "{Company}" "Software Engineer"
- site:github.com inurl:{org} "members"
```

**真实例子**：
- `https://github.com/orgs/microsoft/people` → 公开 4000+ 成员
- `https://github.com/orgs/Tencent/people` → 腾讯开源贡献者
- `https://github.com/orgs/bytedance/people` → 字节开源团队

### 模式 B：按 Repo Top Contributors 挖核心人

```
目标：挖某 Star 项目的核心 maintainer
查询：
- https://github.com/{org}/{repo}/graphs/contributors
- site:github.com "{Repo Name}" "contributors"
```

例：挖 PyTorch 核心 → `pytorch/pytorch/graphs/contributors`

### 模式 C：按语言/框架找顶级贡献者

```
查询：
- site:github.com inurl:profile language:rust followers:>500
- site:github.com "Rust" "Senior" "Engineer"
- "{Language} maintainer" site:github.com
```

### 模式 D：按 commit message 反查

```
目标：某项目核心 commit 是谁
查询：
- "Authored-by:" "{Project Name}" site:github.com
- 通过 commit URL 找 author
```

### 模式 E：按 Stars / Lists 关联挖掘

```
目标：找某领域专家（如：LLM 推理优化）
查询：
- 已知 A 是该领域专家，看 A 的 Followers / Following / Stars 列表
- 这些往往是同领域专家
```

详见 `references/github-search-strategies.md`

---

## 四、核心识别规则

### 4.1 affiliation 提取

GitHub Profile 的 `Bio` 和 `Company` 字段是**法定来源**：

| Profile 字段 | 含金量 | 可信度 |
|------------|-------|--------|
| Company（@org-mention） | ⭐⭐⭐⭐⭐ | 最高（@google 自动跳转） |
| Company（free text） | ⭐⭐⭐⭐ | 高（用户填写，可能过时） |
| Bio | ⭐⭐⭐ | 中 |
| Email domain (@gmail = 不算；@google.com = 在职) | ⭐⭐⭐⭐ | 高 |
| Public Org 成员关系 | ⭐⭐⭐⭐⭐ | 最高（必须是该 Org 真实成员） |

### 4.2 影响力评分（按公开数据）

```
score = log(followers + 1) * 2
      + log(stars_received + 1) * 3
      + log(public_repos + 1)
      + tenure_years * 0.5
```

| 等级 | score | 说明 |
|------|-------|------|
| **Tier 1** | > 30 | 全球开源大咖（如 Linus 50+） |
| **Tier 2** | 15-30 | 顶级 maintainer / Senior Engineer |
| **Tier 3** | 8-15 | 资深贡献者 |
| **Tier 4** | < 8 | 一般贡献者 |

### 4.3 在职状态判断

| 信号 | 含义 |
|------|------|
| 当前 Org membership 有 @company | ✅ 在职 |
| 公司 Org 中 last commit < 6 个月 | ✅ 活跃在职 |
| 公司 Org 中 last commit > 12 个月 | ⚠️ 可能离职（待 LinkedIn 验证） |
| 不在 Org 但 commit message 大量含 `@company.com` 邮箱 | ✅ 在职 |
| Bio 改成新公司、commit 来自新公司项目 | 🔄 已跳槽 |

详见 `references/contributor-extraction.md`

---

## 五、与其他 Mapping Skill 联动

```
github-miner（代码能力 + 工程履历）
        ↓
        + linkedin-deep-miner（验证 LinkedIn 写的当前职位）
        + authorfilter（如果是 AI 研究员，还出过论文吗）
        ↓
       三源交叉，confidence = very_high
```

**典型联动场景**：
- 验证候选人简历中"3 年 Rust 经验"是否真实 → github-miner 看 Rust commit 时间跨度
- 挖某公司算法团队 Senior 层 → linkedin-deep-miner 找 Lead，然后用 github-miner 找其汇报链下属
- 找 LLM 推理优化专家 → github-miner 按 vLLM/llama.cpp Top contributors

---

## 六、不做的事（合规边界）

| ❌ 禁止 | ✅ 替代方案 |
|--------|----------|
| 用 token 大量调 GitHub API（违反 60 req/h 限制） | 用 web_search + web_fetch 公开数据 |
| 爬 private repo / private member | 仅公开 Org member 页 |
| 模拟登录 / cookies 注入 | 仅 Anonymous 公开访问 |
| 把 commit 邮箱当作个人联系方式存档 | 仅作为"在职信号"判断，不入库 |
| 用 GitHub 数据反推未公开的薪酬 / 内部架构 | 仅做组织覆盖识别 |

---

## 七、典型触发场景示例

| 用户输入 | Skill 行为 |
|---------|----------|
| "GitHub 挖腾讯开源团队" | 模式 A：扫 `orgs/Tencent/people` + `orgs/TencentBlueKing` 等子 Org |
| "找 PyTorch 核心 maintainer" | 模式 B：扫 `pytorch/pytorch/graphs/contributors` Top 50 |
| "找 Rust 高手" | 模式 C：搜 `language:rust followers:>500` + 中国地区过滤 |
| "验证 XX 候选人是否真懂 K8s" | 反查模式：搜 XX GitHub username + Kubernetes commit |
| "vLLM 项目的核心贡献者都在哪些公司" | 模式 B + Profile 抓取 affiliation 聚合 |

---

## 八、入库到 Mapping 知识库

执行命令（与其他 Skill 一致）：

```bash
python3 {SKILL_BASE_DIR}/scripts/to_mapping_kb.py \
    --input ./_github_results.json \
    --workspace {WORKSPACE} \
    --source-note "GitHub 挖腾讯 BlueKing 团队 2026-06"
```

详见 `references/output-contract.md`

---

## 九、版本

- **v1.0** (2026-06): 首版发布，5 阶段工作流 + 5 大检索模式 + 影响力评分
- 依赖工具：web_search / web_fetch
- 与 org-knowledge-base 数据契约共享
