# 智能发票专家团

五位 AI 专家接力协作，通过上传发票文件、批量上传表格或指定本地文件夹，智能识别、税局验真、信用核查、自动归档，发票处理实现一步到位。

擅长领域：识别验真 · 商业信用 · 智能票夹

## 一、功能介绍

### 1.1 能解决什么问题

在发票处理流程中，用户可以上传支持格式的发票文件、批量上传表格、指定本地文件夹，或直接提供发票四要素。专家团会按技能包内置流程分拣输入、识别字段、准备验真参数、调用百望 MCP 服务进行税局验真，并在获取开票方名称或税号后查询商业信用风险。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 单张发票核验 | 对 `.jpg`、`.jpeg`、`.png`、`.bmp`、`.pdf` 执行 OSS OCR；对 `.ofd`、`.xml` 优先调用百望影像识别采集 MCP，随后完成字段标准化和发票验真 |
| 四要素直通验真 | 用户提供完整四要素时，跳过文件识别流程，直接构建 `baiwang.input.compliance.validate` 入参并发起验真 |
| 文件夹批量核验 | 对有效文件夹内的支持格式文件逐张识别、去重、验真和汇总；去重后最多处理 100 张发票 |
| 表格批量解析 | 对 `.xlsx`、`.xls`、`.csv` 按列名匹配发票字段，映射为标准参数后进入验真流程 |
| 交易对手风险查询 | 拿到销方名称或销方税号后，查询灰名单、欠税信息和重大税收违法信息，并按规则输出风险等级 |
| 旅客运输抵扣判断 | 仅在识别到电子发票（普通发票）且包含旅客运输服务标识时展示抵扣判断模块 |
| 异常处理报告 | 对字段缺失、识别失败、接口异常、权限不足、查验次数超限、低置信度识别等情况输出明确说明 |

### 1.3 团队角色

| 角色 | 专家定位 | 文件 | 职责 |
|------|----------|------|------|
| 百晓通 | 智能发票首席专家 | `agents/invoice-verify-team-lead.md` | 接单、确认任务边界、编排成员、汇总结果 |
| 百晓甄 | 多模态识别专家 | `agents/invoice-sorter.md` | 判断文件型、四要素型、批量型或信息不完整场景 |
| 百晓燕 | 发票查验专家 | `agents/invoice-verifier.md` | 上传文件、调用 OCR、标准化字段、发起查验、处理旅客运输抵扣判断 |
| 百晓信 | 商业信用专家 | `agents/counterparty-risk-analyst.md` | 查询并汇总交易对手欠税、灰名单、重大税收违法风险 |
| 百晓慧 | 企业票夹 | `agents/archivist.md` | 整合查验结果和商业信用结果，输出最终报告 |

### 1.4 协作流程

```text
用户输入/上传发票
  -> 百晓通识别任务
  -> 百晓甄判断输入场景
  -> 百晓燕上传文件、识别字段、标准化参数、发起查验
  -> 百晓信按销方名称或税号查询商业信用风险
  -> 百晓慧整合查验结果和商业信用结果
```

### 1.5 典型使用提示词

```text
帮我查一下指定本地文件夹里的发票
帮我看看这几个供应商的信用情况：XX物流、XX贸易、XX科技
这批发票验完顺便查一下开票方的信用状况
```

## 二、安装说明

### 2.1 目录结构

```text
invoice-verify-workbuddy/
├── .codebuddy-plugin/
│   └── plugin.json
├── agents/
│   ├── invoice-verify-team-lead.md
│   ├── invoice-sorter.md
│   ├── invoice-verifier.md
│   ├── counterparty-risk-analyst.md
│   └── archivist.md
├── avatars/
│   ├── team.png
│   ├── lead.png
│   ├── sorter.png
│   ├── verifier.png
│   ├── risk.png
│   └── archivist.png
├── .env
├── mcp-config.json
├── skills/
│   └── invoice-verify/
│       ├── SKILL.md
│       ├── references/
│       └── scripts/
├── settings.json
└── README.md
```

### 2.2 导入步骤

