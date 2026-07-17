# 合同对比 — 详细操作指南

本文档为合同对比的详细操作指南，由 SKILL.md 引用。执行对比流程时阅读本文档。

## 阶段 1：引导上传

引导用户提供两份文件：「请提供需要对比的两份合同文件——原版和新版（支持 PDF/Word 格式）。」

**文件格式处理**：仅支持 `.pdf`、`.docx`、`.doc`。其他文本格式需先转换为 `.docx`（同审查流程）。

上传两份文件获取两个 ResourceId，然后创建对比任务：

```bash
python3 scripts/tencent_esign.py call CreateContractComparisonTask '{"OriginFileResourceId":"<origin_id>","DiffFileResourceId":"<diff_id>"}'
```

## 阶段 2：对比处理中

```bash
python3 scripts/tencent_esign.py wait-compare <TaskId>
```

对比通常几秒到一分钟内完成。可尝试获取对比页面链接：

```bash
python3 scripts/tencent_esign.py call DescribeContractDiffTaskWebUrl '{"TaskId":"<task_id>"}'
```

## 阶段 3：对比完成 — 返回值解析

`wait-compare` 返回的 JSON 结构：

```json
{
  "Response": {
    "Status": 2,
    "TotalDiffCount": 12,
    "AddDiffCount": 3,
    "ChangeDiffCount": 7,
    "DeleteDiffCount": 2,
    "RequestId": "xxx"
  }
}
```

1. **概览**（从 `Response` 对象取值）：「共发现 **{Response.TotalDiffCount}** 处差异：新增 {Response.AddDiffCount} 处、修改 {Response.ChangeDiffCount} 处、删除 {Response.DeleteDiffCount} 处。」

2. **获取差异详情和链接**（`wait-compare` 不含具体内容，需并行调用以下接口）：

```bash
python3 scripts/tencent_esign.py call DescribeContractComparisonTask '{"TaskId":"<task_id>","ShowDetail":true}'
python3 scripts/tencent_esign.py call DescribeContractDiffTaskWebUrl '{"TaskId":"<task_id>"}'
python3 scripts/tencent_esign.py call ExportContractComparisonTask '{"TaskId":"<task_id>","ExportType":0}'
python3 scripts/tencent_esign.py call ExportContractComparisonTask '{"TaskId":"<task_id>","ExportType":1}'
```

`DescribeContractComparisonTask`（ShowDetail=true）返回的 JSON 结构：

```json
{
  "Response": {
    "Status": 2,
    "TotalDiffCount": 12,
    "ComparisonDetail": [
      {
        "ComparisonType": "change",
        "OriginText": "原文内容...",
        "DiffText": "修改后内容...",
        "PageNumber": 3,
        "FormatType": 0
      }
    ],
    "RequestId": "xxx"
  }
}
```

**解析步骤**（严格按此路径取值，不要对字符串调用 `.keys()` 等字典方法）：

1. `resp = json.loads(output)` — 解析整个 JSON 字符串
2. `response = resp["Response"]` — 取 Response 对象（dict）
3. `details = response["ComparisonDetail"]` — 取差异数组（list），每个元素是 dict
4. 遍历 `details` 数组，每个 `item` 是一个 dict，通过 `item["ComparisonType"]`、`item["OriginText"]` 等取值

## 阶段 3：对比完成 — 展示规则

**差异明细表格**：

| 序号 | 类型 | 原文 | 修改后 | 页码 |
|------|------|------|--------|------|

每行对应 `ComparisonDetail` 数组中的一个 dict 元素，字段映射：`item["ComparisonType"]` → 类型、`item["OriginText"]` → 原文、`item["DiffText"]` → 修改后、`item["PageNumber"]` → 页码

`ComparisonType` 中文映射：`"add"` → 新增、`"change"` → 修改、`"delete"` → 删除

展示规则：
- **≤ 10 条**：全部展示
- **> 10 条**：展示前 5 条，其余折叠，提示「还有 N 条差异，是否展开查看全部？或直接下载 Excel 明细查看完整列表。」
- 删除类型的「修改后」列显示为「—」，新增类型的「原文」列显示为「—」

差异表格之后紧跟链接：

> 📊 [在线预览对比结果]({WebUrl})（20 分钟内有效）
> · 📝 [下载带批注的结果文件（PDF）]({ExportUrl})（20 分钟内有效）
> · 📋 [下载差异明细（Excel）]({ExportUrl})（20 分钟内有效）

用户选择刷新链接时，重新调用 `DescribeContractDiffTaskWebUrl` 和 `ExportContractComparisonTask` 获取新链接并展示。
