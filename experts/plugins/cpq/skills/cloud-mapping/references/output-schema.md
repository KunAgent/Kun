# cloud-mapping 输出格式

本文件定义 `cloud-mapping` 的规格映射输出，不包含询价、日志反查、编码反查或报价提交字段。

输出只保留核心映射信息，不含溯源定位（文件名、工作表、行号等由调用方自行关联）。

## 表格（默认，4 列）

| 列名 | 说明 |
|---|---|
| `原规格描述` | 源规格一句话摘要：`<厂商> <产品> <核心规格> ×<数量>` |
| `腾讯云产品` | 映射后的腾讯云产品 |
| `腾讯云规格` | 映射后的腾讯云规格（紧凑表达，含实例族/磁盘/地域/计费等已映射字段） |
| `备注` | 映射依据、未解析字段、候选项、假设、风险等 |

## 原规格描述 生成规则

- 格式：`<厂商> <产品> <核心规格描述> ×<数量>`
- 核心规格只写影响映射的关键参数（CPU/内存/磁盘/带宽/版本/架构）
- 不含价格、折扣、合计等金额
- 数量为 1 时 `×1` 可省略

## 备注 合并规则

- 映射依据简写：`dict:<file>` / `migraq(session:<id>)` / `user`
- 未解析字段：`[unresolved] <字段>: <原因>`
- 候选项：`[候选] <列表>`
- 假设/风险直接写入
- 无特殊说明时可只写字典来源

## JSON 格式

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

## provenance 合法来源

| 前缀 | 含义 |
|---|---|
| `dict:<file>` | 来自 `references/data/cloud-mapping/` 字典 |
| `migraq(session:<id>)` | 来自独立 `migraq` skill |
| `user:<note>` | 用户明确给定或确认 |
| `unresolved` | 未解析，不得继续伪造 |

禁止使用 `llm_inference`、`llm_knowledge`、`ai_guess`、`model_memory` 等表示模型猜测的来源。

## Excel 输出脚本

```bash
echo '<json>' | python3 scripts/write_result.py <output.xlsx>
python3 scripts/write_result.py <output.xlsx> <input.json>
```
