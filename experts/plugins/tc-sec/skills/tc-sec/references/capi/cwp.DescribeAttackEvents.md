# cwp.DescribeAttackEvents 字段说明

> 网络攻击事件接口。

## Type（攻击结果）

| 值 | 含义 |
|----|------|
| `0` | 攻击未成功 |
| `1` | 攻击成功 |

## 注意事项

- `get_successful_attack_events()` 内部即通过 `Type=1` 过滤攻击成功事件。
- 统计数值必须取 API 的 `TotalCount` 字段，禁止用 `len(当前页列表)` 当总数。
