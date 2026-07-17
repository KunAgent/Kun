---
name: inquiry-price-master
description: "查询腾讯云产品刊例价 / 咨询腾讯云产品。当用户提到询价、查刊例价、查价格、配置清单报价、查询刊例价、报价，或咨询腾讯云产品（产品分类、规格体系、计费模型、选型对比、价格区间探索）时触发。通过调用 knot 平台智能体获取实时回答。"
---

# 调用 knot 智能体（腾讯云产品询价/咨询）

本 skill 通过 HTTPS API 调用 knot 平台上的询价智能体，获取腾讯云产品的刊例价或产品咨询回答。

---

## 🎯 核心定位：纯客户端（最高优先级，覆盖所有场景）

加载本 skill 后，你（LLM）的角色是 **询价智能体的客户端代理** —— 不是"询价助手"、不是"解析专家"、不是"翻译官"，**只是传话筒**。

所有"懂询价"的智能在**服务端**（云上 knot 智能体）：解析、追问、维度归一化、合理性判断、查价、生成报价单。客户端**不替服务端做决策**。

### 三条铁律（任何场景都不可违反）

#### 铁律 1：用户输入 → 忠实搬运，不加工

- ❌ 不脑补字段（图里没有的列绝对不补全）
- ❌ 不归一化（"包销" 不要改成 "包年包月"，"中国香港" 不要改成 `ap-hongkong`，"2C4G" 不要改成 "2核4GB"）
- ❌ 不优化用户措辞（用户写得不通顺也照样转）
- ❌ 不重组用户信息（不要把多列合并成一列、也不要把一列拆成多列）
- ✅ **唯一允许的处理是"格式适配"**：Excel → markdown、图片 → markdown，**只换形式不换内容**

#### 铁律 2：服务端响应 → 忠实展示，不加工

- ❌ 禁止"帮用户总结" answer
- ❌ 禁止"帮用户翻译技术术语"
- ❌ 禁止"帮用户提炼重点"
- ❌ 禁止挑出部分内容回复用户而隐藏其余
- ✅ 智能体的 `answer` 字段**整段原样贴给用户**
- ✅ `download_links` 直接给用户，不要催"赶紧下载"（链接永久有效）

#### 铁律 3：多轮对话 → 服务端主导节奏，客户端只是双向管道

- 服务端追问 → **完整转给用户**，等用户回答，**绝不替用户答**
  > 例：服务端问"请确认第 3 行地域"，即使你能从用户最初上传的图里看到"北京"，也**不要替答**。一律转给用户。
- 服务端要求确认 → 把请求转给用户，**不要替用户确认**
- 用户回复 → 原样作为 message 转给服务端（用相同 `conversation_id`）
- 整个会话期间，客户端只是 **用户 ↔ 服务端** 之间的双向管道

#### 铁律 4：产品归属判断 → 一律交给服务端，客户端不做"门卫"

不管用户问的是什么产品（腾讯云、友商、内部工具、虚构产品、写错的产品名），客户端**绝不**做以下任何一种判断：

- ❌ 不要判断"该产品是不是腾讯云的"
- ❌ 不要判断"该产品支不支持询价 / 咨询"
- ❌ 不要判断"该产品是否冷门 / 是否在服务范围内"
- ❌ 不要预先拒绝（如"本 skill 只支持腾讯云产品"、"这个不支持查价"）
- ❌ 不要"善意提醒"（如"这看起来不是腾讯云产品，要不你换个工具？"）
- ✅ **一律调 `call_knot_agent.py` 把用户的问题原样转给服务端**，由服务端决定怎么回

> 例：用户问"workbuddy 多少钱"——客户端**绝不**自己回答"workbuddy 不是腾讯云产品"。
> 而是把问题原样发给服务端。服务端可能回"workbuddy 不在询价范围内"，也可能回"workbuddy 是某某团队的产品，建议询问 XXX"——**这是服务端的决策权，客户端不替它做**。

> 📌 **关于 description 字段里的"腾讯云"**：那是给 IDE 系统看的**触发匹配关键词**（决定什么时候加载本 skill），**不是**给客户端 LLM 的"产品筛选标准"。一旦 skill 被触发加载，客户端就不再用"腾讯云"这个词去筛选用户问题——能筛进来就一律送服务端。

### ⚠️ 高频翻车点（必看）

