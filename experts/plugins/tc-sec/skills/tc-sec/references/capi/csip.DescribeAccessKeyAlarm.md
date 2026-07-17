# csip.DescribeAccessKeyAlarm 字段说明

> **API 说明**：`DescribeAccessKeyAlarm` 返回 AKSK 异常告警列表，`Total` 是**告警条数**，不是 AKSK 密钥总数。
> **AKSK 密钥（资产）总数**请用 `DescribeAccessKeyAsset`，其 `Total` 才是账号下 AK 资产总量。
> 两个 API 不要混用 `Total` 字段：告警 Total ≠ 密钥 Total。

## Level（风险等级 — 数字体系）

> CSIP 的 AK 风险/云 API 异常告警使用数字等级，与端口/漏洞等字符串等级体系不同，禁止混淆。

| 值 | 含义 |
|----|------|
| `1` | 提示 |
| `2` | 低危 |
| `3` | 中危 |
| `4` | 高危 |
| `5` | 严重 |

## AIStatus（AI 分析状态）

| 值 | 含义 |
|----|------|
| `-1` | 分析失败（查看 AIFailedReason） |
| `0` | 未分析 |
| `1` | 分析中 |
| `2` | 分析完成，真实告警 |
| `3` | 分析完成，可疑告警 |
| `4` | 不支持分析 |

> **重要**：`DescribeAccessKeyAlarmDetail` 返回的 `AIStatus` 不准确，应通过 `DescribeAKAnalysisDetail` 获取正确值。agent.py 的 `get_ak_alarm_detail()` 已自动处理。
