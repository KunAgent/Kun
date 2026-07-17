# 故障排查（Troubleshooting）v6.0.1

## 0. 字段名踩坑记录（实测确认 2026-04-21）

> ⚠️ 这是最常见的坑：接口文档描述的字段名和实际返回不一致。

### 搜索接口返回字段

| 文档/预期 | 实际返回 | 说明 |
|---|---|---|
| `Rid` | `rid` | **全小写**，UUID 格式 |
| `Name` | `name` | 小写驼峰 |
| `WorkPlace` | `workPlace` | 小写驼峰（可能含 `<span>` HTML 高亮标签） |
| `TotalNum` | `totalCount` | 搜索总命中数 |
| `OtherHighlight` | `highLightOthers` | 搜索高亮，**对象数组**（含 shortContent/allContent），非字符串数组 |
| `Status` | `status` | 小写 |
| `Locked` | `locked` | 小写 |

### 详情接口返回字段

| 文档/预期 | 实际返回 | 说明 |
|---|---|---|
| `data.resume` | `{ resume, flowList, contactRecords }` | 三个并列顶层 key |
| `resume.rid` | `resume.RID` | **大写**（唯独 RID 是大写） |
| `resumeEducation` | `resumeEdu` | 教育经历 |
| `resumeProjectExp` | `resumeProject` | 项目经历 |
| 技能标签（对象数组） | `resumeTagSkills`（**字符串数组**） | 直接是 `["Python","Go",...]` |
| `resumeFlows` | `flowList`（顶层 key） | 不在 resume 子对象里 |
| `resumeContacts` | `contactRecords`（顶层 key） | 不在 resume 子对象里 |

### 应对方式

- 搜索阶段：`mcp_client.slim_search_result()` 已统一输出**小写驼峰**，与接口原始字段一致
- 精读阶段：`mcp_client.slim_detail()`（在 `deep_read.py` 中调用）按白名单过滤后输出
- 修改字段映射时务必同步 `interfaces/search-social-resume.md` 和 `interfaces/getresume-with-detail.md`

---

## 1. 环境类错误

### `Unknown MCP server 'recruit-mcp'`

**原因**：recruit-mcp 未注册到 CodeBuddy MCP 配置或 mcporter 找不到。

**排查**：
1. 确认 CodeBuddy 的 MCP server 列表里有 recruit-mcp
2. 确认 `~/.workbuddy/mcp.json` 存在且包含 `recruit-mcp` 配置（含 `Authorization` 一个 header 即可；🆕 不再需要 `recruit-Authorization`）。或直接在 WorkBuddy 弹窗 / 连接器里点「连接」走太湖授权

### `mcp_client.py` 找不到 Token

**现象**：脚本启动时 stderr 打印 `ERROR: 未找到 MCP Token！`

**Token 三级回退路径（`mcp_client.get_mcp_credentials()`）**：
1. 环境变量 `MCP_AUTH` + `MCP_RECRUIT_AUTH`
2. IDE 配置自动发现（依次尝试 `~/.workbuddy/mcp.json` / `.codebuddy/mcp.json` / `.mcp.json` / `/data/workspace/config/mcporter.json`）
3. `scripts/.env` 文件

**修复**：保证以上三种来源至少一种可用。

### `401 / 鉴权失败`

**太湖授权失效**（401）：在 WorkBuddy 重新点「连接」recruit-mcp 走太湖 SSO 即可；或走 CLI：
```bash
use_skill tai-oauth
python tai_oauth.py --name recruit-mcp --url "https://zhaopin.mcp.it.woa.com"
```

> 🆕 不再有「招活 Token 失效」这种情况——连接已只认太湖授权，旧版的第二个 token 已下线。

---

## 2. 搜索阶段错误

### 模型忘传 `--params`

**现象**：脚本立即报错 `error: the following arguments are required: --params`

**修复**：v6.0.1 起 `--params` 必传，先生成 `search_params.json` 落盘到当前 workspace，再执行。

### `search_params.json` 错误

| 现象 | 原因 | 修复 |
|---|---|---|
| `ERROR: --params 文件不存在` | 路径错或没落盘 | 检查 cwd 与 `--params` 路径，参考 `references/step2-search-templates.md` 重建 |
| `ERROR: --params 文件中 routes 为空` | routes 数组为空 | 至少 1 路；推荐 2-5 路差异化 searchKey |

### 所有路检索全部失败

**现象**：`social_search.py` 运行后每路都返回错误，stdout 输出 `{"status":"error", ...}` 退出码 1。

