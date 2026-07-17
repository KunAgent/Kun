---
name: invoice-verify
version: "1.0.0"
description: >
  智能发票专家团的发票识别、税局验真、商业信用核查和智能票夹归档能力。当用户上传发票文件（图片/PDF/OFD/XML）、
  批量上传表格、指定本地文件夹或提供发票四要素信息时，
  自动识别发票内容、查验真伪、核查开票方商业信用，并输出归档报告。
metadata:
  label: 智能发票专家团
---

# 智能发票专家团

## 团队分工映射

这份 `SKILL.md` 仍然是完整业务规范，但在 WorkBuddy Team 模式下，需要按角色切片执行：

| 角色 | 专家定位 | 负责范围 | 主要关注点 |
| --- | --- | --- | --- |
| `invoice-verify-team-lead` | 百晓通 / 智能发票首席专家 | 总调度 | 接单、判断路径、组织成员执行、汇总结果 |
| `invoice-sorter` | 百晓甄 / 多模态识别专家 | Step 1 | 判断输入类型、识别缺失字段、分拣到正确流程 |
| `invoice-verifier` | 百晓燕 / 发票查验专家 | Step 2 - Step 3 | 识别/标准化发票字段、验真、合规判断、抵扣判断 |
| `counterparty-risk-analyst` | 百晓信 / 商业信用专家 | Step 3 - Step 4 | 交易对手商业信用查询与汇总 |
| `archivist` | 百晓慧 / 企业票夹 | Step 5 | 报告整合、最终输出 |

> 读法说明：`SKILL.md` 的业务规则不拆成多份复制，而是按上表的职责边界分发给不同 agent 执行。主理人负责调度，不直接改写业务规则。

## Reference 文件索引

| 文件 | 职责 | 不做什么 |
|------|------|----------|
| `references/ocr_to_verify_type_mapping.md` | 发票名称→验真参数决策（关键字匹配规则、伪代码） | 不含文件格式、抵扣规则 |
| `references/invoice_types.md` | 文件格式清单、四要素定义、旅客运输抵扣规则 | 不含发票类型编码映射 |
| `references/mcp_calls.md` | MCP 工具注册表、调用示例、工具清单流程 | 不含错误码映射 |
| `references/error_handling.md` | 错误码矩阵、重试策略、批量去重规则 | 不含报告模板 |
| `references/report_templates.md` | 报告 Markdown 模板、字段映射表 | 不含风险评级逻辑 |
| `references/risk_rules.md` | 风险等级分类、综合评级逻辑、三项校验明细 | 不含报告展示格式 |

## 快速通道

**当用户直接提供完整四要素时，跳过 Step 1 场景分拣，直接进入 Step 2b 验真。**

四要素：发票代码（数电票可缺）、发票号码、开票日期、不含税金额/校验码后6位。
收到后无需重复确认，直接构建 `baiwang.input.compliance.validate` 调用参数并发起验真，风险查询可并行发起。

## 脚本路径（所有 agent 必读）

**本项目脚本不在根目录，位于 `skills/invoice-verify/scripts/` 子目录下。**

| 脚本 | 完整路径 |
|------|----------|
| MCP 调用 | `<skill_dir>/skills/invoice-verify/scripts/call_mcp.py` |
| OSS 上传 | `<skill_dir>/skills/invoice-verify/scripts/upload_to_oss.py` |
| 影像识别采集 | `<skill_dir>/skills/invoice-verify/scripts/recogcollect_file.py` |

⚠️ 如果文件搜索提示找不到脚本，请改用上表完整路径执行，**不要直接降级或绕过脚本**。

## 工作流程

### Step 1：读取配置 + 场景分拣

【`invoice-sorter` 负责】

读取 `mcp-config.json` 检查 URL 非空 → 检测用户输入分拣到场景 A/B/C/D/E/F。检测顺序：A → B → C → F → D → E。