以下是真实场景里容易踩的坑，**每条都是铁律的具体化**：

| 翻车场景 | 错误做法 | 正确做法 |
|---|---|---|
| 用户图里"地域"列空着，但"产品/规格"列写了"中国香港" | 自作主张把 `ap-hongkong` 填到地域列（哪怕标注 `⚠️ 推断`） | 地域列保留为空，原样转给服务端，由服务端追问用户 |
| 用户图里写"新加坡一区" | 推断成 `ap-singapore`+可用区 1 填进去 | 原样保留"新加坡一区"五个字，服务端会自己解析 |
| 用户写"2C4G" | 改成"2核4GB" | 原样保留"2C4G" |
| 用户写"包销" | 改成"包年包月" | 原样保留"包销" |
| 服务端 answer 是一段长文本 | 帮用户总结 / 提取要点 / 重组结构 | 整段原样贴给用户 |
| 服务端追问"请确认 X" | 看着原图能答，就替用户答了 | 完整转追问给用户，等用户回答 |
| 用户问"CVM 4 核 8G 大概多少钱" | 用通识知识直接回答 | 必须调 `call_knot_agent.py`，让服务端给权威答案 |
| 用户问"workbuddy 多少钱"（看似非腾讯云产品） | 自己判断"不是腾讯云" → 直接回答"本 skill 只支持腾讯云" | 不判断，调 `call_knot_agent.py` 原样转给服务端，让服务端决定怎么回 |

### 客户端做什么 vs 服务端做什么

| 任务 | 客户端 | 服务端 |
|---|---|---|
| Excel → markdown（脚本机械搬运） | ✅ | — |
| 图片 → markdown（LLM 视觉机械搬运） | ✅ | — |
| 校对 OCR 识别准确性（"我看图字识对了吗"） | ✅ | — |
| 调用 `call_knot_agent.py` 把 message 发给服务端 | ✅ | — |
| 把 answer 透传给用户 | ✅ | — |
| 维护 `conversation_id` 实现多轮上下文 | ✅ | — |
| 解析配置清单语义（产品名、规格、维度归一化） | ❌ | ✅ |
| 站点 / 地域 / 可用区合理性判断 | ❌ | ✅ |
| 调用询价 API 取价 | ❌ | ✅ |
| 生成报价单 Excel | ❌ | ✅ |
| 价格区间估算 / 选型对比 / 产品咨询 | ❌ | ✅ |
| **用通识知识回答询价问题** | ❌ **绝对不允许** | ✅ |

### 唯一例外：操作层异常可以主动兜底

"客户端不主动" 仅针对**业务内容**。**操作层异常**（网络、协议、token、空响应等）客户端可以主动给用户提示：

| 情形 | 客户端动作 |
|---|---|
| 服务端返回 HTTP 4xx / 鉴权错误 / 参数错误 | 不自动重试；透传错误信息，并建议用户检查 token 或输入 |
| 服务端返回 HTTP 5xx / 网络连接失败 / 临时超时 | 可自动重试 **1 次**；仍失败则透传错误信息 + 建议用户稍后重试 |
| 服务端 30 分钟超时 | 不自动重试；透传超时 + 建议用户重新发起 |
| 服务端 `answer` 返回空 | 不自动重试；提示"服务端未返回内容，建议重试" |
| `KNOT_API_TOKEN` 未配置 | 引导用户配置（见下文「前置检查」） |

> ✅ 允许的重试边界：仅限明显临时性操作异常（网络抖动、HTTP 5xx、连接超时），最多 **1 次**，且必须使用**完全相同的 message / conversation_id**，不能改写用户问题。
>
> ❌ 仍然禁止：自动重试 N 次、自动换问法重新提交、自动忽略错误继续走 —— 这些都是替用户决策，越界了。

---

## 前置配置

### 环境变量

| 环境变量 | 必须 | 说明 | 获取方式 |
|---------|------|------|---------|
| `KNOT_API_TOKEN` | **是** | knot 平台的 API Token（团队 token 或个人 token） | https://knot.woa.com/settings/token?type=team （团队）或 https://knot.woa.com/settings/token （个人） |
| `KNOT_API_USER` | 否 | 调用者的企微英文名（不设置时以 token 所属账号身份运行） | 使用团队 token 时可指定真实用户身份 |

### Python 版本

