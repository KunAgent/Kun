# cloud-mapping 输出示例

## Markdown 示例

```markdown
| 原规格描述 | 腾讯云产品 | 腾讯云规格 | 备注 |
|---|---|---|---|
| 阿里云 ECS 通用型g7 8C32G ESSD50G+200G ×3 | CVM | S6/SA5/SA3 8核32G; 系统盘CLOUD_HSSD 50GB; 数据盘CLOUD_HSSD 200GB | g7→S6/SA5/SA3(dict:instance.md); ESSD→CLOUD_HSSD(dict:disk.md) |
| 阿里云 RDS PostgreSQL 15 HA 16C32G 1000GB | 云数据库 PostgreSQL | PostgreSQL 15; HA; 16核32G; 1000GB | dict:product-strategy.md |
| 阿里云 Redis 4G 高可用 | 云数据库 Redis | 标准架构(主从) 4GB | dict:enum-mapping.md |
| 阿里云 CLB 标准型II 100M 按量 | CLB | 共享型 公网 100Mbps | dict:enum-mapping.md; POSTPAID_BY_HOUR |
| 阿里云 ECS g7 仅族名 | CVM | S6/SA5/SA3 | dict:instance.md; [unresolved] instanceType: 缺CPU/内存 |
```

## JSON 示例

```json
{
  "mappings": [
    {
      "原规格描述": "阿里云 ECS 通用型g7 8C32G ESSD50G+200G ×3",
      "腾讯云产品": "CVM",
      "腾讯云规格": "S6/SA5/SA3 8核32G; 系统盘CLOUD_HSSD 50GB; 数据盘CLOUD_HSSD 200GB",
      "备注": "g7→S6/SA5/SA3(dict:instance.md); ESSD→CLOUD_HSSD(dict:disk.md)"
    },
    {
      "原规格描述": "阿里云 RDS PostgreSQL 15 HA 16C32G 1000GB",
      "腾讯云产品": "云数据库 PostgreSQL",
      "腾讯云规格": "PostgreSQL 15; HA; 16核32G; 1000GB",
      "备注": "dict:product-strategy.md"
    },
    {
      "原规格描述": "阿里云 ECS g7 仅族名",
      "腾讯云产品": "CVM",
      "腾讯云规格": "S6/SA5/SA3",
      "备注": "dict:instance.md; [unresolved] instanceType: 缺CPU/内存"
    }
  ]
}
```
