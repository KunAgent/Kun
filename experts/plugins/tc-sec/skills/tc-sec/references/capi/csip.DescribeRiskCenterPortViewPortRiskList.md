# csip.DescribeRiskCenterPortViewPortRiskList 字段说明

## Level（风险等级 — 字符串体系）

> 端口/服务/漏洞等风险使用字符串等级，与 AK 风险的数字等级体系不同。

| 值 | 含义 |
|----|------|
| `extreme` | 严重 |
| `high` / `high_risk` | 高 |
| `middle` | 中 |
| `low` | 低 |
| `info` / `normal` | 提示 |

## Suggestion（处置建议）

| 值 | 含义 |
|----|------|
| `0` | 无需处理 |
| `1` | 建议处理 |
| `2` | 紧急处理 |

## 双体系说明

CSIP 存在两套风险等级体系，严禁混淆：
- **字符串等级**（端口/服务/漏洞等风险）：`extreme`/`high`/`middle`/`low`/`info`
- **数字等级**（AK 风险/云 API 异常告警）：`5`/`4`/`3`/`2`/`1`