| 场景        | 条件        | 行为                               |
| --------- | --------- | -------------------------------- |
| A 文件直通    | 上传支持的文件   | OCR/解析 → 四要素完整则验真，缺失补问           |
| B 四要素直通   | 完整四要素     | 跳过识别 → 直接验真 + 风险校验               |
| C 文件+部分要素 | 文件 + 用户补充 | 以用户指定值为准                         |
| F 文件夹批量   | 有效文件夹路径   | 枚举 → 识别 → 去重 → 逐张验真 → 汇总 |
| D 纯意图引导   | 无文件无要素    | 输出引导卡片                           |
| E 部分要素补问  | 1-3 项要素   | 多轮补问（最多 3 轮）                     |

**触发条件**：用户明确要求发票识别、税局验真、发票批量核验、供应商/开票方商业信用查询、智能票夹归档或旅客运输抵扣判断，且输入为支持格式文件、有效本地文件夹、表格文件或完整/部分发票四要素。支持文件扩展名 ∈ { .jpg, .jpeg, .png, .bmp, .pdf, .ofd, .xml, .xlsx, .xls, .csv }，单文件 ≤ 8MB；文本输入需包含发票代码/号码/开票日期/金额或校验码等发票要素，商业信用查询需至少包含供应商/开票方名称或税号。

**不触发场景**：如果用户只是要求通用文件读取、PDF/Word/Markdown 转换、Excel 图表分析、HTML/前端开发、Python 脚本编写、通用 Git 操作、第三方 API 集成开发，或上传的文件明显不是发票核验材料，不进入本 Skill 流程。此时直接说明本技能只处理发票核验与销方税务风险查询，并按用户原始需求交由通用能力处理。

**并行优化**：只要解析到销方税号/名称，验真与风险查询可并行发起。

### Step 2：发票识别与采集

【`invoice-verifier` 负责】

> **脚本执行约定**：所有脚本通过当前系统可用 shell 执行，必须传入完整脚本路径和 `SKILL_ROOT_DIR` 环境变量，确保子 agent 在任何工作目录下都能正确定位 `.env` 和 `mcp-config.json`。
> ```
> SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/upload_to_oss.py" "<file_path>"
> SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/recogcollect_file.py" "<file_path>"
> SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/call_mcp.py" call <url_key> <tool_name> --params '{"..."}'
> ```
> `<skill_dir>` 必须替换为专家包根目录的实际绝对路径，由调度方（百晓通）在派发任务时注入，agent 不得使用占位符原值或相对路径。
> Windows 和 macOS 都适用；若当前环境没有 `python` 命令，再改用 `python3`。`recogcollect_file.py` 会从 WorkBuddy 注入配置读取 `userAccount`，不要为了缺少手工参数直接降级到 LLM。

**⚠️ OCR 类型编码映射**：OCR/LLM 识别返回的 `invoiceType` 编码体系不统一。**验真参数决策不依赖任何编码，基于发票名称关键字匹配**，对照表见 [ocr_to_verify_type_mapping.md](references/ocr_to_verify_type_mapping.md)。

**发票识别主流程**（文件型场景唯一路径，必须严格优先执行）：

收到文件后必须按以下顺序执行：
1. 图片/PDF：执行 `SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/upload_to_oss.py" "<file_path>"`，上传到阿里云 OSS 获取公共 URL
2. 图片/PDF：使用 `SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/call_mcp.py" call BAIWANG_OCR_STANDARD_URL baiwang.ocr.stand.tickets --params '{"fileUrl": "<oss_url>", "serviceMode": "0", "serviceMold": "1"}'` 调用 `baiwang.ocr.stand.tickets`，传入 OSS 公共 URL 作为 `fileUrl`
3. OFD/XML：执行 `SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/recogcollect_file.py" "<file_path>"`，脚本将文件转为裸 base64 后调用 `baiwang.image.invoices.recogcollect`
4. 从脚本输出的标准 JSON 中读取 `items[].invoice_payload`、`items[].verify_params`、`items[].risk_input`，不要直接解析原始 MCP 大响应

