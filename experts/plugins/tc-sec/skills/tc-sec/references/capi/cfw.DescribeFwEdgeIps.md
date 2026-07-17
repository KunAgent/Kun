# cfw.DescribeFwEdgeIps 字段说明

## Status（防护状态）

| 值 | 含义 |
|----|------|
| `0` | 未开启防护 |
| `1` | 已开启防护 |
| `2` | 开启中 |
| `3` | 关闭中 |
| `4` | 异常 |

## SwitchMode（串行/旁路模式）

| 值 | 含义 |
|----|------|
| `0` | 旁路 |
| `1` | 串行 |
| `2` | 切换中 |

## 统计方式

```bash
# 统计已开启/未开启防护数量
tccli cfw DescribeFwEdgeIps --Limit 100 | jq '{
  已开启防护: [.Data[] | select(.Status==1)] | length,
  未开启防护: [.Data[] | select(.Status==0)] | length
}'
```

> **注意**：同名 `Status` 在不同 CFW 接口中含义不同（如开关中 Status=0 是"关闭"，但同步状态中 Status=0 是"完成"）。展示时必须使用 agent.py 注入的 `status_label` 字段，禁止自行解读数字。
