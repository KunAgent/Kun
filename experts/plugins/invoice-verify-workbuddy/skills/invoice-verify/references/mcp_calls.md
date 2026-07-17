# MCP 工具注册表

本文件是 Skill 中所有 MCP 工具名称的唯一权威来源。Agent 调用 MCP 时必须使用下方注册表中的工具名，禁止硬编码或猜测工具名。

## 工具注册表

| 用途 | 工具名称 | 所属端点 | 必填参数 |
|------|---------|---------|---------|
| 发票 OCR 识别 | `baiwang.ocr.stand.tickets` | `BAIWANG_OCR_STANDARD_URL` | `fileUrl` (string, 必填), `serviceMode` (string, 必填), `serviceMold` (string, 必填) |
| 发票影像识别采集 | `baiwang.image.invoices.recogcollect` | `BAIWANG_OCR_STANDARD_URL` | `filesMap` (array, 必填，含 `fileName`/`fileBase64`), `userAccount` (string, 必填) |
| 四要素直通验真 | `baiwang.input.compliance.validate` | `BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL` | `invoiceCode` (string, 可选), `invoiceNumber` (string, 必填), `billingDate` (string, 必填), `totalAmount`/`checkCode_6` (string, 选其一), `taxNo` (string, 必填，平台标识，实际值从环境变量 `PLATFORM_TAXNO` 读取) |
| 灰名单检测 | `baiwang.dataasset.risktag.queryTaxnogrey` | `BAIWANG_COUNTERPARTY_RISK_URL` | `taxNo` (string, **必填且非空**，平台标识，实际值从环境变量 `PLATFORM_TAXNO` 读取), `data` (object, **必填**, 含 `taxpayer`/`taxpayercode`，名称税号必填一个) |
| 欠税信息查询 | `baiwang.dataasset.risktag.queryTaxArrearsInfo` | `BAIWANG_COUNTERPARTY_RISK_URL` | `taxNo` (string, **必填且非空**，平台标识，实际值从环境变量 `PLATFORM_TAXNO` 读取), `data` (object, **必填**, 含 `taxpayer`/`taxpayercode`，名称税号必填一个) |
| 重大税收违法查询 | `baiwang.dataasset.risktag.selectViolationInfo` | `BAIWANG_COUNTERPARTY_RISK_URL` | `taxNo` (string, **必填且非空**，平台标识，实际值从环境变量 `PLATFORM_TAXNO` 读取), `data` (object, **必填**, 含 `taxpayer`/`taxpayercode`，名称税号必填一个) |

> 风险查询只允许使用上表三项 `baiwang.dataasset.risktag.*` 工具和 `BAIWANG_COUNTERPARTY_RISK_URL`。`BAIWANG_RISK_QUERY_URL`、`baiwang.risk.query`、`baiwang.risk.*` 均不是本技能接口，禁止调用。

## 工具清单流程

当更换 MCP 端点时，Agent 必须按以下步骤执行：

1. **展示工具清单**：调用 `python scripts/call_mcp.py list BAIWANG_OCR_STANDARD_URL`。百望 `lctoolscall` 网关不支持标准远程 `tools/list`，脚本会展示包内登记的百望工具清单。
2. **匹配注册表**：将要调用的工具名称与本文件上方的「工具名称」列做匹配。百望工具名格式为**全小写 + 点分隔**（如 `baiwang.ocr.stand.tickets`）
3. **发现未注册工具**：若接口文档或平台配置新增了注册表中没有的工具，需确认是否为等价替换，若是则更新注册表
4. **发现工具名差异**：若接口文档工具名称与注册表不一致，以确认后的正式工具名为准，更新注册表并标注旧名称
5. **调用时引用注册名称**：后续所有 `call_mcp.py call` 命令必须使用注册表中确认后的工具名称

> 禁止脱离注册表自行猜测 `inputComplianceValidate`、`input.compliance.validate`、`Input.Compliance.Validate` 等变形名称。统一以注册表为准。

---

# MCP 调用示例

本文件收录所有 MCP 服务的脚本调用示例，供 SKILL.md 工作流程引用。

> **⚠️ 占位符说明**：以下示例中的 `<PLATFORM_TAXNO>` 为占位符，实际调用时自动从环境变量 `PLATFORM_TAXNO` 读取（见 `.env` 和 `mcp-config.json`）。请勿手动替换为真实税号。
>
> **⚠️ 配置加载优先级**：`scripts/call_mcp.py`按以下顺序加载配置：
> 1. **.env文件（最高优先级）** - 包含真实URL和密钥，由WorkBuddy平台注入
> 2. **mcp-config.json（仅占位符模板）** - 只保留键名映射关系，**不应包含真实值**
> 3. **系统环境变量（最低优先级）** - 仅补缺
>
> WorkBuddy平台装载技能时应优先注入`.env`，避免mcp-config.json中的占位符覆盖真实配置。

