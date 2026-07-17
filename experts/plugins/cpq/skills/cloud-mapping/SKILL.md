---
name: cloud-mapping
description: 腾讯云规格映射能力。用于将用户自然语言或 Excel/JSON/Markdown/PDF/DOCX 文件中的外部云规格映射为腾讯云可选购规格字段；支持 AWS、阿里云、华为云、GCP 的实例、地域、磁盘、计费、带宽、购买时长等规格映射。Use when 用户要求“规格映射 / cloud-mapping / AWS EC2 对应腾讯云 / 阿里云 ECS 对应 CVM / 友商机型转腾讯云 / 迁移规格映射 / 导入规格文件 / Excel 规格映射 / PDF 规格映射 / DOCX 规格清单 / Markdown 规格清单 / BOQ / 报价单 / 账单 / 采购清单 / PDF 区域提取 / 坐标框选”。不要用于询价、CLS 日志、GTM 编码、三元组生成或报价行提交。
---

# cloud-mapping — 腾讯云规格映射

> 运行时目录：`SKILL.md` / `scripts/` / `references/`。
> 临时文件只能写入 `./.tmp/`（gitignored）。维护进度见 [`evolve/progress.md`](./evolve/progress.md)。

## 定位

把用户给出的自然语言规格或文件规格清单，映射成腾讯云可选购规格字段，并返回映射依据与未解析字段。

## 职责边界

### 只做

- 识别规格要素：产品、厂商、地域、实例规格、CPU/内存、磁盘、带宽、计费方式、购买时长等。
- 查询 `references/data/cloud-mapping/` 下的规格映射字典。
- 字典未覆盖时转用独立 `migraq` skill 兜底。
- 输出腾讯云规格、`provenance`、`unresolved`。
- 文件输入采用“兄弟 Office/PDF skills 先抽取，`scripts/batch_io.mjs` 后归一化”的两段式流程：Excel 用 `xlsx-manipulation`，PDF 用 `pdf-extraction`，DOCX 用 `docx-manipulation`；`batch_io.mjs` 只读取 JSON / Markdown / 已抽取结构化文本。
- 报价单 / BOQ / 账单 / 采购清单属于可处理文件载体；仅抽取其中规格相关列和内容，忽略价格、折扣、合计等金额字段。

### 不做

- 不询价、不查 CLS、不反查 GTM。
- 不提取 ProductCode / SubProductCode / ValueItemCode / ValueSubItemCode。
- 不生成三元组 entry，不提交报价行。
- 不把未确认字段继续传给下游流程。

## 红线

1. **禁止用 LLM 记忆补字典盲区**：字典没覆盖必须转用 `migraq`；仍无明确结论则标 `unresolved`。
2. **禁止伪权威规格**：不确定字段必须明说，不得静默默认。
3. **禁止越界执行报价链路**：涉及询价、CLS、GTM、三元组或报价行提交时，应转交其它专门能力。
4. **禁止敏感数据落盘**：不得持久化 cookie / skey / STS token / AK/SK。

## 工作流

```text
[0] migraq 环境预检（前置，避免后续白等）
  ↓
输入规格（自然语言 / 文件行）
  ↓
解析规格要素
  ↓
按字段查询 cloud-mapping 字典
  ├─ 命中且无歧义 → 写入腾讯云规格，来源 dict:<file>
  ├─ 命中多个候选 → 按候选规则处理
  └─ 未命中 → 转用独立 migraq skill（仅当预检通过）
  ↓
migraq 返回明确结果 → 写入腾讯云规格，来源 migraq(session:<id>)
migraq 不可用 / 无明确结果 → unresolved
  ↓
输出规格表或 JSON
```

### Step 0: migraq 环境预检（必须在映射开始前执行）

在任何映射操作之前，**必须先运行**代理预检确认 migraq 是否可用。规格映射属于只读咨询（售前流程），使用**免鉴权模式**调用，无需 AK/SK。

```python
import sys
sys.path.insert(0, '{baseDir}/../migraq/scripts')
from migrateq_sse_api import call_sse_api_no_auth, generate_session_id

probe = call_sse_api_no_auth("ping", session_id=generate_session_id(), timeout=30)
migraq_available = bool(probe.get("success"))
migraq_unavailable_reason = ""
if not migraq_available:
    err = probe.get("error", {})
    migraq_unavailable_reason = f"{err.get('code', 'ProxyError')}: {err.get('message', str(probe))}"
```

