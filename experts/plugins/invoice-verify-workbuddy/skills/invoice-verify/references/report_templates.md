# 报告输出模板

## 综合评级规则

> 评级规则定义见 [risk_rules.md](risk_rules.md)，此处仅保留验真结果映射关系。
> 
> 验真结果（一致/不一致/已作废/已红冲/失控/查无此票）**不影响**风险校验发起。只要有销方名称/税号，即执行三项风险查询，风险结果统一纳入报告。

## 字段映射总表

### 输入映射：Skill 四要素 → MCP `baiwang.input.compliance.validate`

| Skill 字段（用户侧） | MCP 入参          | 类型     | 说明                          |
| ------------- | --------------- | ------ | --------------------------- |
| 发票代码          | `invoiceCode`   | string | 10/12位数字；数电发票不传             |
| 发票号码          | `invoiceNumber` | string | 8位（数电20位）                   |
| 开票日期          | `billingDate`   | string | YYYY-MM-DD                  |
| 金额            | `totalAmount`   | string | 按票种自动取值（见 invoice_types.md） |
| 校验码后6位        | `checkCode_6`   | string | 增值税普通发票/全电纸质普票/旅客运输服务       |
| 纳税识别号        | `taxNo`         | string | 必填，值为平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取，见 mcp-config.json → platform.taxNo） |

### OCR 返回字段 → 验真接口入参映射

| OCR 返回字段             | 验真入参               | 类型     | 说明                                |
| -------------------- | ------------------ | ------ | --------------------------------- |
| `invoiceNo`          | `invoiceNumber`    | string | 发票号码（8位/20位）                      |
| `invoiceCode`        | `invoiceCode`      | string | 发票代码（10/12位）；数电发票不传               |
| `invoiceDate`        | `billingDate`      | string | 开票日期（YYYY-MM-DD）                  |
| `totalAmount`（不含税金额） | `totalAmount`      | string | 专票/机动车/数电纸质专票 按此取值                |
| `amountTax`（价税合计）    | `totalAmount`      | string | 数电各票种（31/32/51/59/61/83）/二手车 按此取值 |
| `checkCode`（校验码）     | `checkCode_6`（后6位） | string | 普票/全电纸质普票/旅客运输服务 取校验码后6位          |

> **验真第四项参数规则**：根据发票名称关键字匹配自动选择（纸质排除 → 数电判断 → 关键字分组），完整规则见 [ocr_to_verify_type_mapping.md](ocr_to_verify_type_mapping.md)。严禁错配。

### 输入映射：Skill 文件 → MCP `baiwang.ocr.stand.tickets`

| Skill 字段 | MCP 入参        | 类型     | 说明                      |
| -------- | ------------- | ------ | ----------------------- |
| 发票文件 URL | `fileUrl`     | string | 从阿里云 OSS 获取的公共 URL |
| 服务模式     | `serviceMode` | string | 固定 `"0"`                |
| 服务模板     | `serviceMold` | string | 固定 `"1"`                |

> ⚠️ **重要**：标准 OCR `baiwang.ocr.stand.tickets` 只接受 OSS URL，严禁传 base64。必须先调用 `scripts/upload_to_oss.py` 将文件上传至阿里云 OSS 获取永久公共 URL，然后使用该 URL 调用 OCR 接口。

### 输入映射：Skill OFD/XML → MCP `baiwang.image.invoices.recogcollect`

| Skill 字段 | MCP 入参        | 类型     | 说明                      |
| -------- | ------------- | ------ | ----------------------- |
| 文件名称 | `filesMap[].fileName` | string | 带后缀名，最长 50 字符 |
| 文件内容 | `filesMap[].fileBase64` | string | 裸 base64，不带 `data:...;base64,` 前缀 |
| 用户账号 | `userAccount` | string | 必填，由 WorkBuddy 注入或脚本参数传入 |
| 是否入库 | `isSave` | integer | 默认 `1`，不入库，仅识别 |
| 采集方式 | `collectWay` | integer | 默认 `4`，接口采集 |

### 输入映射：Skill 销方信息 → MCP 风险查询（三个工具共用）

| Skill 字段 | MCP 入参           | 类型     | 来源                     |
| -------- | ---------------- | ------ | ---------------------- |
| 销方名称     | `data.taxpayer`     | string | OCR 识别结果 / 用户输入 / 验真返回 |
| 销方税号     | `data.taxpayercode` | string | OCR 识别结果 / 用户输入 / 验真返回 |

> `taxNo` 为平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取），`data.taxpayer` / `data.taxpayercode` 名称税号必填一个。