## 健康检查（Step 1）

```bash
python scripts/call_mcp.py health BAIWANG_OCR_STANDARD_URL
python scripts/call_mcp.py health BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL
python scripts/call_mcp.py health BAIWANG_COUNTERPARTY_RISK_URL
```

## 工具名列表（Step 1 · 首次部署）

```bash
python scripts/call_mcp.py list BAIWANG_OCR_STANDARD_URL
python scripts/call_mcp.py list BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL
python scripts/call_mcp.py list BAIWANG_COUNTERPARTY_RISK_URL
```

> 百望 `lctoolscall` 网关会拒绝远程 `tools/list`，`list` 子命令对百望 URL 展示的是包内登记清单。真实接口可用性应通过对应业务 `call` 验证。

## 发票 OCR 识别（Step 2 · 图片/PDF）

使用百望标准识别 MCP 的 `baiwang.ocr.stand.tickets` 工具，通过 `fileUrl` 参数传入从阿里云 OSS 获取的文件 URL：

```bash
# Step 1: 上传文件到 OSS，获取公共 URL
python scripts/upload_to_oss.py /path/to/invoice.jpg --upload-only
# 输出: https://bw-invoice-workbuddy.oss-cn-beijing.aliyuncs.com/invoice-uploads/...

# Step 2: 使用 OSS 公共 URL 调用 OCR
python scripts/call_mcp.py call BAIWANG_OCR_STANDARD_URL baiwang.ocr.stand.tickets \
  --params '{"fileUrl": "<OSS公共URL>", "serviceMode": "0", "serviceMold": "1"}'
```

> ⚠️ **重要**：`baiwang.ocr.stand.tickets` 只接受 OSS URL，严禁传 base64。必须先调用 `scripts/upload_to_oss.py` 将文件上传至阿里云 OSS 获取永久公共 URL，然后使用该 URL 调用 OCR 接口。
> 支持 jpg/jpeg/png/bmp/pdf 等常见文件格式，单文件上限 8MB。

## 发票影像识别采集（Step 2 · OFD/XML）

OFD/XML 优先使用 `baiwang.image.invoices.recogcollect`。该接口只接受文件裸 base64，不接受 `data:...;base64,` 前缀；不要由 LLM 手工拼接大段 base64，必须使用脚本读取文件并生成入参：

```bash
python scripts/recogcollect_file.py /path/to/invoice.xml
python scripts/recogcollect_file.py /path/to/invoice.ofd
```

脚本内部调用等价于：

```bash
python scripts/call_mcp.py call BAIWANG_OCR_STANDARD_URL baiwang.image.invoices.recogcollect \
  --params '{"filesMap":[{"fileName":"invoice.xml","fileBase64":"<裸base64>"}],"userAccount":"<userAccount>","isSave":1,"collectWay":4,"uploadMode":0}'
```

**参数约束**：
- `filesMap` 必填，非空数组；每个元素必须包含 `fileName` 和 `fileBase64`
- `fileName` 必须带后缀名，长度不超过 50
- `fileBase64` 必须为裸 base64，不得带文件格式说明或 data URI 前缀
- `userAccount` 必填，由 WorkBuddy 注入 `BAIWANG_IMAGE_RECOGCOLLECT_USER_ACCOUNT` 或脚本参数传入
- `isSave` 默认传 `1`，表示不入库，仅用于识别
- `collectWay` 默认传 `4`，表示接口采集

**返回字段提取**：从返回的 `response[].mediaInvoiceList[]` 中提取 `invoiceCode`、`invoiceNo`/`electronicNo`、`invoiceDate`、`totalAmount`、`amountTax`、`checkCode`、`saleName`、`saleTaxNo`、`purchaserName`、`purchaserTaxNo`，再按 SKILL.md 的字段标准化规则映射为验真参数。

`recogcollect_file.py` 默认不输出原始 MCP 大响应，而是输出稳定结构：

```json
{
  "success": true,
  "items": [
    {
      "invoice_payload": {},
      "verify_params": {},
      "risk_input": {},
      "decision": {}
    }
  ]
}
```

当 `success=false` 时，输出中会包含 `fallback.type = "llm_multimodal_recognition"`。Agent 必须降级为 LLM 多模态/Read 识别文件四要素，再按字段标准化规则继续后续验真流程。

## 四要素直通验真（Step 2b · 场景 B/E）

第四项参数按 `SKILL.md` 主规则自动适配：先判断纯数电票，再按发票名称关键字分组选择 `totalAmount` 或 `checkCode_6`。严禁仅根据 `invoiceType` 编码决策，完整规则见 [ocr_to_verify_type_mapping.md](ocr_to_verify_type_mapping.md)。

