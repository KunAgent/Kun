# 腾讯电子签合同 AI 工具参考

> 本文档提供各工具的详细调用示例。所有命令从 Skill 根目录执行。

---

## 目录

1. [鉴权管理](#1-鉴权管理)
2. [文件上传](#2-文件上传)
3. [合同起草](#3-合同起草)
4. [合同审查](#4-合同审查)
5. [合同对比](#5-合同对比)
6. [法条法规检索](#6-法条法规检索)
7. [通用规则](#7-通用规则)

---

## 1. 鉴权管理

### 检查 Token

```bash
python3 scripts/tencent_esign.py auth-check
```

成功返回：
```json
{"success": true, "message": "Token 已配置", "preview": "yD3X8UUc..."}
```

### 保存 Token（跳过验证）

```bash
python3 scripts/tencent_esign.py auth-save yD3X8UUckpzddjmqUxLYBY9RRJbV2P5O
```

### 验证并保存 Token

```bash
python3 scripts/tencent_esign.py auth-validate yD3X8UUckpzddjmqUxLYBY9RRJbV2P5O
```

---

## 2. 文件上传

将本地文件上传到电子签文件服务，获取 ResourceId 供后续操作使用。使用 multipart/form-data 方式上传到独立端点 `https://file.test.ess.tencent.cn/upload/`，通过 `AccessToken` 头鉴权。

**上传单个文件**：

```bash
python3 scripts/tencent_esign.py upload /path/to/contract.pdf
```

**同时上传多个文件**（如对比场景需上传原版和新版）：

```bash
python3 scripts/tencent_esign.py upload /path/to/original.pdf /path/to/new_version.pdf
```

成功返回：
```json
{
  "Response": {
    "ResourceId": "yDRSRUUgygj6rq2wUuO4zjEyBZ2NHiyT",
    "ResourceUrl": "https://file.test.ess.tencent.cn/...",
    "RequestId": "xxx"
  }
}
```

多文件场景需逐个上传，每次返回一个 `ResourceId`。

**限制**：图片(png/jpg/jpeg) ≤5M，PDF/Word/Excel等 ≤60M。

---

## 3. 合同起草

### 3.1 创建起草任务

**基础调用**（仅需求描述）：

```bash
python3 scripts/tencent_esign.py call CreateDraftContractByPromptsTask '{
  "Requirement": "我公司（深圳市星辰科技有限公司）需要与北京云端数据服务有限公司签订一份软件开发服务合同。项目总金额80万元，分三期支付。开发周期6个月。",
  "ContractLanguage": "zh"
}'
```

**带参考模板**：

```bash
python3 scripts/tencent_esign.py call CreateDraftContractByPromptsTask '{
  "Requirement": "起草一份租赁合同，租期1年",
  "ReferenceTemplateId": "yD3azUUckxxxFm7tFzY",
  "ContractLanguage": "zh"
}'
```

**带规定文件**（最多3个）：

```bash
python3 scripts/tencent_esign.py call CreateDraftContractByPromptsTask '{
  "Requirement": "起草一份劳动合同",
  "RequirementFileIds": ["yD3aWUUcxxxoe1E"],
  "ContractLanguage": "zh"
}'
```

返回：
```json
{"Response": {"TaskId": "yD3a5UUcxxxSEruSi", "RequestId": "xxx"}}
```

| 参数 | 必填 | 说明 |
|------|------|------|
| Requirement | 是 | 起草要求，5-1000字 |
| ReferenceTemplateId | 否 | 参考模板资源ID（PDF/Word，≤1M） |
| RequirementFileIds | 否 | 规定文件资源ID列表（最多3个，每个≤1M） |
| ContractLanguage | 否 | zh(默认)/en |

### 3.2 查询起草任务

```bash
python3 scripts/tencent_esign.py call DescribeDraftContractByPromptsTask '{"TaskId": "yD3a5UUcxxxSEruSi"}'
```

或使用轮询命令自动等待：

```bash
python3 scripts/tencent_esign.py wait-draft yD3a5UUcxxxSEruSi
```

返回（成功时）：
```json
{
  "Response": {
    "Status": 2,
    "ContractName": "软件开发服务合同",
    "ResourceId": "yD3a5UUs1ixxxKDC7ewKOitKTm",
    "ContractUrl": "https://file.test.ess.tencent.cn/...",
    "RequestId": "xxx"
  }
}
```

| Status | 含义 |
|--------|------|
| 0 | 已创建 |
| 1 | 执行中 |
| 2 | 成功 |
| 3 | 失败（见 Message 字段） |

---

## 4. 合同审查

### 4.1 创建审查任务

```bash
python3 scripts/tencent_esign.py call CreateBatchContractReviewTask '{
  "ResourceIds": ["yDRS4UUgygqdcj56UuO4zjExBQcOiB68"],
  "PolicyType": 0
}'
```

| 参数 | 必填 | 说明 |
|------|------|------|
| ResourceIds | 是 | 文件资源ID列表（最多5个，PDF/Word，≤10M） |
| PolicyType | 否 | 审查尺度：0=严格(默认) 1=中立 2=宽松 |
| Comment | 否 | 备注（≤100字） |

返回：
```json
{"Response": {"TaskIds": ["yDtIFUU2tnsxxxd8"], "RequestId": "xxx"}}
```

**重要**：返回的是 `TaskIds` 数组，取 `TaskIds[0]` 用于后续轮询和查询。

### 4.2 查询/等待审查任务

```bash
python3 scripts/tencent_esign.py wait-review yDtIFUU2tnsxxxd8
```

| Status | 含义 |
|--------|------|
| 1 | 创建成功 |
| 2 | 排队中 |
| 3 | 执行中 |
| 4 | 成功 |
| 5 | 失败 |

成功时关键返回字段：

| 字段 | 说明 |
|------|------|
| HighRiskCount | 高风险项数量 |
| TotalRiskCount | 风险总数 |
| Risks | 风险列表（见下方字段映射） |
| Summaries | 摘要信息 |
| ApprovedLists | 通过项信息 |

**Risks 数组每项字段映射**：

| API 字段 | 展示名 | 说明 |
|----------|--------|------|
| RiskName | 风险名称 | 风险标题 |
| RiskLevel | 等级 | 高风险/中风险/低风险/提示 |
| Content | 原文 | 合同中触发风险的原文摘录 |
| RiskDescription | 描述 | 风险的详细说明 |
| RiskAdvice | 修改建议 | 建议如何修改 |
| CategoryName | 分类 | 风险所属类别（如违约责任、知识产权等） |

### 4.3 获取审查可视化页面

```bash
python3 scripts/tencent_esign.py call DescribeContractReviewWebUrl '{"TaskId": "yDtIFUU2tnsxxxd8"}'
```

返回 `WebUrl`，有效期5分钟，仅可使用一次。

### 4.4 导出审查报告

```bash
# 带风险批注文件
python3 scripts/tencent_esign.py call ExportContractReviewResult '{"TaskId": "yDtIFUU2tnsxxxd8", "FileType": 1}'

# 审查结果摘要 Excel
python3 scripts/tencent_esign.py call ExportContractReviewResult '{"TaskId": "yDtIFUU2tnsxxxd8", "FileType": 2}'
```

| FileType | 说明 |
|----------|------|
| 1 | 带风险批注的 Word/PDF |
| 2 | 审查结果与摘要（.xlsx） |
| 3 | 原始合同文件 |
| 4 | 无风险批注的 Word/PDF |

---

## 5. 合同对比

### 5.1 创建对比任务

```bash
python3 scripts/tencent_esign.py call CreateContractComparisonTask '{
  "OriginFileResourceId": "yD3XRUUckpm69xp8UyxR7Ot1rS3O6FRg",
  "DiffFileResourceId": "yD3XRUUckpm67vdpUu0Aw5WCqVsZj5aq",
  "Comment": "V1 vs V2 对比"
}'
```

| 参数 | 必填 | 说明 |
|------|------|------|
| OriginFileResourceId | 是 | 原版文件资源ID |
| DiffFileResourceId | 是 | 新版文件资源ID |
| Comment | 否 | 备注（≤50字） |

### 5.2 查询/等待对比任务

```bash
python3 scripts/tencent_esign.py wait-compare yDtrrUUckp94goxhxxx
```

| Status | 含义 |
|--------|------|
| 0 | 待创建 |
| 1 | 对比中 |
| 2 | 成功 |
| 3 | 失败 |

成功时关键返回字段：

| 字段 | 说明 |
|------|------|
| TotalDiffCount | 差异总数 |
| AddDiffCount | 新增数量 |
| ChangeDiffCount | 修改数量 |
| DeleteDiffCount | 删除数量 |

### 5.3 查询对比详情

```bash
python3 scripts/tencent_esign.py call DescribeContractComparisonTask '{
  "TaskId": "yDtrrUUckp94goxhxxx",
  "ShowDetail": true
}'
```

`ComparisonDetail` 每项字段：

| 字段 | 说明 |
|------|------|
| ComparisonType | add / change / delete |
| OriginText | 原文内容 |
| DiffText | 修改后内容 |
| FormatType | 0=段落 1=标点 2=页眉页脚 3=目录 4=印章 5=序号 7=下划线内容 |

### 5.4 获取对比可视化页面

```bash
python3 scripts/tencent_esign.py call DescribeContractDiffTaskWebUrl '{"TaskId": "yDtrrUUckp94goxhxxx"}'
```

返回 `WebUrl`，有效期 **20 分钟**。过期后可重新调用此接口获取新链接。

### 5.5 导出对比报告

```bash
# PDF 可视化报告
python3 scripts/tencent_esign.py call ExportContractComparisonTask '{"TaskId": "yDtrrUUckp94goxhxxx", "ExportType": 0}'

# Excel 差异明细
python3 scripts/tencent_esign.py call ExportContractComparisonTask '{"TaskId": "yDtrrUUckp94goxhxxx", "ExportType": 1}'
```

| ExportType | 说明 |
|------------|------|
| 0 | PDF 可视化对比报告 |
| 1 | Excel 差异明细表 |

---

## 6. 法条法规检索

### 6.1 检索法律法规

```bash
python3 scripts/tencent_esign.py call DescribeRiskIdentificationLawDocuments '{
  "TextSearchList": [
    {"FieldNameList": ["_text_"], "ValueList": ["劳动"]}
  ],
  "Limit": 10,
  "Offset": 0
}'
```

**按法律名称检索**：

```bash
python3 scripts/tencent_esign.py call DescribeRiskIdentificationLawDocuments '{
  "TextSearchList": [
    {"FieldNameList": ["lawName"], "ValueList": ["民法典"]}
  ],
  "Limit": 5,
  "Offset": 0
}'
```

**组合检索**（同时按名称和内容）：

```bash
python3 scripts/tencent_esign.py call DescribeRiskIdentificationLawDocuments '{
  "TextSearchList": [
    {"FieldNameList": ["lawName"], "ValueList": ["劳动合同法"]},
    {"FieldNameList": ["_text_"], "ValueList": ["经济补偿"]}
  ],
  "Limit": 10,
  "Offset": 0
}'
```

| 参数 | 必填 | 说明 |
|------|------|------|
| TextSearchList | 否 | 文本搜索条件列表，每项含 FieldNameList 和 ValueList |
| Limit | 否 | 返回数量，默认 10 |
| Offset | 否 | 偏移量，默认 0，用于分页 |

**TextSearch 字段**：

| 字段 | 说明 |
|------|------|
| FieldNameList | 搜索字段：`_text_`（全文检索）或 `lawName`（按法律名称） |
| ValueList | 搜索关键词列表 |

**返回字段**：

| 字段 | 说明 |
|------|------|
| Total | 搜索结果总数 |
| DocumentList | 法律文档列表 |

**DocumentList 每项字段**：

| API 字段 | 展示名 | 说明 |
|----------|--------|------|
| Title | 标题 | 法律名称（含修订信息） |
| LawName | 法律名称 | 法律原始名称 |
| LawNo | 文号 | 如「主席令第四十五号」 |
| Href | 原文链接 | 外部全文链接（可能为空） |
| HighlightSegmentList | 相关条款 | 匹配的条款片段列表 |

**HighlightSegmentList 每项字段**：

| 字段 | 说明 |
|------|------|
| SegmentType | 条款位置：如「正文」「第三十九条」 |
| Text | 条款原文内容 |
| SegmentNo | 片段在文档中的位置序号 |

---

## 7. 通用规则

### 鉴权

- 所有 API 调用通过 HTTP Header `Authorization` 传递 Token
- Token 来源优先级：环境变量 `ESIGN_TOKEN` > 配置文件 `~/.esign-token`
- 每次使用前必须执行 `auth-check`

### 轮询策略

- `wait-*` 命令使用线性退避（3→5→7→9→10秒封顶）
- 所有任务统一超时 600 秒
- 轮询进度输出到 stderr，不影响 stdout 的 JSON 结果

### 相关文档

- 技能规范：[SKILL.md](../SKILL.md)
- 配置文件：[config.json](../scripts/config.json)
