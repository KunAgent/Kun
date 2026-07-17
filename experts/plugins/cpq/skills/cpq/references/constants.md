# 常量定义

以下常量在命令描述中以 `${NAME}` 形式引用：

- **DEFAULT_PAGE_SIZE**: 20
- **GLOBAL_GET_FIELDS_DESC**: tc_level(客户收入所在分层), recommendDiscountStrategy(AI推荐折扣策略)
- **GLOBAL_SET_FIELDS_DESC**: customerYearExpenseCompetitor(客户在友商(公有云)年消)
- **SUPPORTED_FIELDS_DESC**: id(节点ID), name(产品名称), preference(优惠), priceBeforeDiscount(预估消耗/折前价), priceAfterDiscount(折后总价(含税)), priceAfterDiscountDeleteTax(折后总价(不含税)), taxRate(税率), saleMode(售卖模式), quantityAdviceDiscount(量价建议折扣), spuCode(spuCode), productCode(产品code(一层)), subProductCode(子产品code(二层)), billingItemCode(计费项code(三层)), subBillingItemCode(子计费项code(四层))
- **UPDATABLE_FIELDS_DESC**: priceBeforeDiscount, priceAfterDiscount, priceAfterDiscountDeleteTax, rebate, taxRate, remark, preference
