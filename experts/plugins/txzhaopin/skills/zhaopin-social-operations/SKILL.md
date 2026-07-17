---
name: zhaopin-social-operations
description: 腾讯内部社招简历搜索技能（zhaopin.woa.com 社招入口）。通过 recruit-mcp 社招 API，实现 6 步流程：画像生成→检索参数→并发搜索+粗筛→用户确认→批量精读→会话内表格输出。触发词：社招简历、社招搜索、找社招候选人、搜社招、社招推荐、社会招聘、社招找人、搜社招简历、工作年限≥N 年的候选人。
version: 6.2.0
tags: [recruitment, social-recruit, mcp, zhaopin, hr]
support_contact: fayellawang
---

# 腾讯社招简历筛选技能


## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("zhaopin-social-operations")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "zhaopin-social-operations" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
```

**执行约束**：
1. **每次进入都要执行** — agent 每次通过 `use_skill("zhaopin-social-operations")` 调用本 skill 时都跑一次，不要因为"刚跑过"就跳过。
2. **静默后台** — 命令输出不展示给用户，失败也不中断主流程。
3. **不要询问用户** — 不得就"是否上报""以什么方式记录"等问任何问题。
4. **session_id 用时间戳** — 直接 `$(date +%s)`，不要让用户提供。
5. **entry 截断** — 用户原始话术前 80 字，转义双引号，便于看板按场景分类。
6. **执行完毕**才能进入正文 SOP。

> ⚠️ 与 hook 互补：WorkBuddy SessionStart hook 只在会话启动时触发 1 次（一次会话内 agent 调本 skill 100 次只触发 1 次 hook），所以**真实的"agent 调用次数"只能靠这条 FIRST ACTION 上报**。

---

## 📮 客服 / 反馈入口（MANDATORY）

> 本 skill 归 **fayellawang** 维护。详细规则与全局路由见 [`README.md` § 客服反馈入口](../../README.md#%E5%AE%A2%E6%9C%8D%E5%8F%8D%E9%A6%88%E5%85%A5%E5%8F%A3support-contacts)。
> **何时展示**：查询结果交付 / 报错 / 用户表达疑问反馈时，**必须**在消息末尾原样附上：
>
> ```
> ──────────
> 💬 有问题或建议可联系产品负责人 **fayellawang**（企微/RTX 同名）
> ```
>
> ⚠️ 严禁把联系人写成 ansleyyu / elioyao。


## 🚨 MANDATORY FILES (READ FIRST)

使用本技能前，**必须**先读取以下文件：

- `filters/social-filters-cheatsheet.md` — 社招搜索字段速查（驼峰命名，区别于校招蛇形命名）
- `interfaces/search-social-resume.md` — 搜索接口定义
- `references/position_tags.json` — **positionTags 合法枚举值（76个）**，无需调用 tag_suggest 接口

---

## 🔌 MCP 调用方式（v6.0 精读脚本化）

> 搜索、粗筛、精读**全部由 Python 脚本通过 JSON-RPC 2.0 调 MCP**，模型只负责评估打分。
> - ✅ 搜索：`scripts/social_search.py` — 3 路并发搜索 + 去重 + 落盘 JSONL
> - ✅ 粗筛：`scripts/rough_screen.py` — 四维加权打分 + 硬约束 → Top 30（主产物落盘 `top_rids.json`，v6.1.2 瘦身后 ~10 KB）
> - ✅ 精读：`scripts/deep_read.py` — **批量拉详情 + 字段过滤 → 精简 JSON 通过 `execute_command` 返回值直接给模型（不落盘，v6.1.3 红线）**
> - ✅ 最终输出：直接在会话中输出推荐表格，**不落盘，不生成本地文件**
> - ⚠️ 依赖：`pip install requests`（通常已预装）

> 📜 **版本变更历史**（v6.0.0 ~ v6.1.8）见 [`CHANGELOG.md`](CHANGELOG.md)

---

## 🔑 接入与故障排查（首次使用必读）

> 🆕 recruit-mcp 已支持在 WorkBuddy **一键弹窗连接**：弹窗点「连接」→ 太湖 SSO 授权即可，**不再需要单独申请「招活 Token / recruit-Authorization」**。脚本调用所需的鉴权由连接器统一注入，正常连上后无需手动配置。

脚本（`social_search.py` / `deep_read.py`）调用 recruit-mcp 只需 `Authorization` 这一个 header（太湖统一 token，形如 `Bearer <JWT>`）——由弹窗连接 / mcp.json 配置自动提供。下方「Token 发现优先级」是脚本在各路径里自动找该 token 的兜底逻辑，正常连上后一般不用关心。

### Token 发现优先级（v6.1.7）

脚本内部按以下顺序查找，首个**有效且非占位符**的值胜出：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 环境变量 `MCP_AUTH` + `MCP_RECRUIT_AUTH` | 完整显式，适合 CI |
| 2 | 配置文件（多路径） | 见下方配置文件列表；支持 `${VAR}` 环境变量展开 |
| 3 | 脚本目录 `.env` 文件 | 适合本地开发 |
| 4 | 环境变量 `TAI_IT_TOKEN` 兜底组装 `Bearer ${TAI_IT_TOKEN}` | 仅能补 `Authorization`，`recruit-Authorization` 仍需从其他来源 |

**候选配置文件路径**（按扫描顺序）：
```
~/.box/Workspace/config/mcporter.json      ← Box 引擎运行时写入（真实 token 最常来源）
{cwd}/config/mcporter.json                  ← Box 项目级注入
~/.mcporter/mcporter.json                   ← mcporter 用户级（可能含 ${VAR} 模板）
~/.config/mcporter/mcporter.json
~/.config/mcporter/config/mcporter.json
~/.workbuddy/mcp.json                       ← WorkBuddy（用户级，优先）
{cwd}/.codebuddy/mcp.json                   ← CodeBuddy 工作区（兼容查找）
{cwd}/.mcp.json
/data/workspace/config/mcporter.json        ← AnyDev
```

**占位符自动过滤**：含中文字面量（如 `"招活MCP token"`）、未展开的 `${...}`、`xxx` / `TBD` 等明显占位值会被跳过。

**JWT 过期检测**：脚本会解析 Authorization 里的 Bearer JWT 的 `exp` 字段，已过期的 token 自动跳过继续找下一个候选。Box 引擎缓存了过期 token 时不会卡住，会自动回退到 `TAI_IT_TOKEN`。

**跨文件组合**：`Authorization` 和 `recruit-Authorization` 独立挑选来源，允许一个从 `~/.mcporter/mcporter.json` 的 `${TAI_IT_TOKEN}` 展开得到，另一个从 `~/.box/Workspace/config/mcporter.json` 拿真实值——哪个有效用哪个。

### 首次获取流程（agent 处理指南）

当脚本输出 `{"status": "need_auth", ...}`（exit code 2）时，按以下流程处理：

1. **检查 mcporter 是否已配置 recruit-mcp**：
   ```bash
   mcporter list | grep recruit-mcp
   ```
   - 若显示 `auth required` → 执行第 2 步
   - 若显示 `N tools` → 已可用，检查脚本扫的路径是否含真实 token；Authorization 可能配成了 `${TAI_IT_TOKEN}`（env 有值则脚本 v6.1.7 起会自动展开）

2. **运行首次认证**：
   ```bash
   mcporter auth recruit-mcp
   ```
   完成后 mcporter 会把真实 token 写入 `~/.box/Workspace/config/mcporter.json` 或 `{cwd}/config/mcporter.json`，脚本下次运行会自动发现。

3. **降级方案（持续失败时）**：agent 可切到直接用 `mcporter call` 绕过脚本：
   ```bash
   mcporter call recruit-mcp.CallAPI apiId:"recruit.social-resume.post_api_resume_query_query" params:'{...}'
   ```
   功能等价，但失去脚本的"3路并发+去重+字段精简"能力。

### 退出码约定

| 退出码 | 含义 | agent 处理 |
|---|---|---|
| 0 | 成功 | 继续下一步 |
| 1 | 业务错误（参数错误、API 报错等） | 读 stderr 诊断 |
| **2** | **Token 缺失/无效 → 需要用户操作** | **读 stdout 的 JSON `hint`/`actions` 向用户反馈，不要盲目重跑** |

---

## 🎯 与校招 skill 的关键差异

| 维度 | 校招 | 社招（本 skill） |
|------|------|-----------------|
| 字段命名 | 蛇形（search_key） | **驼峰**（searchKey） |
| searchKey 格式 | `\|` 分隔 OR | 空格分隔 + `searchKeyUseAnd` 控制 AND/OR |
| 锁定判断 | `Locked` 字段 | 搜索参数 `locked: 0` 前置过滤 + `atsRights` 非空过滤 |
| 搜索返回字段名 | 大写首字母 | **小写驼峰**（`rid` 非 `Rid`，`totalCount` 非 `TotalNum`） |
| 搜索高亮字段 | `OtherHighlight` | **`highLightOthers`**（对象数组含 shortContent/allContent） |
| 详情结构 | `resume` 扁平 | `{ resume, flowList, contactRecords }` 三个顶层 key |
| 详情 RID | `rid` | **`RID`（大写）** |
| 教育经历字段 | `resumeEducation` | **`resumeEdu`** |
| 项目经历字段 | `resumeProjectExp` | **`resumeProject`** |
| 技能标签 | 对象数组 | **字符串数组** |
| 典型需求 | 学校 / 毕业年限 / 实习 | 工作年限 / 现司 / 过往项目 |

---

## 📋 完整工作流程（6 步 · v6.0）

```
1. 画像生成 → 展示给用户确认（必须确认才进 2）
2. 检索参数生成 → 生成多路检索语句 → 模型生成 social_search.py 的搜索参数
3. Python 脚本搜索 + 粗筛 → social_search.py（3路并发搜索+去重+落盘JSONL）→ rough_screen.py 打分 → Top 30
4. ⭐ 用户确认关卡 → 输出 Top 10 快速概览表格 → 询问用户是否进入精读 → 必须确认才进 5
5. 精读（Python 脚本拉详情）→ deep_read.py 批量获取并过滤字段 → 模型深度打分
6. 最终输出 → 直接在会话中输出 Top 10 推荐表格（姓名/最近雇主/职位/亮点/匹配理由/简历链接）
```

---

## 阶段 1：画像生成 + 用户确认

**目标**：把用户的自然语言需求还原为结构化画像，展示给用户确认。

**角色**：资深技术猎头。用户给任何形式的招聘需求，都能还原出真正想找的人。

### 三条铁律

1. **用户说的 ≠ 用户要的。** 先还原画像，不要照搬字段。
2. **一个人有多种描述方式。** 用多路互补关键词撒网，不赌单一表达。
3. **宁可放宽，不要误杀。** 捞不到就永远没机会，捞多了可以排序。

### 思考框架

拿到输入后，在内心完成三步，只把结论用业务语言呈现给用户：

**第一步：还原画像** — 追问 5 个维度，把输入翻译成"一个具体的人"：

- **他是谁**：岗位 + 级别 + 领域
- **他做过什么**：核心经历 / 产品 / 技术栈
- **他在哪**：城市 / 公司梯队
- **什么阶段**：年限 / 校招社招
- **为什么找他**：招聘方的真正痛点

**第二步：拆解约束** — 判断标准："不满足这条，这个人还要不要看？"

- **必要条件**：不满足直接淘汰（城市、学历底线、岗位大类、最低年限）
- **加分条件**：满足优先推荐，不满足也看（特定公司背景、细分技术、院校层次）

> 最常见错误：把加分条件当必要条件。"最好是阿里出来的"不是必要条件。

**第三步：多路检索策略** — 一个人至少有 3 种被描述的方式，同时撒网：

- **岗位切入**：用岗位名 + 同义词
- **经历切入**：用产品名 / 项目名 / 公司名
- **技术切入**：用底层技术栈 / 方法论

### 输出规范

收到用户输入后，输出以下两个模块，**全部使用业务语言，不暴露任何技术参数**：

**模块 1 — 理想画像**

```
📋 理想画像

