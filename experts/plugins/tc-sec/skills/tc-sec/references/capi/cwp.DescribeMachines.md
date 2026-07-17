# cwp.DescribeMachines 字段说明

> 主机列表接口。通过 `get_machine_list()` 封装函数调用。

## Filters.Status（主机状态）过滤值

| 值 | 含义 |
|----|------|
| `OFFLINE` | 离线 |
| `UNINSTALLED` | 未安装 Agent（裸奔机器，需 MachineType=ALL） |
| `ONLINE` | 在线 |

## MachineType（机器类型）

| 值 | 含义 |
|----|------|
| `CVM` | 云服务器 |
| `BM` | 黑石物理机 |
| `LH` | 轻量应用服务器 |
| `ECM` | 边缘计算机器 |
| `Other` | 其他云机器 |
| `ALL` | 全部类型 |

## 注意事项

- 查询 `UNINSTALLED`（未安装 Agent）时必须指定 `MachineType=ALL`，否则可能遗漏其他类型。
- 离线时间字段需通过 `DescribeAssetMachineList` 补充（`DescribeMachines` 不直接返回 OfflineTime）。
