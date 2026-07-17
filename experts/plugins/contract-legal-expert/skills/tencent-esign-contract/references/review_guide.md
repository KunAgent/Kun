# 合同审查 — 详细操作指南

本文档为合同审查的详细操作指南，由 SKILL.md 引用。执行审查流程时阅读本文档。

## 阶段 1：引导上传

如果用户提供了文件路径，直接上传。否则引导：「请提供需要审查的合同文件路径（支持 PDF/Word，最多 5 份，每份 ≤10M）。」

**文件格式处理**：仅支持 `.pdf`、`.docx`、`.doc` 格式。如果用户提供了其他格式（如 `.md`、`.txt`、`.html`、`.rst` 等文本文件），需要先转换为 `.docx`：
- 告知用户：「该文件格式（{ext}）暂不支持直接审查，我来帮你转换为 Word 格式后再审查。」
- 编写 Python 脚本完成转换（利用 `python-docx` 等库，或读取文本内容写入 docx），转换后使用生成的 `.docx` 文件上传
- 如果环境缺少依赖无法自动转换，提示用户：「请先将文件转换为 PDF 或 Word（.docx）格式后再提供给我。」

确认审查尺度（可默认不问，除非用户主动提及）：
- `0` — 严格（默认）：侧重保护己方利益
- `1` — 中立：平衡双方权利义务
- `2` — 宽松：侧重促成交易

上传文件后创建任务：

```bash
python3 scripts/tencent_esign.py call CreateBatchContractReviewTask '{"ResourceIds":["<id>"],"PolicyType":0}'
```

返回示例：`{"Response": {"TaskIds": ["yDtIFUU2xxx"], "RequestId": "xxx"}}`
取 `resp["Response"]["TaskIds"][0]` 作为后续轮询的 TaskId（注意是数组，不是字符串）。

## 阶段 2：审查处理中

```bash
python3 scripts/tencent_esign.py wait-review <TaskId>
```

审查通常需要 1-3 分钟，长文档可能更久。等待期间可以尝试获取可视化页面链接供用户查看进度：

```bash
python3 scripts/tencent_esign.py call DescribeContractReviewWebUrl '{"TaskId":"<task_id>"}'
```

如果返回 `WebUrl`，告知用户：「审查进行中，你可以 [点击这里]({WebUrl}) 实时查看进度。」

## 阶段 3：审查完成 — 返回值解析

`wait-review` 返回的 JSON 结构如下（所有字段均在 `Response` 内）：

```json
{
  "Response": {
    "Status": 4,
    "TotalRiskCount": 5,
    "HighRiskCount": 2,
    "Risks": [
      {
        "RiskName": "违约责任缺失",
        "RiskLevel": "高风险",
        "Content": "合同中原文...",
        "RiskDescription": "该条款存在...",
        "RiskAdvice": "建议增加...",
        "CategoryName": "违约责任"
      }
    ],
    "Summaries": ["摘要1", "摘要2"],
    "RequestId": "xxx"
  }
}
```

**解析步骤**（严格按此路径取值，不要对字符串调用 `.keys()` 等字典方法）：

1. `resp = json.loads(output)` — 解析整个 JSON 字符串
2. `response = resp["Response"]` — 取 Response 对象（dict）
3. `risks = response["Risks"]` — 取 Risks 数组（list），每个元素是 dict
4. 遍历 `risks` 数组，每个 `risk` 是一个 dict，通过 `risk["RiskName"]`、`risk["RiskLevel"]` 等取值

## 阶段 3：审查完成 — 展示规则

1. **概览**：「共发现 **{Response.TotalRiskCount}** 项风险，其中高风险 **{Response.HighRiskCount}** 项。」

2. **风险列表**（对 `Response.Risks` 数组按等级排序：高风险 → 中风险 → 低风险 → 提示）：

| 序号 | 风险名称 | 等级 | 原文 | 描述 | 修改建议 |
|------|----------|------|------|------|----------|

每行对应 `Risks` 数组中的一个 dict 元素，字段映射：`risk["RiskName"]` → 风险名称、`risk["RiskLevel"]` → 等级、`risk["Content"]` → 原文、`risk["RiskDescription"]` → 描述、`risk["RiskAdvice"]` → 修改建议

风险项超过 10 条时，先展示高风险项，其余折叠或追问用户是否需要查看完整列表。

3. **获取链接**（审查完成后并行调用）：

```bash
python3 scripts/tencent_esign.py call DescribeContractReviewWebUrl '{"TaskId":"<task_id>"}'
python3 scripts/tencent_esign.py call ExportContractReviewResult '{"TaskId":"<task_id>","FileType":1}'
python3 scripts/tencent_esign.py call ExportContractReviewResult '{"TaskId":"<task_id>","FileType":2}'
```

风险表格之后紧跟链接：

> 📊 [在线查看审查结果]({WebUrl})（20 分钟内有效）
> · 📝 [下载带风险批注的文件]({ExportUrl})（20 分钟内有效）
> · 📋 [下载审查结果摘要（Excel）]({ExportUrl})（20 分钟内有效）

## 阶段 4：重新审查（可选）

用户选择重新审查时，引导补充审查要求：「请告诉我你希望重点关注的审查方向（如：知识产权、违约责任、保密条款等）」。将要求写入 `Comment` 字段，重新调用审查接口。

## 阶段 5：按建议重新起草（可选）

将审查发现的风险建议整合为起草需求，告知用户：「除了按风险建议修订外，你还有其他要补充的内容吗？如果没有，回复「立即起草」我就开始。」确认后进入合同起草流程。