【必要条件】
• 岗位方向：……
• 工作年限：……
• 学历要求：……
• 工作城市：……
• 核心能力：……

【加分条件】
• 公司背景：……
• 院校背景：……
• 项目经历：……
• 其他加分：……

⚠️ 说明：（做了假设或放宽条件时，写清理由）
```

**模块 2 — 检索策略**

```
🔍 检索策略

我计划从 N 个角度同时搜索，互相补充：

1. 从 XX 切入：……（一句话说清楚这一路捞谁）
2. 从 XX 切入：……
3. 从 XX 切入：……

确认没问题我就开始搜索，如需调整请直接告诉我。
```

### 模糊输入处理

只在一种情况下回问：信息少到连画像都还原不出来（如只说了"帮我招个人"）。其他情况一律**带假设往下走**，把假设写在「⚠️ 说明」里。

**必须用户确认**（红线 1）：用户确认后进阶段 2，提出修改则调整后重新输出。

### 城市口径确认（v6.1.0 新增 · locations 非空时必问）

用户确认完理想画像后，如果 `locations` 非空，**追加一个单独的确认问题**：

```
📍 城市口径确认
我会同时搜"当前在深圳"和"期望去深圳"的候选人（任一满足即召回，由脚本双子请求合并）。

另外，社招简历中有相当一部分候选人没填期望城市（实测：当前=深圳 的 5915 人中约 3428 人没填期望）。
这部分人是否纳入？
- 是 / 纳入（推荐，召回更广） → supportNoExpectCity=true
- 否 / 只要明确期望=深圳 或 当前=深圳的 → supportNoExpectCity=false（默认）
```

用户回答后：
- 记录到 `profile.json` 的 `must.supportNoExpectCity`（布尔）
- 同步写入 `search_params.json` 的 `common_params.supportNoExpectCity`
- 用户不回答 → 默认 `false`（保守行为）

> 实测背景：API 实测 location 和 expectLocation 是 AND 关系，不是 OR。脚本在 location 非空时会自动拆成双子请求实现"当前 OR 期望"的 OR 语义，见 `interfaces/search-social-resume.md` 的"城市字段实测结论"。

---

## 阶段 2：检索参数生成

**目标**：把阶段 1 确认后的画像 + 检索策略翻译成可直接执行的搜索 API 调用参数。

### 核心原则

1. **必要条件 → 结构化字段，加分条件 → 不进参数**
2. **每一路用不同关键词角度，结构化字段保持一致**
3. **宁可召回多，不要搜不到**

### 参数生成规则

**searchKey（全文检索关键词）**：
- 每一路 3-6 个词
- 默认 OR 关系（`searchKeyUseAnd = false`）
- 各路 searchKey 必须差异化，代表不同搜索角度

**必要条件 → 结构化字段映射**：

| 必要条件 | API 字段 | 映射规则 |
|---------|---------|---------|
| 学历底线 | `minDegree` | "大专"→大专，"本科"→本科，"硕士"→硕士，"博士"→博士 |
| 工作城市 | `location` | 城市名数组，如 `["深圳","上海"]` |
| 岗位方向 | `positionTags` | 优先 tag_suggest 精确匹配，次选上级大类兜底 |
| 工作年限 | `minWorkYear` / `maxWorkYear` | 传数字 |

**加分条件不放进搜索参数**，留到粗筛/精读阶段判断。

**岗位方向锚定（每一路必须执行）**：

1. `positionTags` 精确匹配（通过 tag_suggest 查询）
2. 上级大类兜底（如"存储开发"→"后台"）
3. searchKey 注入岗位别名（兜底）

**多路一致性**：所有路径共享相同的结构化字段（positionTags / minDegree / location / workYear），各自不同的只有 searchKey。

### 🆕 v6.1.1 `must.companies` 强制下发（用户明指公司时必做）

当 `profile.must.companies` 非空（用户明确说"只要 XX 公司的"），**必须**在 `search_params.json` 的 `common_params` 里写入 `mustCompanies` 数组：

```json
{
  "common_params": {
    "location": ["深圳"],
    "mustCompanies": ["腾讯", "字节跳动"],
    ...
  },
  "routes": [...]
}
```

脚本 `social_search.py` 会自动把 `mustCompanies` 下发到**每条 route 的 `allCompany`**（与该 route 原有 `allCompany` 取并集去重）。这样所有搜索路径都会让 MCP 后端基于**简历全部工作经历**做命中校验，不会因"最近公司不是目标公司"而漏掉早年待过目标公司的候选人。

**对应的客户端层变化（v6.1.1）**：
- 粗筛层已删除 `must.companies` 的硬过滤分支（`rough_screen.py` 只能看 `lastEmployerName`，会误杀）
- 精读层也不再做公司核对（搜索端已保证）

**`mustCompanies`（全路硬约束）与"公司锚定路"（独立一路做 bonus 召回）是两回事**：

| 字段 | 来源 | 作用 | 关系 |
|------|------|------|------|
| `common_params.mustCompanies` | `profile.must.companies` | 所有路硬约束 | AND |
| 公司锚定路的 `allCompany` | `profile.bonus.tier1_companies` | 单独一路扩召回 | OR |

用户明指公司时：`mustCompanies` 下发到**所有路**（包括公司锚定路，此时该路的 `allCompany` 会被 `mustCompanies` 收窄，符合预期）。

> ⚠️ **不要** 把用户明指的公司写到公司锚定路的 `allCompany` 里——应该写到 `common_params.mustCompanies` 让脚本统一下发。

### 🆕 v6.1.0 公司锚定路（泛行业场景强制）

当用户画像的岗位方向属于**"标签泛、行业强"**类时，多路检索中**必须**加一路"公司锚定路"：

**判定"泛行业"**（至少匹配一条即算）：
- 行业词出现在用户原话或画像里：**游戏 / 直播 / 金融 / 电商 / 医疗 / 汽车 / 教育 / 出海 / 文娱**
- 岗位名是标签化大类（运营/产品/市场/BD/设计）但用户明确圈定了行业

判定"非泛行业"：
- 垂直技术栈（如存储/编译器/强化学习/计算机视觉/图形学/分布式训练）
- 岗位本身就自带行业（如"游戏策划"、"半导体工程师"）—— 标签足够区分

**公司锚定路规则**：
- `allCompany`：10-20 家领头公司（数组，OR 关系）
  - **🆕 v6.2.0 唯一数据源**：直接复用 `profile.bonus.tier1_companies`，**禁止二次生成**
    - 即：阶段 1 已让 LLM 基于行业/岗位生成过一次清单并写入 `profile.bonus.tier1_companies`，阶段 2 这里**原样照搬**作为 `allCompany`
    - 严禁阶段 2 重新组织一份不同的清单（会造成粗筛维度 2 加权和搜索召回的 tier1 不一致，行业对口率数据无法对齐）
  - **若用户在 `must.companies` 明指了公司 → 不要在这一路重复写；改用 `common_params.mustCompanies` 让脚本统一下发到所有路（v6.1.1）**
- `searchKey`：用岗位核心词聚焦（3-5 个词，OR）
- `positionTags`：可放宽或不填（公司已经锁定行业，标签不用太严）

**🆕 v6.2.0 LLM 生成公司清单的硬约束**（原 `data/tier1-companies-by-domain.json` 已下线，全部由 LLM 在阶段 1 现场生成）：
1. 数量 10-20 家，按行业知名度/与岗位相关度从高到低排
2. **必须使用腾讯 ATS 规范名**（`字节跳动` ✓ / `ByteDance` ✗ / `字节` ✗；`阿里巴巴` ✓ / `Alibaba` ✗）。无把握时优先选最常见、最规范的中文写法
3. 必须是**真实存在、当前仍运营**的公司（不写已倒闭/已被并购改名的旧名）
4. 综合大厂与行业垂类**合理搭配**——大厂提供"大厂背景"信号、垂类公司提供"行业对口"信号，由模型根据用户画像现场判断比例（避免一边倒）
5. 行业垂类公司**不少于 5 家**（避免清单过度集中在综合大厂，丢掉行业对口信号）
6. **生成前在内部默念一遍**："这家公司在腾讯 ATS 里搜得到吗？是当前简历库里有人挂的公司名吗？" 没把握的不写
7. **同一会话内只生成一次**：阶段 1 写进 `profile.bonus.tier1_companies` 后，阶段 2 公司锚定路、粗筛维度 2 加权全部复用这一份，**禁止重新列**

### 自检

- [ ] searchKey 是不是用了 AND？默认应该用 OR
- [ ] 加分条件有没有混进参数里？
- [ ] 每一路 searchKey 是否有差异？
- [ ] 单路词数是否在 3-6 个？
- [ ] 岗位方向锚定是否每一路都有？
- [ ] **【v6.1.0】用户画像是否属于泛行业？若是，公司锚定路是否已加入且 `allCompany` 含 10-20 家？**
- [ ] **【v6.1.1】若 `profile.must.companies` 非空 → `common_params.mustCompanies` 是否已写入？（不要写到某一条 route，也不要只放到公司锚定路）**

### ⚠️ 搜索参数常见坑

| 参数 | 合法枚举值 | 踩坑点 |
|---|---|---|
| `positionTags` | **见 `references/position_tags.json`（76个合法值）** | 不能写"前端开发"/"后端开发"，必须写"前端"/"后台"；常用映射见 JSON 文件的 `common_mappings` |
| `schoolLevelTags` | `C9 / 211 / 985 / 海外高校 / 港澳台院校 / 国内普通高校` | 六个中文枚举值 |
| `allCompany` | **`array<string>`**（OR 关系） | 🔴 **不能传逗号字符串**，必须是数组 `["网易","米哈游"]` |
| `skillTags` | 需走 tag_suggest 获取合法值 | 比 searchKey 准确，优先使用 |
| `searchKey` | 自由文本，空格分隔 | 职位/技能/公司/学校应用对应 tag 字段，searchKey 只查"项目描述"里的自由词 |
| `locked` | 0/1 | 输入参数仍有效，但**返回字段的 locked 不可靠**，以 Status 为准 |

---

## 阶段 3：脚本搜索 + 粗筛

### 3a. 脚本搜索（social_search.py · 3路并发）

**模型根据阶段 2 的检索参数，先 `write_to_file` 落盘 `search_params.json` 到当前 workspace，然后运行脚本**：

```bash
cd {workspace} && python3 {skillDir}/scripts/social_search.py \
    --params search_params.json \
    --output candidates.jsonl