预检结果决定后续降级策略：
- `migraq_available = True` → 字典未命中项正常调用 migraq
- `migraq_available = False` → 所有字典未命中项直接标 `unresolved`，备注中写明 `migraq_unavailable_reason`（例如代理 CAM 未授权、来源 IP/VPC 不在白名单），不再逐条重试

## 候选与置信度

| 场景                    | 处理                                            | confidence                       |
| ----------------------- | ----------------------------------------------- | -------------------------------- |
| 字典唯一精确命中        | 直接采用，记录 `dict:<file>`                    | `exact`                          |
| 用户明确“成本优先”      | 选 `策略：成本优先` 候选                        | `strategy`                       |
| 用户未说明偏好          | 优先 `标准推荐`；没有标准推荐时列候选           | `strategy` / `needs_user_choice` |
| 地域 / 磁盘等 1:N 候选  | 若字典或策略写明优先级则按优先级；否则列候选    | `strategy`                       |
| 多候选无法判定          | 不静默任选，写入 `unresolved:needs_user_choice` | `needs_user_choice`              |
| migraq 给出明确字段 | 采用并标 `migraq(session:<id>)`                 | `migraq`                         |
| migraq 不可用或回答含糊 | 不采用，写入 `unresolved`                       | `unresolved`                     |

输出中必须能看出“为什么选这个值”；多候选时若没有用户偏好或字典优先级，不得默认取第一项。

## 文件输入

Office / PDF 附件先交给 `cpq` plugin 内的兄弟 skills 保留结构化信息，再把抽取结果交给 `cloud-mapping`：

| 输入类型                     | 先用能力               | 抽取要求                                                                  |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| Excel / `.xlsx` / `.xls`     | `xlsx-manipulation`    | 按工作表、表头、行列读取；保留 `sheet`、`row`、原始列名；只抽取规格相关列 |
| PDF                          | `pdf-extraction`       | 优先抽表格和页内位置；保留 `page`、`bbox`；扫描件需说明 OCR 风险          |
| DOCX                         | `docx-manipulation`    | 按段落、表格、合并单元格读取；保留段落 / 表格来源                         |
| JSON / Markdown / 已抽取文本 | `scripts/batch_io.py`  | 归一化为映射输入行                                                        |

### 一次性读取原则（禁止反复读同一文件）

Excel / PDF / DOCX 文件**必须在一次 Python 脚本调用中完成全部读取**，输出完整的结构化 JSON。禁止分多次打开同一文件（如先 `ls` 再读结构再读内容再读合并区域）。

推荐模式（Excel 示例）：

```python
from openpyxl import load_workbook
import json

wb = load_workbook('inbox/file.xlsx', data_only=True)
rows = []
for ws in wb.worksheets:
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        spec_text = str(row[SPEC_COL] or "").strip()
        if not spec_text:
            continue
        rows.append({
            "input": spec_text,
            "sheet": ws.title,
            "row": i,
            "format": "excel",
            "source": "xlsx-manipulation"
        })
print(json.dumps(rows, ensure_ascii=False))
```

一次调用输出全部行的 JSON，后续映射流程**只消费这份 JSON**，不再回头读原文件。

`scripts/batch_io.py` 不再直接解析 `.xlsx` / `.pdf` / `.docx`，只接收 JSON 或 Markdown：

```bash
python3 scripts/batch_io.py <file.json|file.md>
```

JSON 交接契约：

```json
[
  {
    "input": "原始规格文本",
    "hint": "spec|four_level|product_lib_name",
    "row": 2,
    "sheet": "ECS",
    "page": 1,
    "bbox": { "x": 10, "y": 20, "width": 100, "height": 30, "unit": "pt", "origin": "top-left" },
    "format": "excel|pdf|docx|json|markdown",
    "source": "xlsx-manipulation|pdf-extraction|docx-manipulation|batch_io"
  }
]
```

读取后逐行 / 逐文本块走同一映射流程；若输入是报价单 / BOQ / 账单 / 采购清单，应先定位规格相关列、表格区域或 PDF 坐标区域，只把规格文本送入映射流程，价格、折扣、合计等金额字段不进入映射。批量场景合并相同产品 / 相同缺失字段后再调用 `migraq`，避免重复兜底。

兄弟 skill 已完成 PDF / Excel / DOCX 解析时，`cloud-mapping` 只消费交接 JSON / Markdown，不额外安装 `xlsx`、`pdfjs-dist`、`mammoth`。

## cloud-mapping 字典

位置：`references/data/cloud-mapping/`