### 输出映射：MCP `baiwang.input.compliance.validate` 返回 → 报告字段

| MCP 返回字段           | 报告字段                         | 类型     | 说明                                                                  |
| ------------------ | ---------------------------- | ------ | ------------------------------------------------------------------- |
| `checkResult`      | `verification.check_result`  | string | 见下方验真结果映射表                                                          |
| `state`            | `invoice.invoice_status`     | string | 0-正常，1-失控， 2-作废，3-红冲，4-异常，7-部分红冲，8-全额红冲 |
| `invoiceCode`      | `invoice.invoiceCode`        | string | 原样透传                                                                |
| `invoiceNumber`    | `invoice.invoiceNumber`      | string | 原样透传                                                                |
| `billingDate`      | `invoice.billingDate`        | string | 原样透传                                                                |
| `invoiceType`      | `invoice.invoice_type`       | string | 发票类型名称                                                              |
| `amountTax`        | `invoice.amount_tax`         | string | 价税合计                                                                |
| `amountWithoutTax` | `invoice.amount_without_tax` | string | 不含税金额                                                               |
| `taxAmount`        | `invoice.tax_amount`         | string | 税额                                                                  |
| `sellerName`       | `risk_check.seller_name`     | string | 销方名称                                                                |
| `sellerTaxNo`      | `risk_check.seller_tax_id`   | string | 销方税号                                                                |
| 其余票面字段             | `verification.full_detail`   | object | 完整票面信息原样透传                                                          |

### 旅客运输发票抵扣判断 → 报告字段

| 判断项       | 报告字段                                     | 类型      | 说明                                     |
| --------- | ---------------------------------------- | ------- | -------------------------------------- |
| 票种是否为电子普票 | `passenger_transport.is_einvoice_normal` | boolean | 票种 =「电子发票（普通发票）」                       |
| 旅客运输标识    | `passenger_transport.has_passenger_flag` | boolean | OCR/XML/票面识别到旅客运输服务标识                  |
| 出行人信息     | `passenger_transport.has_traveler_info`  | boolean | 存在出行人记录                                |
| 开票日期分段    | `passenger_transport.date_rule`          | string  | "≥2026-01-01需出行人" / "<2026-01-01无需出行人" |
| 可抵扣       | `passenger_transport.deductible`         | boolean | true=可抵扣, false=不可抵扣                   |
| 可抵扣税额     | `passenger_transport.deductible_amount`  | number  | 可抵扣时=taxAmount, 不可抵扣=0                 |
| 判定依据      | `passenger_transport.deduction_reason`   | string  | 具体判定原因                                 |

### 输出映射：MCP `baiwang.ocr.stand.tickets` 返回 → 验真入参映射

OCR 或影像识别采集完成后，从返回结果中提取字段传入验真接口：

| MCP 返回字段        | 验真入参                       | 类型     | 说明                                      |
| --------------- | -------------------------- | ------ | --------------------------------------- |
| `invoiceNo`     | `invoiceNumber`            | string | 发票号码（8位/数电20位）                          |
| `invoiceCode`   | `invoiceCode`              | string | 发票代码（10/12位）；数电发票不传                     |
| `invoiceDate`   | `billingDate`              | string | 开票日期（需转为 YYYY-MM-DD）                    |
| `totalAmount`   | 验真 `totalAmount`           | string | 专票/机动车/数电纸质专票 按此取值（不含税）                 |
| `amountTax`     | 验真 `totalAmount`           | string | 数电各票种（31/32/51/59/61/83）/二手车 按此取值（价税合计） |
| `checkCode`     | 取后6位用于验真                   | string | 普票取校验码末6位                               |
| `invoiceType`   | 发票类型名称参考字段                 | string | 不作为唯一决策依据；验真参数按数电优先 + 发票名称关键字匹配规则确定 |
| `sellerName`    | `risk_check.seller_name`   | string | OCR 识别的销方名称                             |
| `sellerTaxNo`   | `risk_check.seller_tax_id` | string | OCR 识别的销方税号                             |
| `ocrConfidence` | —                          | number | < 80% 时阻塞确认（不输出到报告）                     |

影像识别采集 `baiwang.image.invoices.recogcollect` 从 `response[].mediaInvoiceList[]` 取值，字段映射如下：

