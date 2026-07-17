# 工业生产者出厂价格指数（PPI）

> 接口：`cn_ppi` | 获取工业生产者出厂价格指数数据

## 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| m | str | N | 月份（YYYYMM格式，支持逗号分隔多月） |
| start_m | str | N | 开始月份 |
| end_m | str | N | 结束月份 |

**限量：** 单次最大5000条。**权限：** 用户需至少600积分。

## 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| month | str | 月份 |
| ppi_yoy | float | 全部工业品同比 |
| ppi_mp_yoy | float | 生产资料同比 |
| ppi_mp_qm_yoy | float | 生产资料-采掘业同比 |
| ppi_mp_rm_yoy | float | 生产资料-原材料同比 |
| ppi_mp_p_yoy | float | 生产资料-加工业同比 |
| ppi_cg_yoy | float | 生活资料同比 |
| ppi_cg_f_yoy | float | 生活资料-食品同比 |
| ppi_cg_c_yoy | float | 生活资料-衣着同比 |
| ppi_cg_adu_yoy | float | 生活资料-日用品同比 |
| ppi_cg_dcg_yoy | float | 生活资料-耐用品同比 |
| ppi_mom | float | 全部工业品环比 |
| ppi_mp_mom | float | 生产资料环比 |
| ppi_mp_qm_mom | float | 生产资料-采掘业环比 |
| ppi_mp_rm_mom | float | 生产资料-原材料环比 |
| ppi_mp_p_mom | float | 生产资料-加工业环比 |
| ppi_cg_mom | float | 生活资料环比 |
| ppi_cg_f_mom | float | 生活资料-食品环比 |
| ppi_cg_c_mom | float | 生活资料-衣着环比 |
| ppi_cg_adu_mom | float | 生活资料-日用品环比 |
| ppi_cg_dcg_mom | float | 生活资料-耐用品环比 |
| ppi_accu | float | 全部工业品累计同比 |
| ppi_mp_accu | float | 生产资料累计同比 |
| ppi_mp_qm_accu | float | 生产资料-采掘业累计同比 |
| ppi_mp_rm_accu | float | 生产资料-原材料累计同比 |
| ppi_mp_p_accu | float | 生产资料-加工业累计同比 |
| ppi_cg_accu | float | 生活资料累计同比 |
| ppi_cg_f_accu | float | 生活资料-食品累计同比 |
| ppi_cg_c_accu | float | 生活资料-衣着累计同比 |
| ppi_cg_adu_accu | float | 生活资料-日用品累计同比 |
| ppi_cg_dcg_accu | float | 生活资料-耐用品累计同比 |

## 调用示例

```bash
curl -X POST https://www.codebuddy.cn/v2/tool/financedata \
  -H "Content-Type: application/json" \
  -d '{
    "api_name": "cn_ppi",
    "params": {"m": "202501"},
    "fields": ""
  }'
```

## 返回示例

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "fields": ["month", "ppi_yoy", "ppi_mp_yoy", "ppi_mp_qm_yoy", "ppi_mp_rm_yoy", "ppi_mp_p_yoy", "ppi_cg_yoy", "ppi_cg_f_yoy", "ppi_cg_c_yoy", "ppi_cg_adu_yoy", "ppi_cg_dcg_yoy", "ppi_mom", "ppi_mp_mom", "ppi_mp_qm_mom", "ppi_mp_rm_mom", "ppi_mp_p_mom", "ppi_cg_mom", "ppi_cg_f_mom", "ppi_cg_c_mom", "ppi_cg_adu_mom", "ppi_cg_dcg_mom", "ppi_accu", "ppi_mp_accu", "ppi_mp_qm_accu", "ppi_mp_rm_accu", "ppi_mp_p_accu", "ppi_cg_accu", "ppi_cg_f_accu", "ppi_cg_c_accu", "ppi_cg_adu_accu", "ppi_cg_dcg_accu"],
    "items": [
      ["202501", -2.3, -2.6, -4.9, -1.9, -2.7, -1.2, -1.4, -0.1, 0.5, -2.6, -0.2, -0.2, -0.2, 0.0, -0.3, 0.0, -0.2, -0.2, -0.1, 0.2, -2.3, -2.6, -4.9, -1.9, -2.7, -1.2, -1.4, -0.1, 0.5, -2.6]
    ]
  }
}
```
