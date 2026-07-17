---
name: zhaopin-operations
description: 腾讯内部校招简历搜索技能（zhaopin.woa.com 校招入口）。通过 recruit-mcp 校招 API 实现校园招聘简历的搜索、多维筛选和推荐。触发词：校招简历、校招搜索、搜校招简历、找校招的人、找应届生、搜应届生、校招候选人、校招人才库、校园招聘搜简历、找毕业生、搜毕业生、实习生简历、找实习生、按学校/专业/学历搜简历、校招找人、帮我招个应届生。⚠️ 仅校招；社招搜简历走 zhaopin-social-operations。
version: 3.15.0
tags: [recruitment, mcp, zhaopin, hr]
support_contact: fayellawang
---

# 腾讯校招简历筛选技能


## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("zhaopin-operations")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "zhaopin-operations" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
```

**执行约束**：
1. **每次进入都要执行** — agent 每次通过 `use_skill("zhaopin-operations")` 调用本 skill 时都跑一次，不要因为"刚跑过"就跳过。
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

- `guides/resume-filtering-manual.md` — 筛选条件目录 & 参数速查表

---

## 🚫 禁止使用 mcp_add（CRITICAL — 必须遵守）

> 🔴 **本技能的 MCP 服务 `recruit-mcp` 完全通过 `mcporter` 管理（配置、调用、鉴权）。**
>
> **绝对禁止**使用 `mcp_add`（系统 MCP 管理工具）来添加或配置 `recruit-mcp`。
>
> - ❌ **禁止** 调用 `mcp_add` 添加 recruit-mcp 服务
> - ❌ **禁止** 调用 `mcp_call_tool` 直接调用 recruit-mcp（recruit-mcp 不是系统 MCP，无法通过 mcp_call_tool 访问）
> - ❌ **禁止** 以任何方式绕过 mcporter 直接操作 recruit-mcp
> - ✅ **唯一正确方式**：通过 `mcporter call recruit-mcp CallAPI ...` 或 `scripts/mcporter_call.py` 调用
> - ✅ **配置方式**：通过 `mcporter config add recruit-mcp ...` 配置
>
> **原因**：recruit-mcp 走太湖授权鉴权（弹窗连接走太湖 SSO，或 mcporter 配太湖 Token）。`mcp_add` 无法处理这套鉴权方式，强行使用会导致连接失败或鉴权错误。

---

## 🎯 技能概述

通过 `mcporter call recruit-mcp CallAPI` 调用招聘平台 API，实现简历搜索、筛选和推荐。

> 🔴 **当 keyword 含 `|`（OR 组合）时**，必须使用 **Python 脚本** 间接调用 mcporter，详见 [跨平台兼容性](#-跨平台兼容性python-脚本方案) 章节。技能自带现成脚本 `scripts/mcporter_call.py`，复制到临时目录即可直接使用。此方案 **Windows / macOS / Linux 通用**。
> 不含 `|` 的简单调用（如精读接口）可直接用 `execute_command` 调 `mcporter call ...`。

**核心流程**：

```
0. 环境预检 → 确认 Node.js / mcporter / recruit-mcp 配置 / Token 鉴权均正常（面试官权限在首次搜索时验证）
1. 解析需求 → 拆解为 keyword + 结构化筛选条件
2. 读取相关 filters/ 文档，确认参数格式
3. 搜索 → 多次调整条件扩展候选池
4. 粗读 → 提取关键字段，基于摘要信息快速评估
5. 精读 → 选择性读取简历详情，验证匹配度
6. 输出 → 约10份推荐简历（Markdown表格）
```

---

## 📋 完整工作流程

### 🔴 阶段0：环境预检与自动修复（CRITICAL — 必须首先执行）

> **每次会话开始使用本技能时，必须先完成环境预检。条件 1-5 全部满足后才能进入阶段1（条件6在首次搜索时自动验证）。**
> AI 应当主动修复能自动修复的问题，只在必须用户介入时才提示用户。

> ⚠️ **无需阅读脚本内容**：`scripts/preflight_check.py` 是自包含的可执行脚本，直接运行即可。

#### 6 项必要条件（全部满足才能调用 MCP）

| # | 条件 | 验证方式 | 修复方式 |
|---|------|----------|----------|
| 1 | Node.js 已安装 | 预检脚本自动检测 | **AI 自动安装**（见下方） |
| 2 | mcporter 已安装 | 预检脚本自动检测 | **AI 自动安装**（见下方） |
| 3 | recruit-mcp 已配置 | 预检脚本自动检测 | **AI 自动配置**（见下方） |
| 4 | 太湖 Token 有效 | 预检脚本 HTTP 验证 | **AI 自动鉴权**（tai-oauth） |
| 5 | 招活 Token 有效 | 预检脚本 HTTP 验证 | **需要用户提供**（无法自动获取） |
| 6 | 面试官权限 | 首次搜索时自动检测 | **需要用户到 [hrright.woa.com](https://hrright.woa.com) 申请** |

#### 执行流程

**Step 1：运行预检脚本**

直接运行技能目录下的脚本（无需复制）：

```bash
python {skillDir}/scripts/preflight_check.py --fix --json
```

> `{skillDir}` 为本技能的实际目录路径。

- `--fix`：自动安装缺失的 mcporter
- `--json`：输出结构化 JSON，方便程序化判断

**Step 2：根据 JSON 输出逐项处理**

解析预检 JSON 结果，**按顺序处理每个失败项**（前面的是后面的前置依赖）：

---

**❌ 条件1失败：Node.js 未安装**

AI 直接执行安装命令（根据当前平台）：

```bash
# macOS
brew install node