| MCP 返回字段        | 验真入参                       | 类型     | 说明                                      |
| --------------- | -------------------------- | ------ | --------------------------------------- |
| `invoiceNo` / `electronicNo` | `invoiceNumber` | string | 优先取 `invoiceNo`；为空时取 `electronicNo` |
| `invoiceCode`   | `invoiceCode`              | string | 发票代码；数电票不传 |
| `invoiceDate`   | `billingDate`              | string | 开票日期（需转为 YYYY-MM-DD） |
| `totalAmount` / `amountTax` | 验真 `totalAmount` | string | 按发票名称关键字规则选择不含税金额、价税合计或车价合计 |
| `checkCode`     | 取后6位用于验真                   | string | 普票取校验码末6位 |
| `invoiceType` / `noteName` | 发票类型名称参考字段 | string | 不作为唯一决策依据 |
| `saleName`      | `risk_check.seller_name`   | string | 销方名称 |
| `saleTaxNo`     | `risk_check.seller_tax_id` | string | 销方税号 |
| `purchaserName` | `invoice_payload.purchaser_name` | string | 购方名称 |
| `purchaserTaxNo` | `invoice_payload.purchaser_tax_no` | string | 购方税号 |

> **金额取值规则**：先判断纯数电票，再按发票名称关键字分组决定使用不含税金额、价税合计、车价合计或校验码后6位。严禁仅根据 `invoiceType` 编码决定验真参数，详见 [ocr_to_verify_type_mapping.md](ocr_to_verify_type_mapping.md)。

### 验真结果映射表

| MCP 返回 `checkResult` 值 | 报告 `check_result` | 报告 `invoice_status` |
| ---------------------- | ----------------- | ------------------- |
| `"一致"`                 | `"查验一致，真实有效"`     | `"正常"`              |
| `"不一致"`                | `"查验不一致"`         | `"异常"`              |
| `"已作废"`                | `"已作废"`           | `"已作废"`             |
| `"已红冲"`                | `"已红冲"`           | `"已红冲"`             |
| `"失控"`                 | `"失控"`            | `"失控"`              |
| `"查无此票"`               | `"查无此票"`          | `"不存在"`             |

> 验真结果不影响风险校验发起。只要获取到销方名称/税号，即执行三项风险查询（详见 [risk_rules.md](risk_rules.md)）。

### 输出映射：MCP `baiwang.dataasset.risktag.queryTaxnogrey` 返回 → 报告字段

> **⚠️ 枚举值映射（强制，禁止模型自行猜测）**：本接口返回的 `riskLevel`、`isMajorTaxviolatingEnterprises`、`isTaxdefaultingEnterprises` 均为**数字字符串枚举**，必须严格按下表映射为中文含义后再写入报告。

| MCP 返回字段                        | 报告字段                                       | 类型     | 枚举值 / 格式映射（严格按此映射，不得猜测）                                        |
| ------------------------------- | ------------------------------------------ | ------ | --------------------------------------------------------------- |
| `riskLevel`                     | `risk_check.gray_list.level`               | string | `"0"` → `"高风险"` 🔴 / `"1"` → `"中风险"` 🟡 / `"2"` → `"无风险"` 🟢       |
| `isMajorTaxviolatingEnterprises`| `risk_check.gray_list.is_major_tax_violating` | string | `"0"` → `"属于"`（属于重大税收违法企业） / `"1"` → `"不属于"`                     |
| `isTaxdefaultingEnterprises`    | `risk_check.gray_list.is_tax_defaulting`   | string | `"0"` → `"属于"`（属于欠税企业） / `"1"` → `"不属于"`                         |
| `updateTime`                    | `risk_check.gray_list.update_time`         | string | 数据更新时间，格式 `YYYY-MM-DD HH:MM:SS`，原样透传                            |
| `reason`                        | `risk_check.gray_list.detail`              | string | 风险判定的具体依据                                                       |

> **说明**：
> - 灰名单评级只依据 `riskLevel`（详见 [risk_rules.md](risk_rules.md)）；`isMajorTaxviolatingEnterprises`、`isTaxdefaultingEnterprises` 仅按上表映射为中文后写入报告作为参考字段，不参与评级判定。
> - 当 `call_mcp.py` 因 `subCode=90008`（暂无信息）已将返回归一化为 `{"riskLevel": "无风险", "reason": "暂未发现风险"}`（中文字符串）时，直接采用，无需再做枚举映射。
> - 真实接口返回的 `riskLevel` 为数字字符串（`"0"/"1"/"2"`），必须先按上表映射为 `"高风险"/"中风险"/"无风险"` 再参与 [risk_rules.md](risk_rules.md) 的评级。

### 输出映射：MCP `baiwang.dataasset.risktag.queryTaxArrearsInfo` 返回 → 报告字段