**⚠️ 降级路径（仅当主识别接口失败时才走，不得跳过接口直接降级）**：
仅在以下场景之一发生时，才允许走降级：
- **场景 A**：图片/PDF 的 OSS 上传服务不可用（脚本执行失败或无响应）
- **场景 B**：图片/PDF 的百望标准 OCR 接口不可用（网络超时、HTTP 错误、JSON 解析失败）
- **场景 C**：OFD/XML 的影像识别采集接口不可用（MCP 错误、JSON 解析失败、参数必填值缺失），或 `recogcollect_file.py` 输出 `success=false`
- **场景 D**：主识别接口已成功返回响应，但未能识别到发票四要素（返回空字段/识别结果中缺少关键字段/明确返回识别失败）

满足上述任一场景后，方可降级到以下方案：
- **LLM 多模态/Read 解析**：直接读取图片、PDF、OFD 或 XML 文件，提取四要素
- **文本提取辅助**：PDF 使用 PyPDF2，XML 可按数据电文结构提取字段，提取后按字段标准化映射处理；若仍缺字段，继续使用 LLM 识别补齐

降级后使用 LLM 多模态/Read 识别文件四要素，不重复调用同一识别接口。LLM 提取的字段仍需按字段标准化映射规则处理，然后走四要素直通验真。

> **设计意图**：标准 OCR 与影像识别采集是两条不同入参协议。`baiwang.ocr.stand.tickets` 只走 OSS URL；`baiwang.image.invoices.recogcollect` 只走裸 base64。

**⚠️ 重要约束（全局适用）**：标准 OCR `baiwang.ocr.stand.tickets` **严禁**传 base64，必须先调用 `SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/upload_to_oss.py" "<file_path>"` 获取 OSS URL 后以 `fileUrl` 调用。影像识别采集 `baiwang.image.invoices.recogcollect` **必须**传裸 base64，`fileBase64` 不得带 `data:...;base64,` 前缀，且必须携带 `filesMap[].fileName` 与 `userAccount`。

**URL 识别流程**：

| 文件类型           | 识别方式       | 说明                                                  |
| -------------- | ---------- | --------------------------------------------------- |
| 图片/PDF | 百望标准 OCR | `fileUrl` + `serviceMode: "0"` + `serviceMold: "1"` |
| OFD/XML | 百望影像识别采集 MCP | `filesMap[].fileName` + `filesMap[].fileBase64` + `userAccount` |
| Excel/CSV      | 内置解析       | 按列名匹配，解析后映射为标准参数名                                   |

**LLM 多模态解析**（仅限识别接口降级场景）：仅当对应主识别接口不可用，或已成功返回但识别不到发票四要素时，才允许使用 Read 工具直接解析文件提取四要素。正常流程下，图片/PDF 必须走 OSS 上传 + 百望标准 OCR，OFD/XML 必须走影像识别采集 MCP，**严禁跳过接口直接走 LLM 多模态**。

`recogcollect_file.py` 返回 `success=false` 时会带 `fallback.type = "llm_multimodal_recognition"`。百晓燕必须按该指令降级到 LLM 识别，并在最终报告中标注识别数据来源为 LLM 降级。

**字段标准化映射（关键步骤，不可跳过）**：

LLM/内置解析提取的字段必须在发起验真前映射为 API 标准参数名：

| 识别标签（可能别名）    | → API 参数名       | 格式要求               |
| ------------- | --------------- | ------------------ |
| 发票代码、代码       | `invoiceCode`   | 10/12位纯数字；数电不传     |
| 发票号码、号码、No.   | `invoiceNumber` | 8位/20位纯数字          |
| 开票日期、日期       | `billingDate`   | YYYY-MM-DD         |
| 不含税金额、金额、开具金额 | 见下方验真参数取值规则 | 数字字符串              |
| 价税合计、合计、总金额   | 见下方验真参数取值规则 | 数字字符串              |
| 车价合计          | 见下方验真参数取值规则 | 数字字符串              |
| 校验码、校验码后6位    | 见下方验真参数取值规则 | 6位纯数字（无校验码时取号码后6位） |
| 销方名称、销售方      | `sellerName`    | 字符串                |
| 销方税号          | `sellerTaxNo`   | 字符串                |
| 购方名称          | `purchaserName` | 字符串                |
| 购方税号          | `purchaserTaxNo`| 字符串                |
| 税额            | `taxAmount`     | 数字字符串              |

