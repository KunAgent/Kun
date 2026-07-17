# cfw.DescribeAclRule 字段说明

## RuleAction（规则策略）

| 值 | 含义 |
|----|------|
| `accept` | 放行 |
| `drop` | 拒绝 |
| `log` | 观察 |

## Direction（流量方向）

| 值 | 含义 |
|----|------|
| `0` | 出站 |
| `1` | 入站 |

## Enable（规则启用状态）

| 值 | 含义 |
|----|------|
| `"true"` | 启用 |
| `"false"` | 禁用 |

## CommonFilter.OperatorType（过滤条件操作符）

| 值 | 含义 |
|----|------|
| `1` | 等于 (=) |
| `2` | 大于 (>) |
| `3` | 小于 (<) |
| `4` | 大于等于 (>=) |
| `5` | 小于等于 (<=) |
| `6` | 不等于 (!=) |
| `8` | NOT IN |
| `9` | 模糊匹配 (LIKE) |

## SourceType / TargetType（源/目的类型）

| 值 | 含义 |
|----|------|
| `ip` | IP 地址 |
| `net` | 网段 |
| `template` | IP 地址模板 |
| `location` | 地理位置 |
| `instance` | 实例资产 |
| `group` | 资产分组 |
| `tag` | 标签 |
| `domain` | 域名 |
| `vendor` | 云厂商 |

## Scope（生效范围）

| 值 | 含义 |
|----|------|
| `serial` | 串行 |
| `side` | 旁路 |
| `all` | 全局 |