1. 将 `invoice-verify-workbuddy` 作为完整专家团目录提交或导入 WorkBuddy。
2. 确认插件清单位于 `.codebuddy-plugin/plugin.json`。
3. 确认入口配置 `settings.json` 指向 `invoice-verify-team-lead`。
4. 确认 `agents/`、`skills/`、`avatars/` 均位于专家团根目录。
5. 在 WorkBuddy 中加载专家团，并使用脱敏发票执行试跑。

## 三、参数说明

### 3.1 支持输入

| 类型 | 说明 |
|------|------|
| 图片 | `.jpg`、`.jpeg`、`.png`、`.bmp` |
| 文档 | `.pdf`、`.ofd`、`.xml` |
| 表格 | `.xlsx`、`.xls`、`.csv` |
| 文本四要素 | 发票代码、发票号码、开票日期、金额或校验码后 6 位 |
| 文件夹路径 | 用于文件夹批量核验，去重后逐张处理，去重后最多处理 100 张 |

### 3.2 发票四要素

| 字段 | 说明 |
|------|------|
| 发票代码 | 税控票通常需要；数电票可缺 |
| 发票号码 | 税控票通常为 8 位，数电票通常为 20 位 |
| 开票日期 | 使用 `YYYY-MM-DD` 格式 |
| 金额或校验码 | 数电票使用价税合计；非数电专票、机动车销售发票使用不含税金额；二手车销售发票使用车价合计；普通发票、通行费、卷票、卷式发票使用校验码后 6 位 |

### 3.3 外部服务配置

本专家团依赖已授权的百望 MCP 服务和 OSS 文件上传服务。图片/PDF 场景会先调用 `upload_to_oss.py` 获取文件 URL，再通过 `call_mcp.py` 调用标准 OCR；OFD/XML 场景优先调用 `recogcollect_file.py`，将文件转为裸 base64 后通过 MCP 调用 `baiwang.image.invoices.recogcollect`；验真和风险查询仍通过 `call_mcp.py` 执行。

这些服务配置属于 WorkBuddy 装载技能时注入的运行环境接入信息，不是用户使用发票核验能力时需要填写的业务参数。

配置来源与验证：

- WorkBuddy 装载技能时注入根目录 `.env`，提供百望 MCP、OSS 和平台 `taxNo` 运行配置。
- 根目录 `mcp-config.json` 保留配置键名和占位关系，**不应包含真实URL或密钥**，仅作为模板。
- **配置加载优先级**：`.env`（真实值）> `mcp-config.json`（占位符补缺）。WorkBuddy应优先读取`.env`，避免占位符覆盖真实配置。
- mcp-config.json中的`${KEY_NAME}`格式为占位符，实际值从`.env`对应KEY_NAME读取。
- 运行配置变量名包括 `BAIWANG_OCR_STANDARD_URL`、`BAIWANG_INVOICE_RECOGNIZE_VERIFY_URL`、`BAIWANG_COUNTERPARTY_RISK_URL`、`OSS_ACCESS_KEY`、`OSS_SECRET_KEY`、`OSS_BUCKET_NAME`、`OSS_BUCKET_DOMAIN`、`OSS_ENDPOINT`、`OSS_PREFIX`、`PLATFORM_TAXNO`、`BAIWANG_IMAGE_RECOGCOLLECT_USER_ACCOUNT`。
- 工具清单可在专家包根目录执行 `python skills/invoice-verify/scripts/call_mcp.py list BAIWANG_OCR_STANDARD_URL` 查看。百望 `lctoolscall` 网关不支持标准远程 `tools/list`，真实接口可用性以对应业务 `call` 返回为准。
- 权限类错误（401/403、`MCP_PERMISSION_DENIED`、appKey 无权操作税号）需要管理员检查 WorkBuddy 装载配置或百望服务授权，不应要求普通用户手工填写密钥。

### 3.4 脚本说明

| 脚本 | 用途 |
|------|------|
| `skills/invoice-verify/scripts/upload_to_oss.py` | 上传发票文件到 OSS，返回供 OCR 使用的文件 URL |
| `skills/invoice-verify/scripts/recogcollect_file.py` | 将 OFD/XML 等源文件转为裸 base64，调用影像识别采集 MCP，并输出标准化验真载荷 |
| `skills/invoice-verify/scripts/call_mcp.py` | 统一执行 MCP 工具清单展示、健康检查和工具调用 |

Python 依赖：