**排查**：
1. 看脚本 stderr 输出的具体错误信息
2. 确认 `mcp_client.py` 能找到 Token（运行脚本时应打印 `[token] 从 ... 自动获取到 recruit-mcp Token`）
3. 确认字段命名是驼峰（`searchKey` 不是 `search_key`）
4. 确认 `searchKey` 是**字符串**不是数组（社招接口）
5. 确认 `allCompany` 是**数组** `["网易","米哈游"]`，不是逗号字符串

### 搜索返回数据但去重后为 0

**原因**：取 rid 字段名错误。社招搜索返回 `rid`（小写），不是 `Rid`。

**修复**：`social_search.py` 的 `dedup_by_rid()` 已做大小写兼容。如自定义改造，确认同时检查 `rid` 和 `Rid`。

### 候选池 < 20（召回过少）

- **原因 1**：硬约束太严（如"5-8 年 + 深圳 + 硕士 + 985 + 字节"）→ 提示用户放宽
- **原因 2**：`searchKey` 用 AND 且词数过多 → AND 最多 2 词，超过时改用 OR
- **原因 3**：位置字段写错 → 社招搜索用 `location`（不是 `workCity` 或 `WorkPlace`）

### AND 0 结果

核心词本身不在社招简历库里命中。建议：
- 检查词的表达是否符合业内惯用（如"ChatGPT 开发"不如"大模型/LLM"）
- 改为 OR，或用 `data/domain-synonyms.json` 查同义词

---

## 3. 粗筛阶段错误

### 所有候选都被 excluded

**现象**：`stats.tier_A_count + tier_B_count + tier_C_count = 0`

**排查**：看 stderr 日志的 excluded 原因，通常是某个硬约束写错：
- "学校层次不符" + `schoolLevels=["985","211"]` → 确认画像里是否漏了"一本"等
- "工作年限" → 确认 min/max 是 int，单位是年

### 打分偏低（A 档 0 人）

v6.0 用纯高亮计数（A 档阈值 = 3 条高亮），如果搜索结果的 `highLightOthers` 普遍为空，说明 searchKey 选词和实际简历内容不匹配。建议调整 searchKey 关键词。

---

## 4. 精读阶段错误（v6.0 deep_read.py）

### `deep_read.py` 的 errors 字段非空（部分 rid 失败）

**现象**：脚本输出 `{"results":[...], "errors":[{"rid":"...","error":"..."}], "batch_info":{...}}`，errors 数组非空。

**常见原因**：ATS 权限在搜索后可能有变化；个别 rid 在精读时返回 404 / 无权限。

**处理**：
- Agent 跳过失败的 rid，按 `batch_info.next_offset` 继续下一批
- 在最终输出中可备注"跳过 N 份无权限简历"

### 模型未声明累计合格数 → 循环不停

**现象**：精读跑完所有 30 份，没有早停。

**原因**：模型每批输出末尾未显式声明 `本批合格 X 份 / 累计合格 Y / 10`，agent 无法判断是否达标。

**修复**：在精读 prompt 里强制要求模型每批末尾输出累计行（参考 `references/step5-deep-read-schema.md` 的输出模板）。

### 字段过滤后字段为空

**现象**：`results[i]` 中的 `workExp` / `projects` / `skills` 等字段为空。

**排查**：
- 用 `mcp_client.py` 单独查原始返回结构，确认字段名是否变化
- 对比 `interfaces/getresume-with-detail.md` 字段对照表
- 检查 `deep_read.slim_detail()` 的字段映射是否需要更新

### 精读格式偏离模板

只重跑该批（单批粒度），参照 `references/step5-deep-read-schema.md` 的输出模板要求。

---

## 5. 通用排查清单

| 症状 | 第一步排查 |
|---|---|
| Token 找不到 | 确认 `~/.workbuddy/mcp.json` 存在且包含 `recruit-mcp` 配置 |
| 模型忘传 --params | argparse 立即报错；检查脚本调用命令 |
| search_params.json 报错 | 检查文件存在 + routes 不为空 + JSON 合法 |
| 搜索 0 结果 | 确认字段名是驼峰 / searchKey 是字符串 |
| 搜索返回但去重为 0 | 确认取 rid 用小写（`rid` 非 `Rid`） |
| 候选池 < 20 | 放宽硬约束或换 searchKey 词 |
| 粗筛全过滤 | 看 excluded reasons（stderr 日志） |
| 精读拉取部分失败 | 看 deep_read.py 输出的 `errors` 字段，跳过继续 |
| 精读循环不停 | 检查模型是否每批末尾输出"累计合格 Y / 10" |
| A 档 0 人 | searchKey 关键词与简历内容不匹配，调词 |
| 裁剪后字段为空 | 用 `mcp_client.py` 单独查原始返回结构 |