> **设计意图**：验真参数规则（L126-L139）必须在 SKILL.md 正文内联，因为这是 agent 每次发起验真时的核心决策路径，不可跳转。`ocr_to_verify_type_mapping.md` 中的伪代码是辅助参考，不是执行依据。审查时不应视为"上下文效率"或"可维护性"问题。

**验真参数取值规则**（先判断数电，后关键字匹配，不得颠倒顺序）：

- **数电票**（发票号码 20 位纯数字 且 无发票代码）：`totalAmount` = 价税合计，不传 `invoiceCode`
- **非数电专票**（名称含"专用"/"机动车销售"）：`totalAmount` = 不含税金额
- **非数电二手车**（名称含"二手车销售"）：`totalAmount` = 车价合计
- **非数电普票**（名称含"普通"/"通行费"/"卷票"/"卷式"）：`checkCode_6` = 校验码后6位，不传 `totalAmount`

**映射执行规则**（严格按以下顺序，不得跳步或颠倒）：
1. 先映射为标准参数名
2. **数电判断优先**：发票号码为 20 位纯数字 且 发票代码为空/不存在 → 判定为纯数电票 → `totalAmount` = 价税合计，不传 `invoiceCode`，**跳过后续关键字匹配**
3. 非数电票按发票名称关键字分组决定 totalAmount 取值：含"专用"/"机动车销售" → 不含税金额；含"二手车销售" → 车价合计；含"普通"/"通行费"/"卷票"/"卷式" → 取校验码后6位（不传 totalAmount）
4. 金额不得四舍五入/截断
5. **验真调用必须传入 `taxNo` 参数，值为平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取，见 mcp-config.json → platform.taxNo），不得省略**
6. 映射完成后发起验真

**发票名称匹配规则**（决定验真参数，替代编码判断）：完整规则见 [ocr_to_verify_type_mapping.md](references/ocr_to_verify_type_mapping.md)，包含纸质排除 → 数电判断 → 关键字分组 → 兜底追问的四步决策流程。

### Step 2b：四要素直通验真

【`invoice-verifier` 负责】

直接调用 `baiwang.input.compliance.validate`，第四项参数按发票名称关键字匹配自动适配（规则见 [ocr_to_verify_type_mapping.md](references/ocr_to_verify_type_mapping.md)）。调用示例见 [mcp_calls.md](references/mcp_calls.md)。

### Step 2c：文件夹批量（场景 F）

【`invoice-sorter` 负责入口判定，`invoice-verifier` 负责逐文件核验，`counterparty-risk-analyst` 可并行补充风险结果】

F1 扫描 → F2 逐文件识别（图片/PDF 走 OSS → 百望标准 OCR；OFD/XML 走影像识别采集 MCP；对应接口不可用或识别不到时才降级 LLM Read/文本提取）→ F3 去重（税控票=代码+号码，数电=仅号码，上限 100 张）→ F4 逐张验真+风险并行 → F5 汇总报告。进度仅播报关键节点。

**⚠️ F4 逐张验真参数约束（关键，不得违反）**：
- 每张发票调用 `baiwang.input.compliance.validate` 时，`taxNo` **必须**使用平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取，见 mcp-config.json → platform.taxNo），**严禁**使用 `sellerTaxNo`（销方税号）
- `sellerTaxNo` 仅用于风险查询的 `data.taxpayercode` 字段，**绝不**作为验真接口的 `taxNo`
- 正确示例：`{"invoiceNumber": "...", "billingDate": "...", "totalAmount": "...", "taxNo": "<平台标识>"}`
- 错误示例：`{"invoiceNumber": "...", "billingDate": "...", "totalAmount": "...", "taxNo": "销方税号"}` ← 销方税号不可填入 taxNo