| 文件                  | 用途                                  |
| --------------------- | ------------------------------------- |
| `product-strategy.md` | 产品级推荐策略与匹配方法              |
| `field-rule.md`       | 源字段 → 腾讯云字段的匹配规则         |
| `instance.md`         | 友商实例规格族 → 腾讯云 CVM 实例族    |
| `region.md`           | 友商地域 → 腾讯云地域                 |
| `disk.md`             | 友商磁盘类型 → 腾讯云 CBS 磁盘类型    |
| `enum-mapping.md`     | 计费、网络、存储、OS 等枚举映射       |
| `range-mapping.md`    | 带宽、容量、连接数等区间 / 有效值映射 |

使用原则：用到什么查什么；不要全量预读；不要把个例泛化成未写明规则。

### references 加载路由

| 输入特征                                | 必读                                                  | 延后 / 禁读                          |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| 不确定产品或只给服务名                  | `product-strategy.md`                                 | 先不要读大表；确认产品后再读字段字典 |
| CVM / ECS / EC2 / 实例规格 / CPU / 内存 | `product-strategy.md`、`field-rule.md`、`instance.md` | 无磁盘信息时不要读 `disk.md`         |
| 地域 / region / 可用区粗映射            | `region.md`                                           | 不要读 `instance.md`、`disk.md`      |
| 磁盘 / EBS / CBS / 云盘类型或容量       | `disk.md`、必要时 `range-mapping.md`                  | 不要读 `instance.md`                 |
| 计费、网络、OS、存储类型等枚举          | `enum-mapping.md`、必要时 `field-rule.md`             | 不要读无关产品大表                   |
| 带宽、容量、连接数、有效值区间          | `range-mapping.md`、必要时 `field-rule.md`            | 不要用模型自行猜范围                 |
| 多产品混合规格                          | 先读 `product-strategy.md` 分组                       | 分组前不要全量读全部字典             |

批量输入时先抽样 3-5 行判断产品和字段，再按上表读取；若同一批次字段相同，应复用已读字典结论。

## migraq 兜底

只在字典盲区时转用独立 `migraq` skill。批量场景将所有未命中条目合并为一次调用。

### 调用方式

通过 Python import 调用（推荐，避免命令行参数转义问题）。规格映射属于只读咨询（售前流程），使用**免鉴权模式**：

```python
import sys
sys.path.insert(0, '{baseDir}/../migraq/scripts')
from migrateq_sse_api import call_sse_api_no_auth
import json

question = '''<按下方模板构造>'''
result = call_sse_api_no_auth(question=question, timeout=180)
# result["success"] == True 时，结果在 result["data"]["content"]
# result["data"]["session_id"] 用于标注 provenance
```

### 问题模板

将所有字典未覆盖的规格合并为编号列表（建议 ≤10 条/批，超过则分批）：

```text
以下是需要映射到腾讯云的规格清单，请逐条返回对应的腾讯云产品和规格：

1. <源厂商> <源产品> <核心规格>（<补充已知信息或标明缺失>）
2. <源厂商> <源产品> <核心规格>
3. ...

---
[上下文] 这是批量自动映射流程，不支持交互追问。请根据已有信息直接给出每条的腾讯云产品和规格；如信息不足无法确定，直接回复该条"无法确定"，不要反问。只需要返回腾讯云产品名称和规格参数名列表，不需要价格、TCO、费用测算、购买建议、迁移策略或其他扩展信息。
```

### 调用规范

| 规范 | 说明 |
|---|---|
| **批量合并** | 同一批次所有字典未命中的条目合并为一次调用，不逐条 |
| **≤10 条/批** | 超过 10 条分批，每批独立调用 |
| **timeout=180** | 远端可能调用推荐引擎，耗时 30-60s，180s 兜底 |
| **复用 sessionId** | 同一批次分批调用时复用上一次返回的 `session_id` |
| **禁止反问** | 模板中必须含"不支持交互追问"+"无法确定时直接说无法确定" |
| **限定输出范围** | 只要求产品名和规格参数名列表；禁止价格、TCO、费用测算、购买建议、迁移策略等扩展信息 |
| **标明缺失** | 每条规格已知信息不全时在括号中标明，帮助远端判断 |
| **所有未命中都要发** | 不得跳过任何字典未命中的条目，全部合并发送 |

### 结果解析

1. 检查 `result["success"]`：
   - `True` → 从 `result["data"]["content"]` 提取逐条结果
   - `False` → 标 `[unresolved] migraq不可用: <error.message>`
2. 解析 content 中每条的腾讯云产品和规格：
   - 有明确结果 → 写入目标值，备注标 `migraq(session:<id>)`
   - 回答"无法确定" → 目标留空，备注标 `migraq(session:<id>); [unresolved] <原因>`