# Windows
winget install OpenJS.NodeJS.LTS

# Linux (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
```

安装后重跑预检。

---

**❌ 条件2失败：mcporter 未安装**

AI 直接执行：

```bash
npm install -g mcporter
```

> 如果已传入 `--fix` 参数，预检脚本会自动尝试安装。

---

**❌ 条件3失败：recruit-mcp 未配置**

AI 执行 `mcporter config add` 来创建配置。但此时太湖 Token 和招活 Token 可能还没有，
所以应先完成条件 4 和 5 的 Token 获取，再统一写入配置。

执行顺序：**先获取两个 Token → 再一次性配置 recruit-mcp**。

---

**❌ 条件4失败：太湖 Token 无效或缺失**

AI **自动鉴权**，无需用户介入：

```
1. use_skill("tai-oauth") 加载太湖鉴权技能
2. 执行鉴权脚本：
   python tai_oauth.py --name recruit-mcp --url "https://zhaopin.mcp.it.woa.com"
3. 脚本自动获取太湖 Token 并写入 mcporter 配置的 Authorization 头
```

> tai-oauth 优先级：环境变量 `TAI_IT_TOKEN` → 本地缓存自动刷新 → 弹出浏览器 OAuth2 授权

---

**❌ 条件5失败：recruit-mcp 未连接 / 太湖授权无效**

> 🆕 recruit-mcp 已支持 WorkBuddy **一键弹窗连接**，**不再需要「招活 Token」**——连接只认太湖授权。优先引导用户走弹窗连接：

```
招聘 MCP（recruit-mcp）还没连上，连接很简单：
① WorkBuddy 弹出「是否连接 recruit-mcp（https://zhaopin.mcp.it.woa.com）」→ 点「连接」
② 按提示用太湖 SSO 授权即可（无需手填任何 Token）
没弹窗就去「连接器」→「自定义连接器」→ recruit-mcp → 点「连接」/「Trust」。
连好后告诉我「继续」。
```

仅当客户端不支持弹窗连接、需走 mcporter CLI 时，AI 执行（**只配太湖一个 header**）：
```bash
mcporter config add recruit-mcp \
  --scope home \
  --url "https://zhaopin.mcp.it.woa.com" \
  --header "Authorization=Bearer $TAI_IT_TOKEN"
```

> ⚠️ 不再需要 `recruit-Authorization` / 招活 Token；只保留太湖 `Authorization`（带 `Bearer ` 前缀）。

---

**Step 3：全部修复后，重跑预检确认**

```bash
python preflight_check.py --json
```

确认 JSON 输出 `"ok": true` 后，进入阶段1（条件6面试官权限将在首次搜索时自动验证）。

---

#### 🔴 关键约束

1. **条件 1→5 有依赖关系**：Node.js → mcporter → recruit-mcp 配置 → 太湖鉴权，必须按顺序修复
2. **只需太湖授权一项**：recruit-mcp 连接只认太湖 Token（`Authorization`）。🆕 旧版的「招活 Token / `recruit-Authorization`」已下线，不再需要——优先用 WorkBuddy 弹窗连接（太湖 SSO），手动配置也只配 `Authorization` 一个 header
3. **太湖授权优先走弹窗连接**；走 CLI 时太湖 Token 可用环境变量 `$TAI_IT_TOKEN` 自动展开
4. **配置只能用 `mcporter config add`**，绝对禁止用 `mcp_add`
5. **必须加 `--scope home`** 确保写入全局配置（`~/.mcporter/mcporter.json`），避免仅写入项目级配置
6. `Authorization` 值必须有 `Bearer ` 前缀
7. **面试官权限无法通过脚本自动检测**，仅在首次搜索返回 401 时才能发现。若搜索结果 `_meta.error` 为 `NO_INTERVIEWER_PERMISSION`，必须**立即停止搜索**并提示用户联系 HR 开通面试官权限

---

### 阶段1：解析需求 & 构建搜索策略

1. **分析用户需求**，识别涉及的筛选维度（岗位、学校、学历、技能等）
2. **拆解搜索策略**：
   - 判断哪些条件可以用结构化参数（`station`、`education`、`schoolLevel`、`school`、`specialityList`、`work_city` 等）
   - 判断哪些条件需要用 `keyword` 搜索（技术栈、项目经历等**没有专用筛选字段的内容**）
   - 🔴 **已有专用筛选字段的维度（学校、专业、学历、城市、院校等级等）禁止写入 keyword**，必须用对应结构化参数
   - 自行决定合适的 keyword（支持 `|` 做OR组合、`+` 做AND）
   - 🔴 **keyword 中 `+`（AND）最多 2 个**，即最多 3 个词的 AND 组合（如 `A+B+C`）。超过 3 个 AND 条件会导致搜索结果为 0，必须拆成多轮搜索
3. **读取相关 `filters/` 文档**：涉及哪个参数就读哪个文档，确认参数名、类型、枚举值
   - 如涉及岗位：读 `filters/position.md` + 查 `data/position-id-mapping.json` 获取岗位ID
   - 如涉及院校等级：读 `filters/school-level.md`
   - 其他条件参见 `guides/resume-filtering-manual.md` 中的筛选条件目录

### 阶段2：多轮搜索

**调用方式（macOS / Linux）**：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.post_v1_resume_search' \
  params='{"keyword":"xxx","graduate_time":[27],"startInterviewEnable":1,"pageNum":1,"pageSize":30}'
```