| MCP 返回字段     | 报告字段                                | 类型     | 说明                |
| ------------ | ----------------------------------- | ------ | ----------------- |
| `hasArrears` | `risk_check.tax_arrears.status`     | string | `"有欠税"` / `"无欠税"` |
| `title`      | `risk_check.tax_arrears.title`      | string | 欠税公告标题            |
| `taxType`    | `risk_check.tax_arrears.tax_type`   | string | 欠税税种              |
| `balance`    | `risk_check.tax_arrears.balance`    | string | 欠税余额              |
| `newAmount`  | `risk_check.tax_arrears.new_amount` | string | 当期新增欠税金额          |

### 输出映射：MCP `baiwang.dataasset.risktag.selectViolationInfo` 返回 → 报告字段

| MCP 返回字段                 | 报告字段                                                   | 类型     | 说明                |
| ------------------------ | ------------------------------------------------------ | ------ | ----------------- |
| `hasViolation`           | `risk_check.major_violation.status`                    | string | `"有违法"` / `"无违法"` |
| `legalPersonName`        | `risk_check.major_violation.legal_person_name`         | string | 法人名称              |
| `legalPersonGender`      | `risk_check.major_violation.legal_person_gender`       | string | 法人性别              |
| `legalPersonIdNumber`    | `risk_check.major_violation.legal_person_id_number`    | string | 法人证件号码            |
| `financeOfficerName`     | `risk_check.major_violation.finance_officer_name`      | string | 财务负责人名称           |
| `financeOfficerGender`   | `risk_check.major_violation.finance_officer_gender`    | string | 财务负责人性别           |
| `financeOfficerIdNumber` | `risk_check.major_violation.finance_officer_id_number` | string | 财务负责人证件号码         |
| `caseNature`             | `risk_check.major_violation.case_nature`               | string | 案件性质              |
| `facts`                  | `risk_check.major_violation.facts`                     | string | 违法事实              |
| `legalBasis`             | `risk_check.major_violation.legal_basis`               | string | 相关法律依据            |
| `penalty`                | `risk_check.major_violation.penalty`                   | string | 处理处罚情况            |

### 综合风险评级映射

> 综合评级规则详见 [risk_rules.md](risk_rules.md)。

---

## Markdown 渲染模板

> **输出规范**：
> 
> - **报告标题与文件名一致**：若保存为 Markdown 文件，文件名须以报告首行标题为前缀（去除 `# ` 符号），后缀加 `.md`。若文件已存在，追加序号 `_1`、`_2` 递增（如 `发票查验通过.md` → `发票查验通过_1.md`），报告标题本身不做修改
> - 发票信息仅包含主信息（代码/号码/日期/金额/状态/类型），**不包含货物明细**
> - 验真结果只展示结论，**不得出现 MCP、API 调用、success/state 等技术字段**

### 单张发票 — 验真通过

```markdown
发票查验通过

### 任务摘要
- 处理对象：增值税发票核验
- 发票代码：044002100311
- 发票号码：24891456
- 开票日期：2025-03-15
- 价税合计：¥12,800.00
- 发票类型：增值税专用发票
- 发票状态：正常
- 验真结果：查验一致，真实有效

### 旅客运输抵扣判断（仅电子发票（普通发票）+ 旅客运输服务 时展示）
<!-- 非旅客运输发票不展示此模块 -->
- 票种：电子发票（普通发票）✅
- 旅客运输标识：有✅
- 出行人信息：[实际姓名] 或 无
- 开票日期分段：≥2026-01-01需出行人 / <2026-01-01无需出行人
- 可抵扣：是/否
- 可抵扣税额：¥13.68
- 判定依据：XXX

> **注意**：出行人信息无时仅展示"无"，不得暴露 OCR transports 字段、数组状态等技术信息。

### 交易对手风险
- 销方：XX有限公司（91110000XXXXXXXXXX）
- 灰名单：无风险
- 欠税：无
- 违法：无

### 操作建议
- 该供应商税务状况正常，可正常开展业务
```

### 单张发票 — 存在欠税风险（中风险）

```markdown
发票校验完成 — 存在风险（🟡 中风险）

### 任务摘要
- 处理对象：增值税发票核验
- 发票号码：24891456
- 开票日期：2025-03-15
- 价税合计：¥35,000.00
- 发票类型：增值税普通发票
- 发票状态：正常
- 验真结果：查验一致，真实有效

### 旅客运输抵扣判断（仅电子发票（普通发票）+ 旅客运输服务 时展示）
<!-- 非旅客运输发票不展示此模块 -->
- 可抵扣：是/否
- 可抵扣税额：¥0.00
- 判定依据：XXX

### 交易对手风险 🟡 中风险
- 销方：XX有限公司
- 🟡 欠税信息：
  - 公告：XX市税务局欠税公告
  - 税种：增值税
  - 欠税余额：¥356,200.00
  - 本期新增：¥48,000.00
- 灰名单：无风险
- 违法：无

### 操作建议
- 建议关注该供应商税务状况，审慎开展业务
```