- `upload_to_oss.py`、`recogcollect_file.py` 和 `call_mcp.py` 使用 Python 标准库实现，无需额外依赖。
- PDF 文本降级提取使用 `PyPDF2`，推荐版本 `PyPDF2>=3.0.0,<4.0.0`。
- WorkBuddy 环境已预装时无需重复安装；如本地验证缺少依赖，可执行 `pip install "PyPDF2>=3.0.0,<4.0.0"`。

调用约束：

- 外部服务调用必须通过 `skills/invoice-verify/scripts/call_mcp.py`、`skills/invoice-verify/scripts/upload_to_oss.py` 或 `skills/invoice-verify/scripts/recogcollect_file.py` 脚本中转；不要使用平台原生 MCP tool call 绕过脚本。
- 禁止使用 curl、Python requests 或其他自写 HTTP 逻辑绕过统一调用封装。
- 标准 OCR `baiwang.ocr.stand.tickets` 不接受 base64；图片/PDF 必须先上传 OSS，再以 URL 调用 OCR。
- 影像识别采集 `baiwang.image.invoices.recogcollect` 仅接受裸 base64；OFD/XML 优先使用该接口，禁止携带 `data:...;base64,` 前缀。
- 单文件大小超过 8MB 时跳过并在汇总报告中列出。

### 3.5 能力边界

- 本专家团只在用户明确需要发票识别、税局验真、发票批量核验、商业信用查询、智能票夹归档或旅客运输抵扣判断时使用。
- 通用文件读取、PDF/Word/Markdown 转换、Excel 图表分析、HTML 或前端开发、Python 脚本编写、通用 Git 操作、第三方 API 集成开发不属于本专家团能力范围。
- 火车票、飞机票、出租车票、定额发票、机打发票、过路费、区块链发票、滴滴行程单、财政票据、医疗电子票据、完税证明、海关缴款书、海外发票、非发票类文件等仅做归档记录，不输出发票验真结论。
- 字段缺失时会追问，不根据文件名、当前时间或上下文猜测发票号码、日期、金额。
- 风险评级仅用于风险提示，不替代用户最终业务决策。

## 四、数据安全声明

### 4.1 数据流向

```text
用户上传发票/输入四要素
  -> WorkBuddy 专家团
  -> 图片/PDF：OSS 文件上传服务 -> 百望标准 OCR MCP
  -> OFD/XML：百望影像识别采集 MCP（裸 base64）
  -> 百望发票验真 MCP（发票查验）
  -> 百望交易对手风险 MCP（灰名单、欠税、重大税收违法查询）
  -> WorkBuddy 输出结构化报告
```

### 4.2 数据使用原则

- 发票文件和四要素仅用于本次识别、验真、风险查询和报告生成。
- 不将发票原始数据写入长期 memory。
- 不在日志、文档或上架材料中保留真实客户发票、税号、客户名称和内部系统截图。
- 演示和截图必须使用模拟或脱敏数据。
- MCP 或 OSS 不可用时，报告必须明确标注失败原因和降级数据来源，不得编造结果。

### 4.3 敏感信息展示限制

- 不在截图、说明文档、宣发材料中展示真实 URL key、AccessKey、SecretKey。
- 测试报告和演示材料中不得保留真实客户数据。
- 如需展示接口失败场景，应使用脱敏数据并说明“示例环境”。

### 4.4 异常处理

| 场景 | 处理方式 |
|------|----------|
| 识别接口不可用 | 图片/PDF 先走 OSS 上传 + 百望 OCR；OFD/XML 先走影像识别采集 MCP。仅当对应主流程失败或识别不到四要素时，才降级到 LLM 多模态或 PDF/XML 文本提取，仍需按字段标准化规则处理 |
| 验真接口权限不足 | 标注接口不可用原因，保留已提取字段，提供人工查验路径 |
| 风险接口不可用 | 使用 WebSearch 查询公开工商、税务、司法风险信息作为降级结果，并标注数据来源 |
| OCR 置信度低 | 暂停并要求用户确认，不继续猜测 |
| 发票字段缺失 | 只追问缺失字段，不重复追问已确认字段 |
| 重复请求 | 主动询问是否需要复查，不机械重复完整流程 |

## 五、版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-05-30 | 初始上架版本，提供发票识别、验真、交易对手风险查询和结构化报告输出能力 |
