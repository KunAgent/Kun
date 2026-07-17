# 针对新商品库（spuCode）产品，通过定价项、优惠类型、规格三级结构完成优惠 JSON 组装并写入报价行

1. `row cat --key preference --id row_id` — 查看新 SPU 的完整配置，返回内容包含：
   - 可选的**定价项**列表（PricingCode / PricingName）
   - 每个定价项支持的**优惠类型**
   - 每个优惠类型下的**规格**列表及其属性（是否必填、单选/多选）
   - 每个规格的可选值列表
2. 根据用户需求选择定价项，逐项确认规格值（必填规格必须提供，值必须从可选值中选取）
3. 组装优惠 JSON（格式参见下方 JSON 模板）
4. `row update --id "报价行id" --key "preference" --value 'json'` — 设置优惠

## 新商品库优惠 JSON 模板

```json
[
  {
    "PricingCode": "spu_cvm_instance_ms_intl/instance",
    "PricingName": "实例",
    "DiscountType": "discount",
    "DiscountValue": 1,
    "Specs": {
      "instanceFamily": "SA9,S9",
      "region": "ap-bangkok,ap-beijing"
    }
  }
]
```