**不含税金额类**（`01` 增值税专用发票 / `03` 机动车 / `08` 电子专票 / `85` 数电纸质专票 / `87` 数电纸质机动车）：

```bash
python scripts/call_mcp.py call BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL baiwang.input.compliance.validate \
  --params '{"invoiceCode": "044002100311", "invoiceNumber": "24891456", "billingDate": "2025-03-15", "totalAmount": "12800.00", "taxNo": "<PLATFORM_TAXNO>"}'
```

**校验码类**（`04` 普票 / `10` 电子普票 / `11` 卷票 / `14` 通行费 / `86` 数电纸质普票）：

```bash
python scripts/call_mcp.py call BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL baiwang.input.compliance.validate \
  --params '{"invoiceCode": "044002100311", "invoiceNumber": "24891456", "billingDate": "2025-03-15", "checkCode_6": "123456", "taxNo": "<PLATFORM_TAXNO>"}'
```

**数电各票种**（`31/32/51/59/61/83`）— `totalAmount` = 价税合计，无 invoiceCode：

```bash
python scripts/call_mcp.py call BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL baiwang.input.compliance.validate \
  --params '{"invoiceNumber": "24000000000000000001", "billingDate": "2025-03-15", "totalAmount": "13600.00", "taxNo": "<PLATFORM_TAXNO>"}'
```

**车价合计类**（`15/84/88` 二手车）：

```bash
python scripts/call_mcp.py call BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL baiwang.input.compliance.validate \
  --params '{"invoiceCode": "044002100311", "invoiceNumber": "24891456", "billingDate": "2025-03-15", "totalAmount": "50000.00", "taxNo": "<PLATFORM_TAXNO>"}'
```

## 文件夹批量验真（Step 2c · 场景 F）

批量场景下，每张发票**独立调用**验真接口，`taxNo` 统一使用固定值，**不因销方不同而变化**：

```bash
# 发票1：泰州市飞鹿客运有限公司（销方税号 91321200730694825D）
python scripts/call_mcp.py call BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL baiwang.input.compliance.validate \
  --params '{"invoiceNumber": "24322000000506085871", "billingDate": "2024-12-14", "totalAmount": "25.00", "taxNo": "<PLATFORM_TAXNO>"}'

# 发票2：任丘市华睿立远房地产开发有限公司（销方税号 91130982MA0E8T3NXG）
python scripts/call_mcp.py call BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL baiwang.input.compliance.validate \
  --params '{"invoiceNumber": "24132000000180836745", "billingDate": "2024-12-03", "totalAmount": "125000.00", "taxNo": "<PLATFORM_TAXNO>"}'
```

> ⚠️ **关键区别**：验真接口 `taxNo` = 平台固定值（见 mcp-config.json → platform.taxNo，所有发票相同）；风险查询 `data.taxpayercode` = 销方实际税号（每张发票不同）。两者**不可互换**。

## 灰名单检测（Step 4a）

**⚠️ 参数格式约束（严格遵循，不得多嵌套）**：
```json
// ✅ 正确格式
{
  "taxNo": "<PLATFORM_TAXNO>",
  "data": {
    "taxpayer": "销方名称",
    "taxpayercode": "销方税号"
  }
}

// ❌ 错误格式（会导致校验失败或自动修正）
{
  "taxNo": "",                        // 空字符串 → 自动注入
  "data": {...}
}
{
  "taxNo": "销方税号",                // 错误值 → 强制修正为平台标识
  "data": {...}
}
{
  "data": {"data": {...}}             // 双重嵌套 → 校验失败
}
{
  "taxpayer": "...",                  // 缺少 taxNo → 自动注入并包装
  "taxpayercode": "..."
}
```

**参数校验与自动修正**：
- `taxNo` **必填且非空**，必须为平台标识，**严禁使用销方税号**
  - 缺失 → 自动注入 PLATFORM_TAXNO
  - 空字符串 → 自动注入 PLATFORM_TAXNO
  - 错误值（如销方税号） → 强制修正为 PLATFORM_TAXNO
- `data` **必填**，必须为对象类型
  - 缺失 → 自动包装原始参数
- `taxpayer` 和 `taxpayercode` 必须在 `data` 对象内部，**不得出现双重嵌套**
- 名称和税号至少填写一个

```bash
python scripts/call_mcp.py call BAIWANG_COUNTERPARTY_RISK_URL baiwang.dataasset.risktag.queryTaxnogrey \
  --params '{"taxNo": "<PLATFORM_TAXNO>", "data": {"taxpayer": "销方名称", "taxpayercode": "销方税号"}}'
```

## 欠税信息查询（Step 4b）