```

`search_params.json` 结构（详见 `references/step2-search-templates.md`）：

```json
{
  "common_params": {
    "location": ["深圳"],
    "workYearStart": 5,
    "workYearEnd": 8,
    "minDegree": "本科",
    "locked": 0,
    "size": 30,
    "from": 0
  },
  "routes": [
    {"name": "岗位切入", "params": {"positionTags": ["后台"], "searchKey": "存储 网盘 Ceph", "searchKeyUseAnd": false}},
    {"name": "经历切入", "params": {"positionTags": ["后台"], "searchKey": "对象存储 分布式存储", "searchKeyUseAnd": false}},
    {"name": "技术切入", "params": {"positionTags": ["后台"], "searchKey": "C++ Go 微服务", "searchKeyUseAnd": false}}
  ]
}
```

脚本会自动把 `common_params` 合并到每个 route，并生成 `diggerSearchId`，**无需手动写**。

脚本内部自动完成（v4.3 并发优化）：
- **3 路并发搜索**（ThreadPoolExecutor，耗时从 ~90s 降至 ~30s）
- 每路单页最多 30 条（不翻页），3 路合计原始 ≤ 90 条
- 按 `rid` 去重合并
- `atsRights` 非空过滤
- `slim_search_result()` 字段精简
- 落盘 JSONL（每行一条简历）

> ⚠️ **`--params` 必传**。不传脚本会立即报错，避免静默使用错误参数搜出无关简历。

### 3a-T. 跨天去重（⏰ 仅定时任务上下文执行 · 交互式搜索跳过）

> 🔴 **触发条件**：当且仅当本次搜索是**定时任务**（automation）在跑「每日简历搜索推送」时执行本步。
> **用户在对话里手动搜简历时，绝不执行本步**——交互式搜索每次都要看全量候选，不去重。

**要解决的问题**：定时任务每天用同样的搜索条件跑，候选池高度重叠，导致「每天推的简历几乎一样」。`social_search.py` 只做单次任务内 rid 去重，不负责跨天。本步在推送前做一层「已推名单差集」，只推真正的新增。

**怎么做**：在 3a 落盘 `candidates.jsonl` 之后、3b 粗筛之前，运行差集脚本：

```bash
cd {workspace} && python3 {skillDir}/scripts/dedup_pushed.py \
    --task-key social-daily-<本任务稳定别名> \
    --input candidates.jsonl \
    --output new_candidates.jsonl
