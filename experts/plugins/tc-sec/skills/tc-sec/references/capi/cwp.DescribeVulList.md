# cwp.DescribeVulList 字段说明

## VulLevel（漏洞等级）过滤参数

| 值 | 含义 |
|----|------|
| `1` | 低危 |
| `2` | 中危 |
| `3` | 高危 |
| `4` | 严重 |

## VulCategory（漏洞类别）

| 值 | 含义 |
|----|------|
| `0` | 全部 |
| `1` | Web-CMS 漏洞 |
| `2` | 应用漏洞 |
| `4` | Linux 软件漏洞 |
| `5` | Windows 系统漏洞 |

## 注意事项

- API 不支持通过 `VulLevel` 作为 Filters 字段过滤，若需按等级筛选需客户端过滤，或使用 `By=Level` + `Order=desc` 排序优先展示高危漏洞。