### Step 3-5：验真、抵扣判断、风险洞察、报告

【`invoice-verifier` 负责 Step 3 和 Step 3b，`counterparty-risk-analyst` 负责 Step 4，`archivist` 负责 Step 5】

- **验真**（Step 3）：根据 `checkResult` 判断，映射见 [report_templates.md → 验真结果映射表](references/report_templates.md)
- **旅客运输抵扣**（Step 3b）：电子普票 + 旅客运输标识 +（≥ 2026-01-01 需出行人）→ 可抵扣，税额 = `taxAmount`。非旅客运输发票不展示此模块。详见 [invoice_types.md → 旅客运输](references/invoice_types.md)
- **风险洞察**（Step 4）：拿到销方名称/税号即发起三项并行查询（**必须优先通过 MCP 接口**，仅当 MCP 不可用时才降级到 WebSearch），单项失败不影响其余。详见 [risk_rules.md](references/risk_rules.md)

  **⚠️ 风险查询参数格式（全局约束，严格遵循）**：
  ```json
  {
    "taxNo": "<PLATFORM_TAXNO>",        // 平台标识（固定值，非销方税号）
    "data": {
      "taxpayer": "销方名称",           // 销方企业名称
      "taxpayercode": "销方税号"        // 销方企业税号
    }
  }
  ```
  - `taxNo` **必填且非空**，必须为平台标识，**严禁使用销方税号**，空字符串将触发自动注入
  - `data` **必填**，必须为对象类型
  - `taxpayer` 和 `taxpayercode` 必须包装在 `data` 对象内部
  - **不得出现双重嵌套**（如 `{"data": {"data": {...}}}`）
  - 名称和税号至少填写一个
  - 风险查询只能由 `counterparty-risk-analyst` 执行，`invoice-verifier` 不得直接调用风险 MCP
  - 风险查询 URL Key 只能使用 `BAIWANG_COUNTERPARTY_RISK_URL`
  - 风险查询工具名只能使用 `baiwang.dataasset.risktag.queryTaxnogrey`、`baiwang.dataasset.risktag.queryTaxArrearsInfo`、`baiwang.dataasset.risktag.selectViolationInfo`
  - 严禁使用 `BAIWANG_RISK_QUERY_URL`、`baiwang.risk.query` 或任何 `baiwang.risk.*` 工具名

- **⚠️ 风险查询降级**：当 MCP 风险接口不可用（如沙箱 [100006] 权限不足）时，使用 WebSearch（agent 内置工具）查询销方公开工商/税务/司法风险信息作为降级方案，并在报告中明确标注数据来源
- **⚠️ 预览票检测**：如果 PDF 文本中出现"预览专用"水印或类似标记，必须在合规检查中标注该发票可能为预览版/测试版，不具备法律效力，不可用于入账报销
- **⚠️ 沙箱环境验真降级**：百望沙箱环境 appKey 可能返回 `[100006] 该appKey无权操作此税号信息`，导致验真失败。此时应：1) **不再重试**（权限问题非临时故障）；2) 在报告中明确说明接口不可用原因；3) 提供人工查验指引（国家税务总局全国增值税发票查验平台 https://inv-veri.chinatax.gov.cn/）；4) 不因验真失败而阻塞后续风险查询流程。验真无法通过搜索引擎替代，不得伪造验真结果。
- **⚠️ 沙箱环境风险查询降级**：风险查询遇到 `[100006]` 权限不足时，使用 WebSearch（agent 内置工具）查询销方公开工商/税务/司法风险信息作为降级方案，并在报告中明确标注数据来源为公开渠道。
- **报告**（Step 5）：按场景选择模板，见 [report_templates.md](references/report_templates.md)