```

- `--task-key`：**每个定时任务一个稳定且唯一的 key**（按任务隔离，社招/校招/不同岗位各推各的，互不干扰）。建议用 automation_id，或稳定业务别名如 `social-daily-system-planning`。同一个定时任务每天必须用同一个 key。
- 默认 **30 天滚动窗口**：30 天内推过的不再推，超 30 天自动过期可复推（无需手动传 `--window-days`，沿用名单记录值）。
- 之后的 3b 粗筛、5 精读，**输入改用 `new_candidates.jsonl`**（而非 candidates.jsonl）。

**读脚本 stdout 的 JSON 摘要**，按 `new_count` 分支：

| `new_count` | 处理 |
|---|---|
| `> 0` | 正常：用 `new_candidates.jsonl` 继续 3b/5，推送时说明「今日新增 N 人（已自动过滤近 30 天推过的 M 人）」 |
| `== 0` | **推「今日无新增」**：明确告诉用户「今日该搜索条件下无新增简历（近 30 天已推 M 人均已覆盖），无需重复查看」。**不要静默不推**——让用户能区分「真没新人」和「任务又 missed 了」 |

> ⚠️ 历史名单存于用户级目录 `~/.workbuddy/skills/txzhaopin-pushed-history/<task-key>.json`，跨 workspace 共享，定时任务在任意 cwd 跑都能命中。脚本写名单失败只告警不阻断（宁可某天多推一次，不让任务挂掉）。

### 3b. 粗筛打分（rough_screen.py）

**目标**：从去重后的候选池中按高亮命中频率打分，取 Top 30 进入精读。

模型将 `social_search.py` 的输出 JSONL 文件作为输入，调用粗筛脚本：

```bash
python {skillDir}/scripts/rough_screen.py \
    --input candidates.jsonl \
    --profile profile.json \
    --top-n 30 \
    --output top_rids.json
