# BG 路由速查

> 用户用 BG 简称（CSIG / IEG / TEG / ...）提问时，对应的中文全路径匹配方式。
>
> **核心原则**：永远用中文全路径匹配，不要用英文缩写 LIKE。

---

## 为什么不能用英文缩写

组织在做命名标准化时，部分路径英文用 BG 缩写、中文用其他名字。跨语种命中范围会不一致：实测 TEG 用 `LIKE '%TEG%'` 比 `LIKE '%TEG技术工程事业群%'` 多匹配 10 个岗位、漏匹配几个一级中心。必须用 `LIKE '%TEG技术工程事业群%'`（英文前缀+中文全路径）才能精确命中。

英文缩写虽然写起来短，但召回率不稳定 —— 一次对、一次错。中文全路径虽然长，但和数仓里的标准化字段完全对齐，命中范围稳定。

---

## BG 中文全路径速查表

| BG 简称 | 错误（仅命中部分）| 正确（中文全路径）|
| --- | --- | --- |
| TEG | `LIKE '%TEG%'` | `LIKE '%TEG技术工程事业群%'` |
| CSIG | `LIKE '%CSIG%'` | `LIKE '%CSIG云与智慧产业事业群%'` |
| IEG | `LIKE '%IEG%'` | `LIKE '%IEG互动娱乐事业群%'` |
| PCG | `LIKE '%PCG%'` | `LIKE '%PCG平台与内容事业群%'` |
| WXG | `LIKE '%WXG%'` | `LIKE '%WXG微信事业群%'` |
| CDG | `LIKE '%CDG%'` | `LIKE '%CDG企业发展事业群%'` |
| S1 | `LIKE '%S1%'` | `LIKE '%S1职能系统－职能%'` |
| S2 | `LIKE '%S2%'` | `LIKE '%S2职能系统－财经%'` |
| S3 | `LIKE '%S3%'` | `LIKE '%S3职能系统－HR与管理%'` |

---

## 用法

```sql
-- 用户说 "对比 CSIG 和 IEG 的 Q1 入职"
-- 正确写法（任选其一）：

-- 方案 A：用 manager_unit_name_cn（最精确）
AND manager_unit_name_cn IN ('CSIG云与智慧产业事业群', 'CSIG云与智慧产业事业群')

-- 方案 B：用 recruit_post_belong_org_full_name 或 recruit_post_org_full_name（模糊更宽）
AND (
  recruit_post_belong_org_full_name LIKE '%CSIG云与智慧产业事业群%'
  OR recruit_post_belong_org_full_name LIKE '%IEG互动娱乐事业群%'
)
```

**两种方案如何选**：
- 业务方明确说"按管理主体"或单纯问"BG 的数据"→ 用 A
- 用户问"在 XX BG 下面工作的人"→ 用 B（按组织路径模糊匹配更符合直觉）
- 不确定时优先 A，结果再附一句"如果需要按组织路径口径，请告知"