3. `session_id` 从 `result["data"]["session_id"]` 获取

### 完整示例

```python
import sys, json
sys.path.insert(0, '{baseDir}/../migraq/scripts')
from migrateq_sse_api import call_sse_api_no_auth

# 收集所有字典未命中的条目
unmatched = [
    "华为云 微服务引擎 CSE 最低规格",
    "华为云 WAF Web应用防火墙",
    "华为云 云桌面（未标明规格）",
]

numbered = "\n".join(f"{i+1}. {item}" for i, item in enumerate(unmatched))
question = f"""以下是需要映射到腾讯云的规格清单，请逐条返回对应的腾讯云产品和规格：

{numbered}

---
[上下文] 这是批量自动映射流程，不支持交互追问。请根据已有信息直接给出每条的腾讯云产品和规格；如信息不足无法确定，直接回复该条"无法确定"，不要反问。只需要返回腾讯云产品名称和规格参数名列表，不需要价格、TCO、费用测算、购买建议、迁移策略或其他扩展信息。"""

result = call_sse_api_no_auth(question=question, timeout=180)
if result["success"]:
    session_id = result["data"]["session_id"]
    content = result["data"]["content"]
    # 解析 content 中的表格或逐条结果...
else:
    # 标 [unresolved] migraq不可用
    error_msg = result["error"]["message"]
```

## 输出格式

输出只保留核心映射信息，不含溯源定位（文件名、工作表、行号等由调用方自行关联）。

### 表格（默认，4 列）

| 列名 | 说明 |
|---|---|
| `原规格描述` | 源规格一句话摘要：`<厂商> <产品> <核心规格> ×<数量>` |
| `腾讯云产品` | 映射后的腾讯云产品 |
| `腾讯云规格` | 映射后的腾讯云规格（紧凑表达，含实例族/磁盘/地域/计费等已映射字段） |
| `备注` | 映射依据、未解析字段、候选项、假设、风险等 |

示例：

```markdown
| 原规格描述 | 腾讯云产品 | 腾讯云规格 | 备注 |
|---|---|---|---|
| 阿里云 ECS 通用型g7 8C32G ESSD50G+200G ×3 | CVM | S6/SA5/SA3 8核32G; 系统盘CLOUD_HSSD 50GB; 数据盘CLOUD_HSSD 200GB | g7→S6/SA5/SA3(dict:instance.md); ESSD→CLOUD_HSSD(dict:disk.md) |
| 阿里云 RDS PostgreSQL 15 HA 16C32G 1000GB | 云数据库 PostgreSQL | PostgreSQL 15; HA; 16核32G; 1000GB | dict:product-strategy.md |
| 阿里云 Redis 4G 高可用 | 云数据库 Redis | 标准架构(主从) 4GB | dict:enum-mapping.md |
```

#### 原规格描述 生成规则

- 格式：`<厂商> <产品> <核心规格描述> ×<数量>`
- 核心规格只写影响映射的关键参数（CPU/内存/磁盘/带宽/版本/架构）
- 不含价格、折扣、合计等金额
- 数量为 1 时 `×1` 可省略

#### 备注 合并规则

- 映射依据简写：`dict:<file>` / `migraq(session:<id>)` / `user`
- 未解析字段：`[unresolved] <字段>: <原因>`
- 候选项：`[候选] <列表>`
- 假设/风险直接写入
- 无特殊说明时可只写字典来源

### JSON（用户要求时）

```json
{
  "mappings": [
    {
      "原规格描述": "阿里云 ECS 通用型g7 8C32G ×3",
      "腾讯云产品": "CVM",
      "腾讯云规格": "S6/SA5/SA3 8核32G; 系统盘CLOUD_HSSD 50GB; 数据盘CLOUD_HSSD 200GB",
      "备注": "g7→S6/SA5/SA3(dict:instance.md); ESSD→CLOUD_HSSD(dict:disk.md)"
    }
  ]
}
```

### Excel 输出脚本

映射结果需要写入 Excel 时，使用 `scripts/write_result.py`：

```bash
echo '<json>' | python3 scripts/write_result.py <output.xlsx>
python3 scripts/write_result.py <output.xlsx> <input.json>
```

stdin 为 JSON 数组，每项包含 4 个字段（`原规格描述` / `腾讯云产品` / `腾讯云规格` / `备注`）。

## 维护者参考

- 进度追踪：[`evolve/progress.md`](./evolve/progress.md)