**调用方式（Windows — keyword 含 `|`）**：必须用 Python 脚本，详见 [跨平台兼容性](#-跨平台兼容性python-脚本方案) 章节。

---

#### 🔴 搜索条件分类规则（CRITICAL — 必须遵守）

将用户需求拆解为搜索条件时，**必须区分"硬性条件"和"可扩展条件"**：

**硬性条件（用户明确指定，禁止扩展）**：
用户明确指定的以下维度，必须**严格按用户原话设置**，不得自行扩展、放宽或添加相近选项：

| 维度 | 禁止扩展的示例 |
|------|-------------|
| **城市**（`work_city`） | 用户说"深圳" → 只筛深圳，❌ 不要加广州/上海 |
| **毕业时间**（`graduate_time_begin/end`） | 用户说"2027届" → 只筛2027，❌ 不要扩展到2026-2028 |
| **学历**（`education`） | 用户说"硕士" → 只筛硕士，❌ 不要加博士 |
| **学校/院校等级**（`school`/`schoolLevel`） | 用户说"985" → 只筛985，❌ 不要加211 |
| **专业**（`specialityList`） | 用户说"计算机" → 筛计算机相关专业，❌ 不要加电子工程 |
| **岗位**（`station`） | 用户指定了岗位 → 严格使用，❌ 不要加相近岗位 |

> 这些维度有专用结构化参数，是精确的强过滤。用户指定了就代表这是必要条件，扩展会引入不符合要求的候选人。

**可扩展条件（鼓励在多轮中扩展同义词）**：
以下维度**鼓励在后续轮次中扩展**同义词、相近技能、相关产品名，以扩大候选集：

| 维度 | 扩展方式 | 示例 |
|------|---------|------|
| **技能/技术栈** | 同义词、缩写、英文 | "推荐系统" → `推荐系统\|推荐算法\|召回\|排序\|CTR\|CVR` |
| **核心经验/业务领域** | 相近领域、产品名 | "大模型" → `大模型\|LLM\|GPT\|Transformer\|BERT\|RLHF` |
| **项目/工具名** | 相关工具、框架 | "深度学习" → `深度学习\|PyTorch\|TensorFlow\|神经网络` |
| **实习公司** | 中英文名、常见缩写 | "字节" → `字节跳动\|ByteDance\|字节` |

---

#### 🔴 多轮搜索策略（CRITICAL — 必须遵守）

**搜索策略**：
- **第1轮**：用最直接的条件组合搜索（硬性条件 + 核心关键词）
- **后续轮次**：**保持硬性条件不变**，对可扩展条件（技能、经验）扩展同义词/相近技能/相关产品名，用 OR（`|`）组合扩大候选集
- 每轮取前1-2页，所有轮次结果用 `rid` 全局去重

**多轮扩展示例**：
```
用户需求："找有推荐系统经验的985硕士，深圳"

第1轮：keyword="推荐系统", schoolLevel=["985"], education=[3], work_city=[1]
  → 结果15条

第2轮：keyword="推荐系统|推荐算法|召回|排序|CTR|CVR|协同过滤", 其余硬性条件不变
  → 结果42条，去重后新增30条

第3轮：keyword="搜索推荐|信息检索|个性化推荐|广告算法", 其余硬性条件不变
  → 结果28条，去重后新增18条
```

> 注意：每轮都是**硬性条件（985、硕士、深圳总部）保持不变**，只有 keyword 在扩展。

**默认条件**（用户未指定时必须带上）：
- 毕业时间 2027：`graduate_time_begin: "2027-01-01"`, `graduate_time_end: "2027-12-31"`
- 可发起面试：`startInterviewEnable: 1`

---

#### ⏰ 跨天去重（仅定时任务上下文执行 · 交互式搜索跳过）

> 🔴 **触发条件**：当且仅当本次搜索是**定时任务**（automation）在跑「每日校招简历搜索推送」时执行本步。
> **用户在对话里手动搜简历时，绝不执行本步**——交互式搜索每次都要看全量候选。

**问题**：定时任务每天同样条件搜，候选池高度重叠，导致「每天推的简历几乎一样」。多轮 rid 去重只解决单次任务内重复，不跨天。本步在推送前做「已推名单差集」，只推新增。

**怎么做**：把多轮搜索 + rid 全局去重后的候选写成一个 JSONL（每行一条，含 `rid` 字段），落到临时文件，然后运行差集脚本：

```bash
cd {workspace} && python3 {skillDir}/scripts/dedup_pushed.py \
    --task-key campus-daily-<本任务稳定别名> \
    --input candidates.jsonl \
    --output new_candidates.jsonl
```

- `--task-key`：每个定时任务一个稳定唯一 key（按任务隔离，与社招任务用**不同** key，如 `campus-daily-system-planning-intern`）。同一任务每天用同一 key。
- 默认 **30 天滚动窗口**（30 天内推过的不再推，超期自动复推）。
- 后续粗读筛选改用 `new_candidates.jsonl`。

**读脚本 stdout 的 `new_count`** 分支处理：

| `new_count` | 处理 |
|---|---|
| `> 0` | 用 `new_candidates.jsonl` 继续粗读，推送时说明「今日新增 N 人（已过滤近 30 天推过的 M 人）」 |
| `== 0` | **明确推「今日无新增」**（近 30 天已推 M 人均覆盖），不要静默——让用户能区分「真没新人」和「任务 missed」 |

> ⚠️ 历史名单存 `~/.workbuddy/skills/txzhaopin-pushed-history/<task-key>.json`（用户级、跨 workspace 共享）。写名单失败只告警不阻断。

---

#### 🔴 搜索结果错误处理（CRITICAL — 必须遵守）

每次搜索返回后，**必须先检查 `_meta` 中的错误字段**，再进行后续处理：

```python
import json
with open("result.jsonl") as f:
    meta = json.loads(f.readline())

# 检查面试官权限错误
if meta.get("_meta", {}).get("error") == "NO_INTERVIEWER_PERMISSION":
    # 🔴 立即停止所有搜索！不要重试！
    # 向用户展示错误详情并提示联系 HR
    print(meta["_meta"]["error_detail"])
```

| `_meta.error` | 含义 | 处理方式 |
|---|---|---|
| `NO_INTERVIEWER_PERMISSION` | 当前账号无面试官权限（招聘平台返回 401） | **立即停止搜索**，提示用户联系 HR 开通面试官权限 |
| _(无 error 字段)_ | 正常返回 | 继续正常流程 |

> ⚠️ **面试官权限错误与 Token 鉴权错误不同**：
> - Token 鉴权错误（太湖 Token 过期）：预检阶段即可发现（HTTP 401），可通过 tai-oauth 自动修复
> - 面试官权限错误：Token 有效但账号无面试官角色，预检**无法**检测到，只有在实际调用搜索 API 时才会暴露（外层 HTTP 200，内层 `data.status: 401`）

---

### 阶段3：粗读筛选

---

#### 🔴 粗读前必须执行：字段提取流程（CRITICAL）

**搜索接口每条简历返回 67 个字段，直接输出完整 JSON 将严重浪费上下文。必须按以下步骤执行**：

1. **先阅读 `interfaces/search-campus-resume.md` 中的"完整字段清单 & 推荐等级"**
2. **根据当前筛选需求，自行选择一个推荐场景**（A/B/C）或自定义字段组合
3. **将 mcporter 返回结果存入临时文件，用脚本只提取选定字段**，将精简结果输出到对话上下文

> 无需向用户确认字段列表，AI 自行判断即可。但必须确保粗读输出只包含必要字段。

**⚠️ 严禁行为**：
- ❌ 直接将 mcporter 返回的完整 JSON 输出到对话上下文
- ❌ 不做字段筛选就开始评估候选人
- ❌ 把 `tagList`（数字数组）、`lockBg`、`id`、`photo` 等无用字段带入上下文

**✅ 正确做法**：
```
1. 根据筛选需求，从字段清单中确定本次需要的字段
2. 调用搜索 API 获取数据 → 存入临时文件
3. 用脚本从文件中只提取选定字段 → 格式化为精简文本
4. 只将精简文本输出到对话上下文，用于粗读评估
5. 多轮搜索时用 rid 全局去重
```

---

对候选池中所有候选人，基于提取后的精简摘要信息快速评估：
- 学校、专业、学历、成绩排名
- 亮点标签（竞赛、实习、项目关键词）
- 投递岗位（`stationTxt`）

根据匹配度分为：
- **A档**（强匹配）：核心条件高度对口 → 必须精读
- **B档**（可能匹配）：部分对口，需看详情 → 按优先级精读
- **C档**（不匹配）：跳过

### 阶段4：精读验证

从粗读 A/B 档中选人精读，**数量不限**，看到足够多合适的简历为止。

**调用方式**：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId' \
  params='{"rid":"${rid}"}'
```

---

#### 🔴 精读前必须执行：字段确定流程（CRITICAL）

**精读接口返回 125 个字段，直接输出完整返回将严重浪费上下文。必须按以下步骤执行**：

1. **先阅读 `interfaces/get-resume-by-rid.md` 中的"完整字段清单 & 推荐等级"**
2. **根据当前筛选需求，自行选择一个推荐场景**（A/B/C）或自定义字段组合
3. **在精读脚本中只提取选定字段**，将精简结果输出到对话上下文

> 无需向用户确认字段列表，AI 自行判断即可。但必须确保精读输出只包含必要字段。

**🔴 精读效率优化（减少精读耗时）**：
- **优先使用场景 B（快速初筛）**，只有粗读无法判断时才用场景 A
- **长文本字段严格截取**：`work_summary` / `proj_summary` 截取前 **150 字**（不是 200 字）
- **实习/项目经历只提取最近 2 段**，更早的经历跳过
- **教育经历只提取最高学历**，本科信息仅在需要校验学校时提取

**🔴 精读分批策略（防止触发频繁访问限制）**：
- **每批最多 10 条**：单批精读数量不得超过 10 条
- **批间间隔**：如果需要精读的简历超过 10 条，分批执行，**批与批之间间隔 3-5 秒**（用 `sleep` / `timeout` 等待）
- **批内间隔**：同一批内每条请求间隔 300ms（已有规则）
- **推荐分批方式**：先精读 A 档（最多 10 条），等待间隔后再精读 B 档，B 档视 A 档结果数量决定是否继续

**⚠️ 严禁行为**：
- ❌ 直接将 mcporter 返回的完整 JSON 作为精读结果展示
- ❌ 不确定字段就开始批量精读（必须先选好字段再写提取脚本）
- ❌ 在上下文中保留 `work_summary`/`proj_summary` 完整长文本

**✅ 正确做法**：
```
1. 根据筛选需求，从字段清单中确定本次需要的字段
2. 调用精读 API 获取数据 → 存入临时文件
3. 用脚本从文件中只提取选定字段 → 格式化为精简文本
4. 只将精简文本输出到对话上下文
```

---

**⚠️ 精读接口注意事项**：
- 返回数据路径：`response.data.data.data.resumeInfo`（三层 `data`）
- `resumeInfo.school`/`education` 常为 `null`，改用 `highest_school`/`highest_education` 或从 `education_list` 获取
- 精读接口的 `resumeInfo.name` 可能为 `*****`，此时应使用搜索接口返回的姓名（搜索接口的 `name` 字段始终有值），以 `rid` 关联两者
- 批量获取时每条间隔 300ms，**每批最多 10 条，超过则分批并间隔 3-5 秒**，做好错误处理（404 跳过）

### 阶段5：输出推荐报告

**目标**：约 **10 份**推荐简历。如果完全匹配的不足 10 份，说明情况后推荐一些接近匹配的，总数凑够约 10 份。

**输出格式**（Markdown 表格，直接在对话中展示，禁止生成文件）：

| 序号 | 姓名 | 学校 | 学历 | 专业 | 投递岗位 | 推荐理由 | 简历链接 |
|------|------|------|------|------|----------|----------|----------|
| 1 | 张三 | 清华大学 | 硕士 | 计算机 | NLP方向 | 顶会论文2篇，腾讯AI Lab实习6月 | [查看简历](https://zhaopin.woa.com/resume/campus/ResumeDetail?rid=xxx) |

**简历链接格式**（唯一正确格式）：
```
https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={完整UUID}
```
> `rid` 必须是完整 UUID（如 `f012efe2-81f2-4a1f-bb95-811c1354d5ec`），不要截断，不要用数字 `id` 替代

**推荐理由**：简明扼要，突出 2-3 个匹配亮点，基于精读验证的实际简历内容。

**附加输出**：搜索质量评估

```markdown
## 📊 搜索质量评估

| 轮次 | 策略 | 结果数 | 去重后新增 |
|------|------|--------|-----------| 
| 第1轮 | xxx | X条 | Y条 |
| 第2轮 | xxx | X条 | Y条 |

**筛选漏斗**：候选池 N人 → 粗读通过 M人 → 精读 K人 → 最终推荐 L人
```

---

### 阶段6：简历操作（收藏 & 锁定）

筛选完成后，可对感兴趣的候选人执行收藏或锁定操作。

#### 收藏简历

将简历加入当前登录用户的收藏列表，方便后续快速查看。收藏操作是**幂等**的（重复收藏同一简历不会报错）。

**调用方式**：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_favorite_addResume' \
  params='{"resumeId": ${resumeId}}'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `resumeId` | number | ✅ | 简历数字 ID（搜索接口返回的 `id` 字段，**不是** `rid`） |

**返回示例**：
```json
{"message": "", "status": 0, "data": {"favorite": 1}}
```
- `favorite: 1` 表示收藏成功
- `status: 0` 表示请求成功

> ⚠️ **注意**：`resumeId` 是搜索结果中每条简历的 `id`（数字），不要与 `rid`（UUID 字符串）混淆。

#### 锁定简历

将简历锁定给当前登录用户。锁定后该简历进入"已锁定"状态，其他面试官暂时无法操作。`staffId` 和 `bgId` 由系统自动取当前登录用户信息。

> 🔴 **锁定是较重的操作**：锁定会改变简历的流程状态，影响其他面试官的操作。请确认确实需要锁定再执行。

**调用方式**：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.post_v1_resumeRecommend_lockCampusResume' \
  params='{"rid": "${rid}"}'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `rid` | string | ✅ | 简历 RID（UUID 格式，如 `f012efe2-81f2-4a1f-bb95-811c1354d5ec`） |

**返回示例**：
```json
{"message": "", "status": 0, "data": "锁定成功"}
```

> ⚠️ **收藏 vs 锁定**：
> - **收藏**：轻量操作，仅标记到个人收藏列表，不影响简历状态和其他用户操作
> - **锁定**：重操作，会将简历流程状态改为"已锁定"，绑定到当前用户/BG，其他面试官暂时无法操作该简历

**详细文档**：`interfaces/favorite-resume.md`

---

## ⚡ mcporter 环境配置（参考）

> 🔴 **正常情况下不需要手动阅读本章节**。「阶段0：环境预检与自动修复」已覆盖全部配置流程。
> 本章节仅作为手动排查的参考。

> 🔴 配置 recruit-mcp **只能用 `mcporter config add`**，**绝对禁止用 `mcp_add`**。详见上方「禁止使用 mcp_add」章节。

### 鉴权说明（🆕 只需太湖一项）

> recruit-mcp 已支持 WorkBuddy **弹窗连接**（太湖 SSO 授权，无需手填）。下面 CLI 配置仅在客户端不支持弹窗、需手动走 mcporter 时参考。

| Token | Header 名 | 获取方式 | 自动化 |
|-------|-----------|----------|--------|
| 太湖 Token | `Authorization` (需 `Bearer ` 前缀) | 弹窗连接走太湖 SSO；或 tai-oauth 自动获取；或手动访问 https://tai.it.woa.com/user/pat | ✅ 可自动 |

> 🆕 **旧版「招活 MCP Token / `recruit-Authorization`」已下线**，连接不再需要它。若旧配置里有这行，删掉即可。

### 完整配置命令（手动 CLI · 只配太湖一个 header）

```bash
mcporter config add recruit-mcp \
  --scope home \
  --url "https://zhaopin.mcp.it.woa.com" \
  --header "Authorization=Bearer $TAI_IT_TOKEN"
```

> - `--scope home`：写入全局配置（`~/.mcporter/mcporter.json`），确保跨项目可用
> - `$TAI_IT_TOKEN`：shell 自动展开环境变量，无需手动抄写太湖 Token
> - ⚠️ 命令是 `mcporter config add`（不是 `mcporter add`）

### 验证

运行预检脚本验证全部配置：
```bash
python {skillDir}/scripts/preflight_check.py
```

或手动验证：
```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' \
  params='{"tagType":"major"}'
```

返回正常数据即全部配置成功。

---

## 🔍 搜索参数速查表

> **使用任何参数前，必须先完整阅读其对应的 `filters/` 文档！** 表中示例仅供快速理解。

### 核心筛选参数

| 参数名 | 类型 | 说明 | 文档 |
|--------|------|------|------|
| `keyword` | string | 全文模糊搜索（支持 `\|` OR、`+` AND、`""` 精确） | `filters/keyword-search.md` |
| `station` | number[] | 岗位ID数组 | `filters/position.md` |
| `category_id` | number | 岗位大类ID | `filters/position.md` |
| `education` | number[] | 学历：1=大专,2=本科,3=硕士,4=博士 | `filters/education.md` |
| `school` | string[] | 院校名称数组（严格过滤，按最高学历匹配） | `filters/school-name.md` |
| `schoolLevel` | string[] | 院校等级：`"985"`,`"211"`,`"C9"`,`"QS100"` 等 | `filters/school-level.md` |
| `major` | number[] | 专业ID数组 | `filters/major.md` |
| `graduate_time_begin/end` | string | 毕业时间范围 `"YYYY-MM-DD"` | `filters/graduate-time.md` |
| `schoolRank` | number | 成绩排名：1=前5%,2=前10%,3=前20% | `filters/grade-rank.md` |
| `award` | string[] | 竞赛获奖 | `filters/competition-award.md` |
| `internship_company` | string | 实习公司关键词 | `filters/internship-company.md` |
| `play_game_categories` | string[] | 玩过的游戏品类（名称字符串数组） | `interfaces/get-play-game-categories.md` |

### 状态 & 分页

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `startInterviewEnable` | number | 可发起面试：1=是 |
| `flow_status` | number | 流程状态码 |
| `pageNum` | number | 页码（从1开始） |
| `pageSize` | number | 每页数量（默认20，最大30） |

---

## ⚠️ 关键注意事项

1. **`school` 参数是严格过滤**：按最高学历的学校匹配。注意搜索结果展示的是最高学历信息，点开详情后可能看到本科是目标学校但硕士不是的情况——这不是过滤失效，而是展示维度不同
2. **`station` 参数可能不严格**：大量 station ID 时需客户端二次校验
3. **分页存在大量重复**（重复率可达 60%+）：必须用 `rid` 去重
4. **关键词匹配 ≠ 真实经历**：简历提到某关键词不代表有实际经验，需精读验证
5. **禁止生成文件**：只在对话中用 Markdown 表格展示结果

---

## 🔧 跨平台兼容性：Python 脚本方案

### 问题说明

在 Windows 上通过 `subprocess` / `execute_command` 调用 mcporter 时，存在**两个**独立的问题：

#### 问题 1：管道符 `|` 被 cmd.exe 截断

`keyword` 使用 `|` 做 OR 组合（如 `后台开发|后端开发|服务端`）时，**无论如何嵌套引号或转义，`cmd.exe` 都会将 `|` 解释为管道符**，导致命令被截断。

以下方式**在 Windows 上均无效**：
- ❌ `^|` 转义
- ❌ `cmd /V:ON` 延迟变量展开
- ❌ `python -c "..."` 或 `node -e "..."` 内联脚本（最外层仍经过 cmd.exe 解析）
- ❌ `subprocess.run(shell=False)` 内联调用（execute_command 工具本身通过 cmd.exe 执行）
- ❌ 调用 `mcporter.cmd`（.cmd 内部 `%*` 展开仍经过 cmd 解析，`|` 被截断）

#### 问题 2：subprocess 找不到 Project config → "Unknown MCP server"

mcporter 的配置分两层：
```
System config : ~/.mcporter/mcporter.json         ← 全局，所有目录可见
Project config: <cwd>/config/mcporter.json         ← 仅当 cwd 在 Workspace 根目录时可见
```

`recruit-mcp` 通常配置在 **Project config**（`<Workspace>/config/mcporter.json`）中。
当 Python 脚本通过 `subprocess` 调用 mcporter 时，如果 `cwd` 不在 Workspace 根目录，
mcporter 只能读到 System config，里面没有 `recruit-mcp`，于是报 **"Unknown MCP server 'recruit-mcp'"**。

> 💡 **验证**：运行 `mcporter config doctor` 可以看到当前 cwd 下 mcporter 实际加载的两个配置文件路径。

### 🔴 推荐方案：Python 脚本 + 参数文件 + cwd 同步（跨平台通用）

**核心原理**：
1. 先通过 `execute_command` 获取 mcporter 路径（`where mcporter` / `which mcporter`）
2. 将含 `|` 的搜索参数写入 JSON 文件（避免命令行传参被截断）
3. Python 脚本读取参数文件，通过 `subprocess.run(shell=False)` 调用 mcporter
4. Windows 上自动从 mcporter 路径推算 `node.exe` + `cli.js` 路径，绕过 `.cmd` shim
5. **🔴 `subprocess.run()` 的 `cwd` 设为 Workspace 根目录**，确保 mcporter 能加载 Project config
6. 结果输出到文件（避免 Windows 终端编码问题），再用 `read_file` 读取

> ⚠️ **技能自带现成脚本** `scripts/mcporter_call.py`，可直接复制到临时目录使用，无需手动创建。

#### 步骤 1：获取 mcporter 路径

```bash
# Windows
where mcporter
# macOS / Linux
which mcporter
```

取返回的第一个路径（Windows 上通常是 `.cmd` 路径）。

#### 步骤 2：写入参数文件

将搜索参数写入临时目录的 `params.json`：

```json
{
  "keyword": "后台开发|后端开发|服务端|backend",
  "schoolLevel": ["985"],
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1,
  "pageNum": 1,
  "pageSize": 30
}
```

#### 步骤 3：复制 Python 脚本

**推荐**：将技能目录下的 `scripts/mcporter_call.py` 复制到会话临时目录直接使用。

> 脚本源码见 `scripts/mcporter_call.py`，无需手动创建。

#### 步骤 4：执行调用

```cmd
python mcporter_call.py "<mcporter_path>" "recruit-mcp" "CallAPI" "recruit.campus-resume-search.post_v1_resume_search" "params.json" "result.jsonl"
```

然后读取 `result.jsonl` 获取结果（JSONL 格式，每行一条简历）。

#### 步骤 5：读取结果

搜索接口的结果以 **JSONL 格式**（每行一个 JSON）写入输出文件，避免大 JSON 被截断：
- **第 1 行**：元数据 `{"_meta": {"total": N, "status": 200, "message": ""}}`
- **后续每行**：一条简历的完整 JSON

读取示例：
```python
import json
with open("result.jsonl") as f:
    lines = f.readlines()
meta = json.loads(lines[0])
resumes = [json.loads(line) for line in lines[1:] if line.strip()]
```

> 精读接口（非搜索接口）仍原样输出 JSON。

### ⚠️ 注意事项

1. **何时需要用 Python 脚本**：
   - keyword 含 `|`（OR 组合）→ **必须用** Python 脚本
   - keyword 不含 `|`（如纯文字 `推荐系统`）→ 可直接 `execute_command` 调 `mcporter`
   - 精读接口（params 只有 `rid`，不含 `|`）→ 可直接 `execute_command`

2. **mcporter 路径只需获取一次**：会话开始时通过 `where` / `which` 获取，后续所有调用复用

3. **Python 脚本只需创建一次**：从 `scripts/mcporter_call.py` 复制到临时目录后，整个会话中所有调用均可复用，只需更换参数文件

4. **参数文件每次调用需更新**：每次搜索条件变化时，重新写入 `params.json`（或使用不同文件名）

5. **结果输出到文件**：避免 Windows 终端 GBK 编码导致中文乱码；macOS / Linux 上同样推荐此方式以保持流程一致

6. **macOS / Linux 上也可以直接用 `execute_command`**：如果不需要统一流程，macOS/Linux 上 keyword 含 `|` 不会出问题，可直接用 shell 命令

7. **🔴 "Unknown MCP server" 排查**：如果脚本报此错误，检查以下两项：
   - 运行 `mcporter config doctor` 确认 Project config 路径是否正确
   - 确认 `cwd` 指向包含 `config/mcporter.json` 的 Workspace 根目录

### 判断当前平台

在工作流开始时，可通过以下方式判断是否需要使用 Python 脚本：

```
- keyword 含 `|` → 使用 Python 脚本方案（Windows 必须，macOS/Linux 推荐）
- keyword 不含 `|` → 任何平台均可直接 execute_command
```

---

## 📂 目录结构

```
zhaopin-operations/
├── SKILL.md                    # 本文件
├── scripts/
│   ├── preflight_check.py         # 🔴 环境预检脚本（直接运行，无需阅读源码）
│   └── mcporter_call.py            # 🔴 mcporter 调用封装脚本（跨平台通用，JSONL 输出，含 cwd 修复）
├── guides/
│   └── resume-filtering-manual.md  # 筛选条件目录 & 完整参数参考
├── filters/                    # 各筛选条件的详细文档（22个）
├── interfaces/                 # API 接口文档
│   ├── search-campus-resume.md     # 搜索接口（含粗读字段清单）
│   ├── get-resume-by-rid.md        # 精读接口（含精读字段清单）
│   ├── favorite-resume.md          # 收藏 & 锁定接口
│   ├── subscribe-resume.md         # 订阅接口（校招）
│   ├── search-school.md
│   ├── search-major.md
│   └── ...
└── data/                       # 静态数据文件
    ├── position-id-mapping.json    # 岗位ID映射（551节点）
    └── ...
```

---

## ⚠️ Known Issues & Solutions

### Issue 1: subprocess 调用 mcporter 报 "Unknown MCP server 'recruit-mcp'"

**Error:** 通过 Python `subprocess` 调用 mcporter 时报 `Unknown MCP server 'recruit-mcp'`，但直接在终端执行 `mcporter list` 能看到该服务。

**Root Cause:** mcporter 的配置分两层——System config（`~/.mcporter/mcporter.json`）和 Project config（`<cwd>/config/mcporter.json`）。`recruit-mcp` 配置在 Project config 中，而 subprocess 的 cwd 不在 Workspace 根目录，导致 mcporter 只加载了 System config。

**Solution:** 在 `subprocess.run()` 中设置 `cwd` 为包含 `config/mcporter.json` 的 Workspace 根目录。使用技能自带的 `scripts/mcporter_call.py` 已内置此修复（自动从 cwd 向上查找包含 `config/mcporter.json` 的祖先目录）。

### Issue 2: keyword 含 `|` 在 Windows 上命令被截断

**Error:** 使用 `execute_command` 或 `subprocess.run(shell=True)` 传递含 `|` 的 keyword 时，cmd.exe 将 `|` 解释为管道符，导致命令被截断。

**Solution:** 将参数写入 JSON 文件，通过 Python 脚本以 `subprocess.run(shell=False)` 方式调用 mcporter，绕过 cmd.exe 解析。使用技能自带的 `scripts/mcporter_call.py`。
��的 `scripts/mcporter_call.py`。
orter_call.py`。
olutions

### Issue 1: subprocess 调用 mcporter 报 "Unknown MCP server 'recruit-mcp'"

**Error:** 通过 Python `subprocess` 调用 mcporter 时报 `Unknown MCP server 'recruit-mcp'`，但直接在终端执行 `mcporter list` 能看到该服务。

**Root Cause:** mcporter 的配置分两层——System config（`~/.mcporter/mcporter.json`）和 Project config（`<cwd>/config/mcporter.json`）。`recruit-mcp` 配置在 Project config 中，而 subprocess 的 cwd 不在 Workspace 根目录，导致 mcporter 只加载了 System config。

**Solution:** 在 `subprocess.run()` 中设置 `cwd` 为包含 `config/mcporter.json` 的 Workspace 根目录。使用技能自带的 `scripts/mcporter_call.py` 已内置此修复（自动从 cwd 向上查找包含 `config/mcporter.json` 的祖先目录）。

### Issue 2: keyword 含 `|` 在 Windows 上命令被截断

**Error:** 使用 `execute_command` 或 `subprocess.run(shell=True)` 传递含 `|` 的 keyword 时，cmd.exe 将 `|` 解释为管道符，导致命令被截断。

**Solution:** 将参数写入 JSON 文件，通过 Python 脚本以 `subprocess.run(shell=False)` 方式调用 mcporter，绕过 cmd.exe 解析。使用技能自带的 `scripts/mcporter_call.py`。
��的 `scripts/mcporter_call.py`。