```

**粗筛打分逻辑（v6.1.0 四维加权）**：
- **硬约束**（城市/工作年限/学历/学校/用户明指公司）→ 不满足直接剔除
  - **v6.1.0 城市分支**：若 `must.supportNoExpectCity=true` 且简历期望城市为空 → 通过
- **四维加权打分**：
  - 维度 1（highlight）：`len(highLightOthers)`，权重 1.0，无上限（保留搜索相关性）
  - 维度 2（company）：`lastEmployerName` 命中 `bonus.tier1_companies`，权重 2.5，上限 2
  - 维度 3（title）：`lastEmployerTitle` 命中 `bonus.position_keywords`/`seniority_keywords`，权重 2.0，上限 3
  - 维度 4（keyword）：`highLightOthers` 聚合文本命中 `bonus.skill_keywords`/`domain_keywords`，权重 1.5，上限 5
- **分档阈值**：A≥8 / B≥3 / C<3（通过硬约束但总分低）
- **Top 30 顺序**：A 档全部 → B 档按分 → C 档按分
- 详细算法和示例见 `references/step4-rough-read-fields.md`

**输出方式**：
- **文件输出（主产物）**：`top_rids.json` — 含 `top_rids`（完整 UUID 列表）+ `top_detail`（粗筛摘要 + 四维 score_breakdown） + `stats`
- **stdout（轻量摘要）**：`{"status": "ok", "output_file": "...", "top_count": N, "stats": {...}}`，不含完整 rid 列表
- Agent 通过 `read_file` 读取 `top_rids.json` 获取数据
- ⚠️ **`top_detail` 只能用于阶段 4 的快速概览表格展示，严禁在精读阶段将其当作"详情"使用**

**profile.json 由模型根据阶段 1 画像生成**，结构：

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

> ⚠️ **v6.1.0：粗筛同时使用 must（硬过滤）+ bonus（加权加分）**。
> - `must` 负责不满足直接剔除（城市/年限/学历/学校/明指公司）
> - `bonus` 全部字段参与四维加权打分（权重 1.0/2.5/2.0/1.5），**填写质量直接影响 Top 命中率**，建议每个子字段填 3-10 个关键词
> - `bonus.tier1_companies` 建议始终填充（用户已指 `must.companies` 时也要填，两者职责不同：must 硬过滤，bonus 加分）
> - 向用户解释粗筛 Top 10 时，可引用 `score_breakdown` 里的 hits 解释排序理由（如"因为命中 tier1 公司网易 + 职位名含'游戏开发'"）

---

## 阶段 4：用户确认关卡（粗筛后必须确认）

**目标**：展示 Top 10 快速概览表格，让用户决定是否进入精读阶段。

### 为什么需要这一步？

- 精读阶段需要调用 MCP 拉取完整详情并进行模型打分，**耗时较长**（约 1-2 分钟）
- 用户可能想先看看粗筛结果的质量，再决定是否继续
- 给用户一个"刹车点"，避免无效的精读开销

### Agent 执行步骤

1. **读取粗筛结果**：`read_file("top_rids.json")` 获取 `top_detail` 数组
   - v6.1.2 起 `top_rids.json` 已瘦身：前 10 条含 `highLightOthers`（前 3 条、shortContent 截断 150 字符）+ `score_breakdown` 的 hits 摘要；11-30 条只含基础身份字段。文件体积 ~10 KB，兼容小上下文模型的 `read_file` 字符上限
   - `top_rids` 数组（30 个完整 UUID 字符串）未变，精读阶段正常使用
2. **提取 Top 10**：从 `top_detail` 中取前 10 条，提取以下字段用于概览表格展示
3. **输出快速概览表格**（字段取值规则见下方"字段提取规则"）
4. **表格后必须生成两段 case-by-case 说明**：`🔍 粗筛做了什么` + `⚠️ 精读要重点评估什么`（v6.1.1 重点）
5. **输出用户确认问询**

### 输出模板

```markdown
## 📋 Top 10 候选人快速概览

