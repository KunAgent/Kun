# 风险等级评定规则

## 风险等级分类

| 等级 | 标识 | 触发条件 | 处理方式 |
|------|------|----------|----------|
| 无风险 | 🟢 | 灰名单 `riskLevel` = `"无风险"` + 欠税 `hasArrears` = `"无欠税"` + 违法 `hasViolation` = `"无违法"` | 正常通过，纳入报告 |
| 中风险 | 🟡 | 灰名单 `riskLevel` = `"中风险"` 或 欠税 `hasArrears` = `"有欠税"` | 标注风险项，输出报告，提醒关注 |
| 高风险 | 🔴 | 灰名单 `riskLevel` = `"高风险"` 或 违法 `hasViolation` = `"有违法"` | 人工复核确认 |

> **⚠️ 前置映射（强制）**：本表及下方伪代码中的 `riskLevel` 一律指**枚举映射后的中文值**（`"高风险"/"中风险"/"无风险"`）。灰名单接口原始返回为数字字符串 `"0"/"1"/"2"`，**必须先按 [灰名单校验](#灰名单校验) 的枚举表映射为中文，再代入本表判定**；严禁拿原始数字值与中文常量直接比较（`"0" == "高风险"` 永远为假，会被错误归为无风险）。

## 综合校验结论

| 结论 | 含义 | 用户感知 |
|------|------|----------|
| 全部通过 | 所有发票验真通过 + 无交易对手风险 | ✅ 可正常入账 |
| 存在风险 | 发票验真通过但交易对手有风险 | ⚠️ 需关注风险项 |
| 验真异常 | 存在假发票/查无此票/状态异常 | ❌ 需处理异常发票 |
| 部分失败 | 识别或验真过程中部分发票失败 | ⚠️ 失败部分需单独处理 |

## 综合评级逻辑

```
# 验真结果不影响风险校验发起，只要有销方信息即执行风险校验
# 注意：riskLevel 为枚举映射后的中文值（原始 "0"/"1"/"2" 须先映射，见灰名单校验）
if riskLevel == "高风险" or hasViolation == "有违法":
    评级 = 🔴 高风险
elif riskLevel == "中风险" or hasArrears == "有欠税":
    评级 = 🟡 中风险
else:
    评级 = 🟢 无风险
```

## 风险校验前置条件

**查询优先级**：三项风险查询（灰名单、欠税、重大违法）必须优先通过 `call_mcp.py` 调用百望 MCP 接口。**严禁跳过 MCP 直接使用 WebSearch**。仅当 MCP 接口确认不可用时（网络超时、权限拒绝、脚本执行失败、沙箱 [100006] 无权操作等）才降级到 WebSearch 查询公开信息，降级结果必须标注 `data_source: "公开渠道(WebSearch)"`。

风险校验（Step 4）的**发起条件**（满足任一即可发起查询）：

| 来源 | 提取字段 | MCP 入参 | 时序优势 |
|------|----------|----------|----------|
| OCR 识别结果 | `sellerName`（销方名称） / `sellerTaxNo`（销方税号） | `taxpayer` / `taxpayercode` | 可与验真并行，提前发起 |
| 用户直接提供 | 销方名称 / 销方税号 | `taxpayer` / `taxpayercode` | 可与验真并行，提前发起 |
| 验真结果返回 | `sellerName`（销方名称） / `sellerTaxNo`（销方税号） | `taxpayer` / `taxpayercode` | 验真完成后发起 |

**核心规则**：
- 验真结果（一致/不一致/已作废/已红冲/失控/查无此票）**不影响**风险校验发起
- 只要拿到 `sellerName`（无论来源），即作为 `taxpayer` 传入三项风险查询；同时有税号时作为 `taxpayercode` 传入
- 风险查询可与验真并行，已获取的风险结果统一纳入最终报告

**无法满足条件时的处理**：
- 始终无法获取 `sellerName`（OCR、用户、验真均无） → 跳过风险校验，报告标注 `RISK_CHECK_SKIPPED`
- 风险服务不可用 → 跳过风险校验，报告标注 `MCP_SERVICE_UNAVAILABLE`

## 交易对手三项校验明细

### ⚠️ 风险查询参数格式标准（全局约束）

所有三项风险查询工具（灰名单/欠税/违法）必须严格遵循以下参数格式：

```json
// ✅ 正确格式
{
  "taxNo": "<PLATFORM_TAXNO>",           // 平台标识（固定值）
  "data": {
    "taxpayer": "销方名称",              // 销方企业名称
    "taxpayercode": "销方税号"           // 销方企业税号
  }
}

// ❌ 错误格式（会导致校验失败或自动修正）
{
  "taxNo": "",                           // 空字符串 → 自动注入
  "data": {...}
}
{
  "taxNo": "销方税号",                   // 错误值 → 强制修正为平台标识
  "data": {...}
}
{
  "data": {"data": {...}}                // 双重嵌套 → 校验失败
}
{
  "taxpayer": "...",                     // 缺少 taxNo → 自动注入并包装
  "taxpayercode": "..."
}
```

**参数校验与自动修正**：
1. `taxNo` **必填且非空**，必须为平台标识（PLATFORM_TAXNO），**严禁使用销方税号**
   - 缺失 → 自动注入 PLATFORM_TAXNO
   - 空字符串 → 自动注入 PLATFORM_TAXNO
   - 错误值（如销方税号） → 强制修正为 PLATFORM_TAXNO
2. `data` **必填**，必须为对象类型，`taxpayer` 和 `taxpayercode` 必须包装在 `data` 对象内部
   - 缺失 → 自动包装原始参数
3. **不得出现双重嵌套**（如 `{"data": {"data": {...}}}`）
4. 名称和税号至少填写一个，两者都存在时优先使用税号

### 灰名单校验

- **MCP 工具**：`baiwang.dataasset.risktag.queryTaxnogrey`
- **MCP 入参**：`taxNo` 必填，值为平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取，见 mcp-config.json → platform.taxNo），`data.taxpayer` = `sellerName`，`data.taxpayercode` = `sellerTaxNo`（名称税号必填一个）
- **MCP 返回 → 报告字段映射**：见 [report_templates.md → 灰名单](report_templates.md)
- **⚠️ 枚举值映射（强制，禁止猜测）**：接口返回字段为数字字符串枚举，必须严格映射：
  - `riskLevel`：`"0"` → 高风险🔴，`"1"` → 中风险🟡，`"2"` → 无风险🟢
  - `isMajorTaxviolatingEnterprises`（是否属于重大税收违法企业）：`"0"` → 属于，`"1"` → 不属于
  - `isTaxdefaultingEnterprises`（是否是欠税企业）：`"0"` → 属于，`"1"` → 不属于
  - `updateTime`：数据更新时间，格式 `YYYY-MM-DD HH:MM:SS`，原样透传
- **特殊处理（业务规则）**：百望云平台对无风险企业的返回格式统一为 `success=false + subCode=90008 + subMessage含"暂无信息"`。这是正常的业务返回，不是接口错误。代码已自动处理（`call_mcp.py` 第789-797行），将此响应转换为 `riskLevel="无风险"`，`reason="暂未发现风险"`。

- **评级规则**（按 `riskLevel` 枚举映射后判定）：`riskLevel` = `"0"`（高风险） → 🔴，`riskLevel` = `"1"`（中风险） → 🟡

### 欠税信息校验

- **MCP 工具**：`baiwang.dataasset.risktag.queryTaxArrearsInfo`
- **MCP 入参**：`taxNo` 必填，值为平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取，见 mcp-config.json → platform.taxNo），`data.taxpayer` = `sellerName`，`data.taxpayercode` = `sellerTaxNo`（名称税号必填一个）
- **MCP 返回 → 报告字段映射**：见 [report_templates.md → 欠税信息](report_templates.md)

- **评级规则**：`hasArrears` = `"有欠税"` → 中高风险

### 重大税收违法校验

- **MCP 工具**：`baiwang.dataasset.risktag.selectViolationInfo`
- **MCP 入参**：`taxNo` 必填，值为平台标识（实际值从环境变量 `PLATFORM_TAXNO` 读取，见 mcp-config.json → platform.taxNo），`data.taxpayer` = `sellerName`，`data.taxpayercode` = `sellerTaxNo`（名称税号必填一个）
- **MCP 返回 → 报告字段映射**：见 [report_templates.md → 重大税收违法](report_templates.md)

- **评级规则**：`hasViolation` = `"有违法"` → 高风险

> **三项校验应并行调用**以提升效率（同一条回复中发起三个脚本调用）。单项失败不影响其余两项。

## 多项命中规则

当同一企业同时命中多项风险时：
- 取最高风险等级作为 `overall_risk_level`
- 所有命中项均展示在 `risk_items` 中
- `suggestion` 基于最高风险等级生成

## 风险建议模板

| 风险等级 | `suggestion` 文案 |
|----------|------------------|
| 🟢 无风险 | 该供应商税务状况正常，可正常开展业务 |
| 🟡 中风险 | 建议关注该供应商税务状况，审慎开展业务 |
| 🔴 高风险 | 建议暂停与该供应商的交易，待风险排除后再行决策 |