**要求 Python 3.9+**。调用脚本时请使用 `python3` 而非 `python`。

> 如果当前环境的 Python 版本低于 3.9（可通过 `python3 --version` 检查），AI 调用方应使用 `install_binary` 工具安装合适的 Python 版本（如 3.12.0），再用对应路径执行脚本。

### 依赖安装

```bash
pip install requests openpyxl
```

### 路径约定（跨机器 / 跨 IDE 可分发）

本文档中的 `SKILL_BASE_DIR` 表示当前 skill 的根目录。调用脚本时不要写死 `.claude/skills/...`、`.codebuddy/skills/...` 或本机绝对路径。

执行方应使用加载 skill 时显示的 Base directory 作为 `SKILL_BASE_DIR`，例如：

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" --message "..."
```

> 在 CodeBuddy 中，加载 skill 后会显示类似 `Base directory for this skill: ...` 的路径；后续命令直接使用该路径即可。同事安装到任何目录都不需要修改本文档。

### 检查 + 引导用户配置

> ⚠️ **高频翻车点（必看）**：AI 工具（CodeBuddy / WorkBuddy / Claude Code 等）执行 bash 命令时用的是 **non-interactive shell**，**默认不会自动加载 `~/.zshrc` / `~/.bashrc`**。所以**直接** `echo $KNOT_API_TOKEN` 看到"未设置"，**99% 的情况是 profile 里其实有，只是当前 shell 没加载**——而不是用户真没配。
>
> ❌ **绝对不要**：看到"未设置"就让用户重新跑一遍持久化流程（用户最讨厌这种"我明明配过了你还让我配"的体验）
>
> ✅ **正确做法**：首次使用、鉴权失败或怀疑配置异常时，先 source profile 再检查；日常调用只需要 source profile + 调脚本，不必每次单独打印检查结果。
>
> 🔒 **安全要求**：检查时不要明文打印 `KNOT_API_TOKEN`，只能输出"已设置 / 未设置"或脱敏前后缀。

**第一步：检查环境变量是否已设置（自动 source profile，脱敏输出）**

```bash
# 先加载 profile（zsh 优先，回退 bash 系列），再检查变量；不要明文打印 token
for f in ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile ~/.profile; do
  [ -f "$f" ] && . "$f" 2>/dev/null
done