| # | 姓名 | 当前公司 | 当前岗位 | 学校 | 亮点关键词 | 简历链接 |
|---|------|---------|---------|------|-----------|---------|
| 1 | 张三 | 字节跳动 | 高级后端 | 北京大学 | 分布式/推荐系统 | [查看](https://zhaopin.woa.com/resume/resume_detail?rid=abc123-def456&fromplace=MCP) |
| ... | ... | ... | ... | ... | ... | ... |

---

🔍 粗筛做了什么
{模型生成的一段话，2-3 句，基于本次 profile 口语化说清楚这一轮用了哪些筛选/排序维度}

⚠️ 精读要重点评估什么
{模型生成的一段话，2-3 句，挑 2-3 个最能体现本次 case 特色的维度，口语化说清楚精读要盯什么；不要罗列条目，不要堆技术词}

👉 是否进入精读？精读将拉取这 30 份简历的完整详情，由模型深度评估打分，预计 1-2 分钟。请回复"是"/"继续"确认，或提出调整建议。
```

### 🆕 v6.1.1 两段话生成规则（case-by-case · 口语化）

阶段 4 表格后**必须**根据当前 profile 生成两段口语化文字（**不要罗列条目，不要堆技术词**）：

**🔍 粗筛做了什么**（2-3 句）
- 从 `profile.must` 挑实际用到的硬筛维度 + 从 `profile.bonus` 挑用到的加权维度
- 按当前 case 组织成自然语言，**没用到的字段不写**

**⚠️ 精读要重点评估什么**（2-3 句）
- 从当前 profile 挑 **2-3 个最能体现 case 特色**的维度（不要全堆）
- 重点讲"粗筛看不见但精读能看见"的证据（真实深度 / 量级 / 晋升路径 / 论文 / 比赛等）

📖 **完整字段映射表 + Few-shot 示例** → [`references/step4-case-description-rules.md`](references/step4-case-description-rules.md)

### 字段提取规则（从 top_detail 摘要中提取）

| 表格列 | 数据来源 | 说明 |
|--------|---------|------|
| 姓名 | `name` | 直接取 |
| 当前公司 | `lastCompany` | 直接取 |
| 当前岗位 | `currentJobTitle` | 直接取 |
| 学校 | `school` | 直接取 |
| 亮点关键词 | `highLightOthers` | 取前 3 个高亮的 shortContent，用 / 分隔 |
| 简历链接 | `rid` | **必须拼接完整 URL：`https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP`**，其中 `{rid}` 替换为实际的 rid 值（UUID 格式） |

### 用户确认规则（红线 2）

- ✅ 用户回复"是"/"继续"/"好的"/"可以"等肯定词 → 进入阶段 5 精读
- ❌ 用户提出修改建议 → 返回阶段 1 或阶段 2 调整画像/检索参数
- ❌ 用户回复"不要"/"取消"/"算了" → 终止流程，不进入精读

**必须用户确认**（红线 2）：未获用户确认，不得进入阶段 5 精读。

---

## 阶段 5：精读（Python 脚本拉详情 + 模型评估）

**目标**：用 Python 脚本批量调 MCP 获取详情并过滤字段，返回精简数据给模型评估打分。

### 🔴 精读调用范式（v6.1.3 红线）

**命令模板（永远这样写，不加任何重定向/管道）**：

```bash
python3 {skillDir}/scripts/deep_read.py \
    --rids "$ALL_RIDS" \
    --offset {OFFSET} \
    --limit {LIMIT}
```

**❌ 禁止的写法**（这些都会破坏"不落盘"原设计 或 吞掉进度日志）：

| 错误写法 | 为什么错 |
|----------|----------|
| `... > batch1.json` | 把 stdout 存成文件，违反"不落盘"原设计 |
| `... 2>&1` | 把 stderr 进度日志塞进 stdout，污染 JSON + 用户看不到进度 |
| `... > batch1.json 2>&1` | 以上两条同时踩 |
| `... \| tee batch1.json` | 旁路落盘，同样违反原设计 |
| `... \| head -N` / `\| tail -N` / `\| jq ...` | 破坏 JSON 完整性 |

**✅ 正确方式**：
1. 不加任何重定向，命令的 stdout（纯 JSON）会直接作为 `execute_command` 工具的返回值给你（模型）
2. 你从 `execute_command` 返回值的 stdout 字段拿到 JSON 字符串 → `json.loads()` → 用
3. **禁止在 `execute_command` 之后紧接 `read_file("batchN.json")`**，因为**根本没有文件**
4. stderr（进度日志 `[1/30] 获取 xxx...`）不受影响，会实时打到用户屏幕

### 📐 `--limit` 按模型上下文自适应

| 模型上下文 | `--limit` 推荐值 | 单批 Token ≈ | 说明 |
|------|------|----|----|
| ≥128k（Claude Opus / GPT-4 等） | **5**（默认） | ~8k | 一批 5 份舒适 |
| 32k-64k（Hunyuan3.0 等） | **3** | ~5k | 留给模型推理空间 |
| 16k 小模型 | **2** | ~3k | 紧张但可用 |
| <16k | **1** | ~1.5k | 按单份精读 |

**动态降级**：如果发现 `execute_command` 返回的 JSON 尾部不完整（解析失败）→ **立刻把 `--limit` 减半重试**。

### ⚠️ 精读前检查（每次必须确认）

```
□ 1. 我是否已获得用户在阶段 4 的明确确认？（没确认不能进精读）
□ 2. 我的命令里是否**没有** `>`、`2>&1`、`| tee`、`| head`、`| jq` 等重定向/管道？
□ 3. 我是否打算从 `execute_command` 返回值直接读 JSON，而**不是** `read_file("batchN.json")`？
□ 4. 我的 `--rids` 是否传**全部 30 个 rid**（不是本批子集），且 `--limit` 按上下文选档（默认 5；Hunyuan3.0 等 32k 用 3）？
□ 5. 我的打分方式是"模型按画像维度评估"？（不是 len(otherHighlight) 等简化方式）
□ 6. 我是否采用"分批 + 早停"机制？（累计 10 份合格即停）
```

### 核心配置

```
BATCH_SIZE = 5 (或 3/2/1)  # 每批拉取数量（按 --limit 推荐表）
TARGET = 10                # 目标合格数（达到即停）
MAX_CANDIDATES = 30        # 最大候选人数
PASS_THRESHOLD = 60        # 合格分数线
```

### 执行流程（分批 + 早停）

```
1. Agent 从 top_rids.json 读取 top_rids UUID 数组（30 个）
   - 拼接为逗号分隔字符串 ALL_RIDS（**全部 30 个，所有批次复用同一个，不要按批切片**）

2. 初始化变量：
   - offset = 0           # 当前偏移
   - qualified_count = 0  # 累计合格数
   - qualified_list = []  # 合格候选人列表

3. 循环执行（直到 qualified_count >= 10 或遍历完毕）：
   
   a. 调用 deep_read.py 拉取本批（不重定向、不加管道）：
      python3 {skillDir}/scripts/deep_read.py \
        --rids "$ALL_RIDS" --offset {offset} --limit {LIMIT}
   
   b. 从 execute_command 的返回值里提取 stdout 字符串 → json.loads() → 得到 batch
   
   c. 模型逐份精读 batch.results：
      - 阅读 workExp[].summary 具体内容
      - 阅读 projects[].summary 具体内容
      - 对照画像维度评估，给出评分
      - 分数 >= 60 → 合格，加入 qualified_list
   
   d. 更新 offset = batch.batch_info.next_offset
   
   e. 检查终止条件：
      - qualified_count >= 10 → 停止循环
      - batch.batch_info.has_more == false → 停止循环

4. 输出最终推荐表格（按分数降序，最多 10 份）
```

### deep_read.py 脚本说明

**位置**：`scripts/deep_read.py`

**功能**：
- 分批调用 MCP 获取简历详情（支持 offset/limit）
- **字段过滤**：只保留评估所需字段，大幅减少 Token 消耗
- 内置频率控制（每 5 个暂停 1 秒）
- **不落盘**：JSON 直接输出到 stdout（作为 `execute_command` 工具返回值给模型），进度日志走 stderr（打到用户屏幕）
- ⚠️ 调用时**禁止**加 `>`、`2>&1`、`| tee` 等重定向/管道（详见阶段 5 的"精读调用范式"红线）

**用法**：
```bash
python3 {skillDir}/scripts/deep_read.py \
  --rids "rid1,rid2,rid3,..." \
  --offset 0 \
  --limit 5
```

**参数说明**：
| 参数 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| --rids | ✅ | - | 逗号分隔的**全部 30 个** rid 列表（每批都传同一个，切片由 --offset/--limit 完成）|
| --offset | - | 0 | 起始位置（从第几个开始） |
| --limit | - | 5 | 本批数量 |
| --rate-limit | - | 5 | 频率控制：每多少个暂停 1 秒 |

**输出格式**：
```json
{
  "results": [
    {
      "rid": "xxx",
      "name": "张三",
      "workYears": 5,
      "lastCompany": "字节跳动",
      "currentJobTitle": "高级后端",
      "education": "硕士",
      "school": "北京大学",
      "workExp": [...],     // 前 2 段，summary 截断 200 字
      "projects": [...],    // 前 2 段，summary 截断 200 字
      "education_list": [...],
      "skills": [...],
      "latestFlow": {...}   // 面试流程摘要（风险判断用）
    },
    ...
  ],
  "errors": [],
  "batch_info": {
    "offset": 0,
    "limit": 5,
    "total_candidates": 30,
    "batch_count": 5,
    "next_offset": 5,
    "has_more": true
  }
}
```

### 字段过滤规则（脚本内置）

**保留字段**：
- 基本信息：`rid / name / age / gender / workCity / workYears / currentJobTitle / lastCompany / education / school / status / statusText / isLock`
- 工作经历：前 2 段，summary 截断 200 字
- 项目经历：前 2 段，summary 截断 200 字
- 教育经历：全部保留
- 技能标签：全部保留
- 面试流程：仅最近 1 条摘要

**过滤掉**：
- 自我评价 / 证书 / 语言 / 培训
- 面试评价详情 / 沟通记录详情
- 期望薪资 / 到岗时间
- 附件 / 照片

### 精读打分（模型执行）

模型拿到精简详情后进行打分：

**打分公式**：
```
match_score = 必要条件分(60) + 加分项(40)
  - 必要条件每维度等权 60/N 分：✅满分 / ⭐60% / ❌0
  - 加分项每维度等权 40/M 分：✅满分 / ⭐60% / ❌0
```

**命中阈值**：

| 区间 | 等级 | 命中 |
|---|---|---|
| 90-100 | 💎 深度匹配 | ✅ |
| 75-89 | ⭐ 高度匹配 | ✅ |
| 60-74 | ✅ 基础匹配 | ✅ |
| < 60 | ⚠️ 不匹配 | ❌ |

### 执行示例（分批 + 早停）

以下示例以 `--limit 5` 演示（大模型场景）。注意所有命令**都没有任何重定向/管道**。

```bash
# 假设 skillDir=/Users/xxx/.codebuddy/skills/zhaopin-social-operations

# 从 top_rids.json 提取完整 rid 列表（top_rids 是 UUID 字符串数组，直接 join）
ALL_RIDS=$(python3 -c "import json; d=json.load(open('top_rids.json')); print(','.join(d['top_rids']))")

# 批次 1：拉取第 0-4 份（offset=0, limit=5）—— JSON 直接在 execute_command 返回值里
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 0 --limit 5
# → 模型从工具返回值解析 JSON → 精读 5 份 → 合格 3 份 → 累计 3

# 批次 2：拉取第 5-9 份（offset=5, limit=5）
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 5 --limit 5
# → 合格 4 份 → 累计 7

# 批次 3：拉取第 10-14 份（offset=10, limit=5）
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 10 --limit 5
# → 合格 3 份 → 累计 10 ✅ 停止

# 实际拉取 15 份（而非 30 份），节省约 50% 时间
```

**小上下文模型（如 Hunyuan3.0 / 32k）请把 `--limit 5` 改为 `--limit 3`**：

```bash
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 0 --limit 3
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 3 --limit 3
...
```

**反例（❌ 永远不要这样写）**：

```bash
# ❌ 错：把 JSON 存成文件，违反"不落盘"设计
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 0 --limit 5 > batch1.json

# ❌ 错：把进度日志塞进 stdout，用户看不到进度 + JSON 污染
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 0 --limit 5 2>&1

# ❌ 错：两条同时踩
python3 $skillDir/scripts/deep_read.py --rids "$ALL_RIDS" --offset 0 --limit 5 > batch1.json 2>&1
```

### 模型精读输出格式

对每批简历，模型应输出：

```markdown
### 批次 1 精读结果（offset=0, 本批 5 份）

| # | 姓名 | 工作年限 | 上家公司 | 学历 | 评分 | 合格 | 关键证据 |
|---|------|---------|---------|------|------|------|---------|
| 1 | 张三 | 5年 | 字节跳动 | 硕士 | 85 | ✅ | "负责推荐系统，QPS 500万" |
| 2 | 李四 | 3年 | 阿里 | 本科 | 72 | ✅ | "参与支付系统开发" |
| 3 | 王五 | 2年 | 小公司 | 本科 | 45 | ❌ | 无大规模系统经验 |
| 4 | 赵六 | 6年 | 腾讯 | 硕士 | 90 | ✅ | "主导云网络控制面重构" |
| 5 | 钱七 | 4年 | 美团 | 本科 | 58 | ❌ | 缺少核心技能证据 |

**本批合格：3 份 | 累计合格：3 / 10**

---
（如果累计未达 10，继续下一批）
```

---

## 阶段 6：最终输出（会话内表格）

**⚠️ 不生成 MD 报告文件，直接在会话中输出推荐表格。**

### 输出规范

精读完成后，Agent 直接在会话中输出以下表格（按分数降序排列）：

```markdown
## 🏆 Top 10 推荐候选人

| 姓名 | 最近雇主 | 职位 | 亮点 | 匹配理由 | 简历链接 |
|------|---------|------|------|---------|---------|
| 张三 | 字节跳动 | 高级后端工程师 | 分布式存储/推荐系统 | 5年经验，985硕士，核心项目匹配 | [查看](https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP) |
| ... | ... | ... | ... | ... | ... |
```

### 字段说明

| 表格列 | 数据来源 | 说明 |
|--------|---------|------|
| 姓名 | 精读详情的 `name` | 直接取 |
| 最近雇主 | 精读详情的 `lastCompany` | 直接取 |
| 职位 | 精读详情的 `currentJobTitle` | 直接取 |
| 亮点 | 精读评估时识别的关键亮点 | 2-4 个关键词，用 / 分隔 |
| 匹配理由 | 模型打分时的核心匹配点 | 一句话概括为什么推荐（≤20字） |
| 简历链接 | `rid` 拼接 | **必须拼接完整 URL：`https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP`**，其中 `{rid}` 替换为精读返回的实际 `RID` 值（注意详情接口返回的是大写 `RID`） |

### 执行要点

1. **不生成任何文件**：表格直接输出到会话中
2. **按分数降序排列**：分数最高的排第一
3. **只输出命中的候选人**：score ≥ 60 的才进表格
4. **表格后简要说明**：一句话说明本次搜索漏斗（如"从 150 条召回中筛出 10 人"）

---

## 🔒 三条红线（必须遵守）

1. **阶段 1 未获用户确认，不得进入阶段 2。** 任何情况下都不允许跳过画像确认。
2. **阶段 4 未获用户确认，不得进入阶段 5。** 粗筛后必须输出 Top 10 快速概览表格，等待用户确认后才能精读。
3. **精读必须用模型按画像维度打分**，严禁用 `len(otherHighlight)` 等简化方式。

---

## 📂 目录结构

```
zhaopin-social-operations/
├── SKILL.md                          # 本文件（入口，v6.0.1）
├── scripts/
│   ├── mcp_client.py                 # MCP JSON-RPC 客户端
│   ├── social_search.py              # 3 路并发搜索 + 去重 + 落盘 JSONL
│   ├── rough_screen.py               # 粗筛：纯高亮频率打分 + 硬约束 → Top N rid
│   └── deep_read.py                  # 精读：批量拉详情 + 字段过滤 → 精简 JSON
├── interfaces/
│   ├── search-social-resume.md       # 搜索接口（含实测字段名对照表）
│   ├── getresume-with-detail.md      # 详情接口（含实测返回结构）
│   └── favorite-resume.md            # 收藏接口（v6.0 可选附加能力）
├── filters/
│   └── social-filters-cheatsheet.md
├── data/
│   └── domain-synonyms.json             # 阶段 2 searchKey 同义词扩展用
│                                        # （tier1-companies-by-domain.json 自 v6.2.0 下线，公司清单改由 LLM 在阶段 1 现场生成）
└── references/
    ├── step1-profile-template.md     # 画像扩展白名单 + profile.json 结构
    ├── step2-search-templates.md     # 多路检索参数 + 脚本搜索说明
    ├── step4-rough-read-fields.md    # 粗筛规则详解
    ├── step5-deep-read-schema.md     # 精读 + 打分公式 + 输出模板
    ├── step6-shortage-handling.md    # 不足处理 + 收藏（可选附加）
    ├── troubleshooting.md            # 故障排查（含字段名踩坑记录）
    └── position_tags.json            # 76 个 positionTags 合法枚举值
```

> 📌 **维护者注意**：根目录除 `SKILL.md` 外不应有任何 `.json` / `.jsonl` / `.md` 工作产物。打包前请清理 `candidates.jsonl`、`top_rids.json`、`profile.json`、`search_params.json`、`batch*_details.json`、`rough_audit.json` 等运行残留。新增 `data/` 文件前，请先在 `scripts/` 或 SKILL.md 中明确引用入口；只有被引用的资产才该入包。

---

## 🎯 典型对话片段

**用户**：「找 2 个深圳的后端 senior，5 年以上，做过推荐系统的，最好来自一线大厂」

**流程**：
1. 画像生成 → 展示理想画像 + 检索策略 → **用户确认**
2. 生成 3 路检索参数 → `write_to_file search_params.json` 落盘到当前 workspace
3. 运行 `social_search.py --params search_params.json`（3 路并发搜索 + 去重 + 落盘 JSONL）→ `rough_screen.py` 打分 → Top 30
4. **输出 Top 10 快速概览表格** → **用户确认进入精读**
5. 运行 `deep_read.py --rids "rid1,rid2,..."` → 获取精简详情 → 模型按画像维度打分
6. 直接在会话中输出 Top 10 推荐表格（姓名/最近雇主/职位/亮点/匹配理由/简历链接）