### 单张发票 — 重大违法（高风险）

```markdown
发票校验完成 — 高风险（🔴 高风险）

### 任务摘要
- 处理对象：增值税发票核验
- 发票号码：24891458
- 开票日期：2025-03-15
- 价税合计：¥50,000.00
- 发票类型：增值税专用发票
- 发票状态：正常
- 验真结果：查验一致，真实有效

### 交易对手风险 🔴 高风险
- 销方：ZZ实业有限公司
- 🔴 灰名单：高风险 — 存在虚开发票行为特征
- 🔴 重大税收违法：
  - 法人：张XX
  - 案件性质：虚开增值税专用发票
  - 违法事实：2019-2021年期间虚开增值税专用发票156份
  - 处罚：追缴税款并处罚款，法人被追究刑事责任

### 操作建议
- 建议暂停与该供应商的交易，待风险排除后再行决策
```

### 单张发票 — 验真异常

```markdown
发票校验失败

### 任务摘要
- 处理对象：增值税发票核验
- 发票代码：044002100311
- 发票号码：24891456
- 发票类型：增值税专用发票
- 发票状态：异常
- 验真结果：查验不一致

### 异常说明
- 发票信息与税务局数据不符

### 操作建议
- 建议进一步核实发票来源
```

### 批量汇总（场景 F 文件夹批量）

```markdown
批量发票校验完成

### 任务摘要
- 处理对象：增值税发票批量核验
- 来源文件夹：D:\影像\真票\新建文件夹
- 扫描文件：**47 份**（图片 32, PDF 8, XML 5, Excel 2）
- 识别成功：**42 张**（5 张识别失败）
- 去重后：**38 张**（4 张重复已跳过）
- 核验通过：35
- 查验不一致：1
- 已作废：1
- 已红冲：0
- 失控：0
- 查无此票：0
- 查验失败：1
- 🟢 正常：35
- 🟡 关注：2
- 🔴 高风险：0

### 结果明细
| # | 文件名 | 发票号码 | 发票类型 | 价税合计 | 验真结果 | 风险等级 | 备注 |
|---|--------|---------|---------|---------|---------|---------|------|
| 1 | invoice_001.jpg | 24891456 | 数电票（专票） | ¥12,800.00 | 查验一致 | 🟢 正常 | — |
| 2 | invoice_002.pdf | 24891457 | 数电票（普票） | ¥3,500.00 | 查验一致 | 🟡 关注 | 灰名单中风险 |
| 3 | invoice_003.png | 24891458 | 增值税普通发票 | ¥500.00 | 查验不一致 | — | 信息与税局不符 |

### 识别失败文件
| # | 文件名 | 原因 |
|---|--------|------|
| 1 | blurry_scan.jpg | 文件模糊，OCR 无法识别 |
| 2 | receipt.jpg | 非发票文件，未识别到发票要素 |

### 操作建议
- 关注灰名单中风险的供应商
- 查验不一致的发票建议进一步核实来源
- 识别失败的文件建议重新上传清晰版本
```

### 批量汇总（Excel 导入批量）

```markdown
批量发票校验完成

### 任务摘要
- 处理对象：增值税发票批量核验
- 来源：Excel 导入（发票查询列表.xlsx）
- 总行数：**145 行**
- 跳过普票：**71 行**（缺校验码）
- 有效查验：**74 张**
- 核验通过：72
- 查验不一致：0
- 已作废：0
- 已红冲：0
- 失控：0
- 查无此票：0
- 查验失败：2
- 🟢 正常：72
- 🟡 关注：0
- 🔴 高风险：0

### 结果明细
| # | 发票号码 | 发票类型 | 价税合计 | 验真结果 | 风险等级 | 备注 |
|---|---------|---------|---------|---------|---------|------|
| 1 | 26442000004601968756 | 数电票（专票） | ¥15,250.00 | 查验一致 | 🟢 正常 | — |
| 2 | 26117000000613983343 | 数电票（普票） | ¥1,005.36 | 查验一致 | 🟢 正常 | — |

### 操作建议
- 所有查验发票风险等级正常
- 跳过的普票需补充校验码后方可验真
```

## 风险建议模板

> 详见 [risk_rules.md](risk_rules.md)。