**⚠️ 参数格式约束（严格遵循，不得多嵌套）**：
```json
// ✅ 正确格式
{
  "taxNo": "<PLATFORM_TAXNO>",
  "data": {
    "taxpayer": "销方名称",
    "taxpayercode": "销方税号"
  }
}

// ❌ 错误格式（会导致校验失败或自动修正）
{
  "taxNo": "",                        // 空字符串 → 自动注入
  "data": {...}
}
{
  "taxNo": "销方税号",                // 错误值 → 强制修正为平台标识
  "data": {...}
}
{
  "data": {"data": {...}}             // 双重嵌套 → 校验失败
}
{
  "taxpayer": "...",                  // 缺少 taxNo → 自动注入并包装
  "taxpayercode": "..."
}
```

**参数校验与自动修正**：
- `taxNo` **必填且非空**，必须为平台标识，**严禁使用销方税号**
  - 缺失 → 自动注入 PLATFORM_TAXNO
  - 空字符串 → 自动注入 PLATFORM_TAXNO
  - 错误值（如销方税号） → 强制修正为 PLATFORM_TAXNO
- `data` **必填**，必须为对象类型
  - 缺失 → 自动包装原始参数
- `taxpayer` 和 `taxpayercode` 必须在 `data` 对象内部，**不得出现双重嵌套**
- 名称和税号至少填写一个

```bash
python scripts/call_mcp.py call BAIWANG_COUNTERPARTY_RISK_URL baiwang.dataasset.risktag.queryTaxArrearsInfo \
  --params '{"taxNo": "<PLATFORM_TAXNO>", "data": {"taxpayer": "销方名称", "taxpayercode": "销方税号"}}'
```

## 重大税收违法查询（Step 4c）

**⚠️ 参数格式约束（严格遵循，不得多嵌套）**：
```json
// ✅ 正确格式
{
  "taxNo": "<PLATFORM_TAXNO>",
  "data": {
    "taxpayer": "销方名称",
    "taxpayercode": "销方税号"
  }
}

// ❌ 错误格式（会导致校验失败或自动修正）
{
  "taxNo": "",                        // 空字符串 → 自动注入
  "data": {...}
}
{
  "taxNo": "销方税号",                // 错误值 → 强制修正为平台标识
  "data": {...}
}
{
  "data": {"data": {...}}             // 双重嵌套 → 校验失败
}
{
  "taxpayer": "...",                  // 缺少 taxNo → 自动注入并包装
  "taxpayercode": "..."
}
```

**参数校验与自动修正**：
- `taxNo` **必填且非空**，必须为平台标识，**严禁使用销方税号**
  - 缺失 → 自动注入 PLATFORM_TAXNO
  - 空字符串 → 自动注入 PLATFORM_TAXNO
  - 错误值（如销方税号） → 强制修正为 PLATFORM_TAXNO
- `data` **必填**，必须为对象类型
  - 缺失 → 自动包装原始参数
- `taxpayer` 和 `taxpayercode` 必须在 `data` 对象内部，**不得出现双重嵌套**
- 名称和税号至少填写一个

```bash
python scripts/call_mcp.py call BAIWANG_COUNTERPARTY_RISK_URL baiwang.dataasset.risktag.selectViolationInfo \
  --params '{"taxNo": "<PLATFORM_TAXNO>", "data": {"taxpayer": "销方名称", "taxpayercode": "销方税号"}}'
```

## call_mcp.py 内部百望云请求格式说明

本节只说明 `scripts/call_mcp.py` 内部如何适配百望云平台请求格式，**不是 agent 的执行路径**。Agent 不得绕过 `call_mcp.py` 直接请求百望 URL。

百望云平台的正确请求格式：**method 名放 query string，body 为纯 params JSON**（不走 JSON-RPC包装）。

```python
import json, ssl
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from urllib.request import Request, urlopen

def call_baiwang(base_url, method_name, params):
    """百望云平台直接调用。

    base_url 示例: https://sandbox-openapi.baiwang.com/mcp/wukong/lctoolscall?key=xxx
    method_name: 如 baiwang.input.compliance.validate
    params: 纯参数 dict，如 {"invoiceNumber": "24891456", ...}
    """
    parsed = urlparse(base_url)
    qs = parse_qs(parsed.query)
    qs["method"] = [method_name]
    new_query = urlencode(qs, doseq=True)
    url = urlunparse((parsed.scheme, parsed.netloc, parsed.path,
                      parsed.params, new_query, parsed.fragment))
    data = json.dumps(params).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    ssl_ctx = ssl.create_default_context()
    with urlopen(req, timeout=30, context=ssl_ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))
```

> ⚠️ **沙箱环境限制**：沙箱 appKey 可能返回 `[100006] 该appKey无权操作此税号信息`，表示当前 appKey 未被授权操作该税号。需联系百望管理员在正式环境授权后重试。