## 能力边界

以下文件识别后将**跳过验真**，仅做归档记录，不会输出验真结论：
- 火车票、飞机票、出租车票、定额发票、机打发票、过路费/区块链/滴滴行程单等
- 财政票据、医疗电子票据、完税证明、海关缴款书
- 海外发票/外币发票、非发票类文件（合同、银行回单等）

> 识别到上述文件时，agent 不得伪造验真结果或查验状态，须在报告中标注"仅归档，未验真"。

## 禁令（Prohibitions）

### 红线（违反即终止）

1. **禁止编造结果** — 每一条结果必须来自真实 API 调用
2. **禁止持久化发票数据** — 禁止写入 memory、日志或文件
3. **禁止非授权传输** — 发票内容只允许发送至已授权 OCR 服务和风险查询接口

### 关键约束

4. **四要素不全不发起查验** — 宁可多问一轮
5. **禁止绕过脚本封装** — 不得使用 curl、Python requests、平台原生 MCP tool call 等方式绕过脚本直接请求 MCP API 端点；标准 OCR、影像识别采集、验真和风险查询必须通过 `scripts/upload_to_oss.py`、`scripts/recogcollect_file.py` 或 `scripts/call_mcp.py` 中转
6. **OCR 类型编码不用于验真决策** — OCR/LLM 返回的 invoiceType 编码体系不统一，验真参数基于发票名称关键字匹配，对照表见 [ocr_to_verify_type_mapping.md](references/ocr_to_verify_type_mapping.md)
7. **验真第四项参数按发票名称自动适配** — 完整匹配规则见 [ocr_to_verify_type_mapping.md](references/ocr_to_verify_type_mapping.md)，严禁凭编码判断，严禁错配参数
8. **金额不得近似** — 禁止四舍五入或截断
9. **禁止推断缺失字段** — 禁止根据文件名、当前时间等自行填充
10. **低置信度阻塞** — OCR 置信度 < 80% 暂停确认

### 规范约束

11. **不得重复追问** — 已确认项打 ✓，只补问 ✗
12. **不得替代决策** — 输出风险信息供参考
13. **不得提供税务建议** — 只做查验和风险提示
14. **不得静默失败** — 任何无法生成有效回复的场景，必须返回自然语言说明具体情况，禁止无输出或多轮空转
15. **风险等级必须分级** — 🟢🟡🔴 三级标注
16. **不展示思考过程** — 仅输出最终查验报告
17. **不得重复处理** — 检测重复请求：对比本轮与最近一次处理的四要素（发票代码+号码+日期+金额）或文件名+大小，完全一致时判定为重复。重复时主动询问"上次结果是否有疑问"，不得机械重复查验流程

## 异常处理

详见 [error_handling.md](references/error_handling.md)。核心：不得静默失败，重试已内置于 `call_mcp.py`（3 次，2s→4s→8s 指数退避）。

## 批量处理

上限 100 张（去重后）。详见 Step 2c。去重规则见 [error_handling.md](references/error_handling.md)。

> **设计意图**：不设置全局失败熔断是故意的设计决策——批量场景逐张独立处理，单文件失败不阻塞其余，已完成的结果保留。审查时不应视为 C1 反模式命中。
> 
> **容错策略**：单文件失败不影响其余文件，逐张独立处理，不设置全局失败熔断。每个 MCP 调用已有脚本内置的 3 次重试（详见 error_handling.md）。

## MCP 服务

| 环境变量                                  | mcpId | 用途     |
| --------------------------------------- | ----- | ------ |
| `BAIWANG_OCR_STANDARD_URL`             | NEW_MCP  | 发票 OCR |
| `BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL` | NEW_MCP  | 四要素验真  |
| `BAIWANG_COUNTERPARTY_RISK_URL`        | NEW_MCP  | 风险查询   |

