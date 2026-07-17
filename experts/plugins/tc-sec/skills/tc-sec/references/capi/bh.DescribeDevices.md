# bh.DescribeDevices 字段说明

## Kind（设备类型）

| 值 | 含义 |
|----|------|
| `1` | Linux |
| `2` | Windows |
| `3` | 数据库/MySQL |
| `4` | 数据库 |
| `8` | Windows 域控 |
| `11` | K8s 集群 |
| `12` | TKE 集群 |

## TotalCount 注意事项

`TotalCount` 是资产树中的设备总数（包含未纳管设备），**不等于已纳管设备数**。

判断设备是否已纳管的唯一标准：`Resource != null 且 Resource.ResourceId 不为空`（已绑定堡垒机实例）。

| ❌ 错误 | ✅ 正确 |
|--------|--------|
| 纳管设备总数 30 台 | 资产树总数 30 台，其中已纳管 3 台 |

## 优先获取方式

获取纳管资产数量时，优先使用 `DescribeDeviceCount`（HTTP 方式）：
- 不传 `BindResource` → 资产总数
- `BindResource=1` → 已纳管数量