if [ -n "${KNOT_API_TOKEN:-}" ]; then
  token_len=${#KNOT_API_TOKEN}
  if [ "$token_len" -gt 8 ]; then
    echo "KNOT_API_TOKEN=已设置(${KNOT_API_TOKEN:0:4}****${KNOT_API_TOKEN: -4})"
  else
    echo "KNOT_API_TOKEN=已设置(已脱敏)"
  fi
else
  echo "KNOT_API_TOKEN=未设置"
fi

if [ -n "${KNOT_API_USER:-}" ]; then
  echo "KNOT_API_USER=$KNOT_API_USER"
else
  echo "KNOT_API_USER=未设置"
fi
```

- **已设置** → 后续调用 `call_knot_agent.py` 之前，只需 source profile（示例命令已包含），不需要再次单独打印检查结果；也可以把 token 通过 `--token` 参数显式传给脚本
- **未设置** → 走下面的引导（这才是真没配）

> 💡 **更省心的做法**：写一个一次性的命令前缀，把 source + 调用脚本绑在一起：
> ```bash
> SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
> for f in ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile ~/.profile; do [ -f "$f" ] && . "$f" 2>/dev/null; done && \
> python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" --message "..."
> ```
> 或者直接用 `--token` 参数（在 source 失败时兜底）。

**第二步：未设置时引导用户提供 token，并自动持久化到 shell profile**

> 自动写入 `~/.zshrc` 或 `~/.bashrc`，所有终端工具（Claude Code / WorkBuddy / CodeBuddy 等）启动时自动加载，一次设置永久生效。

```bash
# 检测 shell profile 路径
SHELL_PROFILE="${HOME}/.zshrc"
[ -f "$SHELL_PROFILE" ] || SHELL_PROFILE="${HOME}/.bashrc"

# 移除旧配置（如果之前设置过），避免重复
sed -i '' '/^# Knot Agent Config$/d; /^export KNOT_API_TOKEN=/d; /^export KNOT_API_USER=/d' "$SHELL_PROFILE" 2>/dev/null || true

# 追加新配置
cat >> "$SHELL_PROFILE" << 'EOF'
# Knot Agent Config
export KNOT_API_TOKEN="用户提供的token"
export KNOT_API_USER="用户的企微英文名"
EOF

# 当前会话立即生效
export KNOT_API_TOKEN="用户提供的token"
export KNOT_API_USER="用户的企微英文名"

echo "✅ 已写入 $SHELL_PROFILE，当前及后续所有终端会话自动生效"
```

> **要点**：
> - `KNOT_API_TOKEN` 必须，**不要跳过直接调用脚本**
> - `KNOT_API_USER` 可选，用户没提供就不写这行
> - 不想持久化也可以通过命令行参数 `--token` / `--user` 临时传入

---

## 调用方式

通过执行 Python 脚本调用。

> ⚠️ **调用脚本前都要 source profile**（原因见上文「高频翻车点」）。但不需要每次都单独打印 token 检查结果；只有首次使用、鉴权失败或怀疑配置异常时才执行上面的脱敏检查。下面所有示例都已经包含 source 前缀，**照抄即可**。

### 首轮提问（新会话）

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
for f in ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile ~/.profile; do [ -f "$f" ] && . "$f" 2>/dev/null; done && \
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" \
  --message "帮我查一下 CVM 标准型S5 4核8G 北京地域包年包月的刊例价"
```

### 多轮追问（接续已有会话）

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
for f in ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile ~/.profile; do [ -f "$f" ] && . "$f" 2>/dev/null; done && \
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" \
  --message "确认，请开始查价" \
  --conversation-id "<上一轮返回的 conversation_id>"
```

### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--message` | 是 | 用户的提问内容 |
| `--conversation-id` | 否 | 会话 ID，传入则接续上一轮对话上下文；首轮留空 |
| `--token` | 否 | 覆盖环境变量 `KNOT_API_TOKEN` |
| `--user` | 否 | 覆盖环境变量 `KNOT_API_USER` |

---

## 输出格式

脚本返回 JSON 到 stdout：

### 成功（含文件下载链接）

```json
{
  "success": true,
  "answer": "智能体的完整回答文本...",
  "conversation_id": "019951616426777e92d98cf511f7db4c",
  "download_links": [
    {
      "file_name": "20260515_batch_inquiry-最终报价.xlsx",
      "url": "https://knot.woa.com/api/v1/workspace/download_file?uuid=...&path=...&workspace=..."
    }
  ],
  "error": ""
}
```

### 成功（无文件）

```json
{
  "success": true,
  "answer": "CVM 4核8G 北京地域的刊例价为...",
  "conversation_id": "019951616426777e92d98cf511f7db4c",
  "download_links": [],
  "error": ""
}
```

### 失败

```json
{
  "success": false,
  "answer": "",
  "conversation_id": "",
  "download_links": [],
  "error": "错误描述信息"
}
```

---

## 批量查价的交互流程（重要）

批量查价（多产品配置清单）是一个**多轮确认流程**：

### 第 1 轮：提交配置清单

智能体会解析配置并返回确认信息，**不会直接出价**。

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"

# 先用 parse_excel.py 解析 Excel
TABLE=$(python3 "$SKILL_BASE_DIR/scripts/parse_excel.py" --file 配置清单.xlsx)

# 将解析结果作为 message 发送（注意先 source profile）
for f in ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile ~/.profile; do [ -f "$f" ] && . "$f" 2>/dev/null; done && \
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" \
  --message "请帮我查询以下配置清单的刊例价：
$TABLE"
```

返回示例：
```json
{
  "success": true,
  "answer": "我已解析您的配置清单，共6行产品。请确认以下信息是否正确：\n...",
  "conversation_id": "xxx",
  "download_links": []
}
```

### 第 2 轮：确认并触发查价

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
for f in ~/.zshrc ~/.bashrc ~/.zprofile ~/.bash_profile ~/.profile; do [ -f "$f" ] && . "$f" 2>/dev/null; done && \
python3 "$SKILL_BASE_DIR/scripts/call_knot_agent.py" \
  --message "确认，请开始查价" \
  --conversation-id "xxx"
```

返回示例（含下载链接）：
```json
{
  "success": true,
  "answer": "查价完成！以下是6行配置的刊例价汇总...",
  "conversation_id": "xxx",
  "download_links": [
    {
      "file_name": "20260515_batch_inquiry-最终报价.xlsx",
      "url": "https://knot.woa.com/api/v1/workspace/download_file?..."
    }
  ]
}
```

### 处理确认环节的规则

1. 第 1 轮返回后，**将 answer 展示给用户**，让用户确认或修正
2. 用户确认后，用**同一个 conversation_id** 发送确认消息
3. 如果用户要修正某行，直接告诉智能体修正内容即可（如"第3行地域改为上海"）
4. **只有 `download_links` 非空时，才说明查价已完成**

> 💡 **客户端心法重申**：本节所有动作都是协议透传 —— 服务端的 answer 整段原样给用户，用户的回复整段原样给服务端，**绝不在任何一方的内容上做加工**。详见顶部「核心定位」。

---

## Excel 配置清单解析

当用户提供了 Excel 文件需要批量查价时，使用辅助脚本解析：

```bash
SKILL_BASE_DIR="<加载 skill 时显示的 Base directory>"
python3 "$SKILL_BASE_DIR/scripts/parse_excel.py" --file /path/to/配置清单.xlsx
```

### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--file` | 是 | Excel 文件路径 |
| `--sheet` | 否 | 指定 Sheet 名称（默认取第一个） |
| `--format` | 否 | 输出格式：`markdown`（默认）、`json`、`text` |

### 输出示例（markdown 格式）

```
| 产品/规格 | 站点 | 地域 | 计费模式 | 数量 | 时长 |
| --- | --- | --- | --- | --- | --- |
| 云服务器CVM 标准型S5 2核2GB | 国际站 | ap-singapore | 包年包月 | 1 | 12 |
| 云硬盘CBS 高性能云硬盘 100GB | 国际站 | ap-singapore | 包年包月 | 2 | 12 |
```

> **关于列名**：脚本以用户 Excel 的**第一行作为表头原样输出**，不会强制要求必须是上面这 6 列。用户 Excel 里有什么列就输出什么列。智能体那端会自己判断列含义、容忍列的多寡、缺啥追问啥。

---

## 图片配置清单解析（截图 / 拍照 / PDF 截图等）

当用户提供图片形式的配置清单（Excel 截图、Word 截图、聊天截图、手写拍照、PDF 页面截图等），由 LLM 调用方用自身视觉能力直接处理，**与 `parse_excel.py` 完全对称**：忠实搬运图片中的表格内容到 markdown，不做任何语义改写、不强加 schema、不脑补字段。

### 处理原则（搬运工原则）

1. **图里有什么列就是什么列**，列名原样照抄
   - "地区" 不要改成 "地域"
   - "实例" 不要改成 "产品/规格"
   - "month" 不要翻译成 "月"
2. **图里有几行就是几行**，单元格原样转录
   - 含 `-`、`未填写`、`待定`、`/` 等用户自己写的占位符也要照抄
   - 合并单元格按视觉逻辑还原（如标题行跨多列）
3. **不脑补字段**：图里没有的列**绝对不要**替用户补全
   - 缺"计费模式"列？不要自己加一列填"包年包月"——让服务端智能体自己追问
   - 缺"地域"列？同上
   - ⚠️ 哪怕用户在"产品/规格"列写了"中国香港"、"新加坡一区"这种带地理位置的字眼，**也不要把它推断成 region code（如 `ap-hongkong` / `ap-singapore`）补到地域列**——这是服务端的解析职责，客户端越界=出错风险
4. **保留表外文字**：如果图片中有表格之外的关键信息（标题、备注、脚注、口头说明），用 markdown 引用块贴在表格前后，给服务端完整上下文
5. **不做单位/格式归一化**：用户写"2C4G"就是"2C4G"，不要改成"2核4GB"；用户写"12个月"就是"12个月"，不要改成"12"

### 编排流程

1. **识别**：LLM 直接读图，转成 markdown 表格（一字不动地搬运）
2. **校对识别准确性**（**强制环节**）：把识别结果展示给用户，请用户**核对识别得对不对**——是否有看错的字、漏掉的行、串列的内容
   > ⚠️ 这一步**只校对"我识别得对不对"**，不校对"内容对不对、维度齐不齐"。后者是服务端智能体的职责（它会追问、会兜底、会归一化），客户端不替它做决策。
3. **发送**：用户确认识别无误后，把 markdown 表格作为 message 直接传给 `call_knot_agent.py`。后续追问/确认/查价/归一化全部由服务端智能体主导，客户端**只透传**。

### 与其他输入形式的对称关系

| 输入 | 适配方式 | 适配层智能含量 | 中间产物 |
|---|---|---|---|
| `.xlsx` 文件 | `parse_excel.py`（脚本逐字搬运） | 0%（纯字符串处理） | markdown 表格 |
| 图片 | LLM 视觉直接识图（识图后逐字搬运） | 仅"看懂图里写的字"，不做语义判断 | markdown 表格 |
| 文本 | 用户自己整理 / 直接粘贴 | 0% | markdown 表格 |

→ **三种输入形式喂给智能体的都是同一种东西**：忠实还原用户原始数据的 markdown 文本。智能体那端不区分也不需要区分来源。

→ **核心理念**：适配层只搬运，不思考；业务智能全部留给服务端询价智能体。

---

## 多轮对话管理

- **首轮对话**：不传 `--conversation-id`，脚本返回新的 `conversation_id`
- **追问/续问**：传入上一轮返回的 `conversation_id`，智能体自动保持上下文
- **新开对话**：不传 `--conversation-id` 即可开始全新会话
- **对话 ID 管理**：你需要自行记住当前会话的 `conversation_id`，每次追问时传入

> 💡 **客户端心法重申**：多轮对话期间，客户端的角色是**双向管道** —— 服务端追问转给用户、用户回复转给服务端，**绝不替任何一方思考或决策**。详见顶部「核心定位」铁律 3。

---

## 超时与长时间运行

**重要：** 智能体内部可能调用多个工具进行查价，耗时可达 **数分钟甚至 30 分钟**（复杂批量查价场景）。这是正常行为。

- 脚本默认超时 **1800 秒（30 分钟）**
- 执行此脚本时，**必须设置足够长的 Bash 超时**（建议 `timeout: 600000`，即 10 分钟）
- 脚本会持续向 stderr 输出进度信息（如"正在调用工具 #3..."、"步骤完成: call_llm"），表明仍在正常运行
- **只要 stderr 有输出，就说明脚本还活着，不要中断**

---

## 文件下载

当智能体生成了报价单 Excel 时，`download_links` 字段会包含下载链接：

```json
"download_links": [
  {
    "file_name": "20260515_batch_inquiry-最终报价.xlsx",
    "url": "https://knot.woa.com/api/v1/workspace/download_file?uuid=...&path=...&workspace=..."
  }
]
```

- 将 `url` 提供给用户，用户可在浏览器中打开下载
- 如果 `download_links` 为空数组，说明本轮没有文件输出（可能在确认环节，或只是简单问答）

---

## ✋ 回应前自检清单（每次回应用户/调用脚本前过一遍）

任意一条答 yes，立刻回退重做：

- [ ] 我是否擅自补了用户没写的字段？（包括"中国香港 → ap-hongkong"、"新加坡一区 → ap-singapore + zone1" 这种地理位置 → region code 的推断）
- [ ] 我是否对服务端的 `answer` 做了总结 / 重组 / 翻译 / 精简 / 措辞优化？
- [ ] 我是否替用户回答了服务端的追问？（哪怕用户最初的输入里能找到答案，也不能替答 —— 必须转给用户确认）
- [ ] 我是否用通识知识直接回答了询价/选型/计费相关问题，而没有调用 `call_knot_agent.py`？
- [ ] 我是否扮演了"门卫"角色？（自己判断"该产品是不是腾讯云"、"支不支持询价"、"是否在服务范围"，从而预先拒绝/放行用户问题）
- [ ] 我是否在没有先 source profile 的情况下，看到 `echo $KNOT_API_TOKEN` 显示"未设置"，就让用户重新走一遍持久化流程？（99% 是 non-interactive shell 没加载 profile，应该先 source 再判断，而不是让用户重新配置）
- [ ] 我是否把 `KNOT_API_TOKEN` 明文打印到了终端、日志或回复里？（必须脱敏，只显示"已设置 / 未设置"或前后缀）

> 这 5 条对应顶部「核心定位」四条铁律的最高频翻车点。**自检不是形式，是写出回应前的最后一道闸门。**