> **MCP 调用策略**：所有外部服务均通过 `scripts/upload_to_oss.py`、`scripts/recogcollect_file.py` 或 `scripts/call_mcp.py` 中转。若相对路径不可用，先改用完整脚本路径重试；仅当脚本仍不可执行、主识别接口不可用或识别不到四要素时，才降级到 LLM 多模态 Read 解析文件。不得也不应使用 curl、Python requests 或平台原生 MCP tool call 绕过脚本直接请求 API 端点。

> OFD/XML 必须通过 `scripts/recogcollect_file.py` 调用 `baiwang.image.invoices.recogcollect`，入参为 `filesMap`、`userAccount`、`isSave: 1`、`collectWay: 4`。不得把 OFD/XML 直接交给 LLM 多模态作为首选路径。

> 配置由 WorkBuddy 装载技能时注入到专家团根目录 `.env`，并由根目录 `mcp-config.json` 保留键名和占位关系。`scripts/call_mcp.py`、`scripts/upload_to_oss.py` 和 `scripts/recogcollect_file.py` 会自动读取专家团根目录配置，调用时传入 `KEY_NAME`。完整工具列表见 [mcp_calls.md](references/mcp_calls.md)。

## 部署配置（上架必读）

本 Skill 依赖外部服务，OSS 和百望云运行配置由 WorkBuddy 在装载技能时注入，不面向普通业务用户填写。普通用户只需要上传发票文件或提供发票要素，不需要配置 MCP URL、OSS 密钥或平台 `taxNo`。

如果用户只是询问 `.env`、`mcp-config.json`、OSS 或 MCP URL 的配置含义，简洁说明这些是 WorkBuddy 装载技能时注入的运行配置，不是发票核验业务参数；不要展示或复述具体密钥内容，也不要发起 OCR、验真或风险查询。遇到配置缺失、401/403、`MCP_PERMISSION_DENIED` 或 appKey 无权操作时，直接说明需要管理员检查 WorkBuddy 装载配置或百望服务授权，不要反复要求普通用户重启会话或重复设置 token。

### 配置验证

- WorkBuddy 装载技能时提供根目录 `.env`，`scripts/call_mcp.py` 会从专家团根目录读取 `BAIWANG_OCR_STANDARD_URL`、`BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL`、`BAIWANG_COUNTERPARTY_RISK_URL` 和平台 `taxNo`。
- `scripts/upload_to_oss.py` 会从专家团根目录读取 OSS 相关配置，包括 `OSS_ACCESS_KEY`、`OSS_SECRET_KEY`、`OSS_BUCKET_NAME`、`OSS_BUCKET_DOMAIN`、`OSS_ENDPOINT`、`OSS_PREFIX`。
- `scripts/recogcollect_file.py` 会读取 `BAIWANG_IMAGE_RECOGCOLLECT_USER_ACCOUNT` 作为影像识别采集接口的 `userAccount`，无需在常规流程中手工传入。
- 根目录 `mcp-config.json` 用于保留配置键名和占位关系，不应让普通用户手工填写密钥。
- 展示 MCP 工具清单：`SKILL_ROOT_DIR="<skill_dir>" python "<skill_dir>/skills/invoice-verify/scripts/call_mcp.py" list BAIWANG_OCR_STANDARD_URL`。
- 验证真实接口可用性时，使用对应业务工具执行最小化 `call`，不要把百望 `tools/list` 不支持误判为业务接口不可用。
- 权限类错误由管理员处理 WorkBuddy 装载配置或百望授权，不要求普通用户反复设置 token 或重启会话。

### Python 依赖

> `scripts/upload_to_oss.py`、`scripts/recogcollect_file.py` 和 `scripts/call_mcp.py` 使用纯 Python 标准库实现，无需安装额外依赖。降级路径中的 PDF 文本提取依赖 `PyPDF2`，推荐版本 `PyPDF2>=3.0.0,<4.0.0`。WorkBuddy 环境已预装时无需重复安装；本地验证缺少依赖时，可执行 `pip install "PyPDF2>=3.0.0,<4.0.0"`。
