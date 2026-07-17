# 宏观经济指标字段说明

本文档列出 `westock-data macro` 命令返回的所有字段及其含义。

> 数据来源：腾讯自选股宏观经济数据接口

## 指标列表

| 指标代码 | 名称 | 查询方式 |
| -------- | ---- | -------- |
| `gdp` | GDP数量指标 | `--year` |
| `cpi_ppi` | GDP价格指标(CPI/PPI) | `--year` |
| `pmi` | GDP供给指标(PMI) | `--year` |
| `profit` | GDP供给指标(工业企业利润) | `--year` |
| `value_added` | GDP供给指标(工业增加值) | `--year` |
| `consumption` | GDP需求指标(消费) | `--year` |
| `investment` | GDP需求指标(投资) | `--year` |
| `financing` | 货币需求指标(融资) | `--year` |
| `fundquantity` | 货币供给指标(数量) | `--year` |
| `fundcost` | 货币供给指标(利率) | `--year` |
| `core_indicatros_cur` | 最新核心宏观指标(综合) | `--date` |

---

## GDP数量指标

| 字段 | 说明 |
| ---- | ---- |
| `CONTRI_ALGRICULTURE_CUM` | GDP贡献率:农林牧渔业:累计值:季(%) |
| `CONTRI_BUILD_CUM` | GDP贡献率:建筑业:累计值:季(%) |
| `CONTRI_CAPITAL_CUM` | GDP贡献率:资本形成总额:累计值:季(%) |
| `CONTRI_CAPITAL_CUR` | GDP贡献率:资本形成总额:当期值:季(%) |
| `CONTRI_CONSUME_CUM` | GDP贡献率:最终消费支出:累计值:季(%) |
| `CONTRI_CONSUME_CUR` | GDP贡献率:最终消费支出:当期值:季(%) |
| `CONTRI_FINANCE_CUM` | GDP贡献率:金融业:累计值:季(%) |
| `CONTRI_FIRST_CUM` | GDP贡献率:第一产业:累计值:季(%) |
| `CONTRI_FIRST_CUR` | GDP贡献率:第一产业:当期值:季(%) |
| `CONTRI_IMPORT_CUM` | GDP贡献率:货物和服务净出口:累计值:季(%) |
| `CONTRI_IMPORT_CUR` | GDP贡献率:货物和服务净出口:当期值:季(%) |
| `CONTRI_IT_CUM` | GDP贡献率:信息传输、软件和信息技术服务业:累计值:季(%) |
| `CONTRI_MANUFACTURE_CUM` | GDP贡献率:工业:累计值:季(%) |
| `CONTRI_OTHER_CUM` | GDP贡献率:其他服务业:累计值:季(%) |
| `CONTRI_REALESTATE_CUM` | GDP贡献率:房地产业:累计值:季(%) |
| `CONTRI_RENT_CUM` | GDP贡献率:租赁和商务服务业:累计值:季(%) |
| `CONTRI_RESTERAUNT_CUM` | GDP贡献率:住宿和餐饮业:累计值:季(%) |
| `CONTRI_RETAIL_CUM` | GDP贡献率:批发和零售业:累计值:季(%) |
| `CONTRI_SECOND_CUM` | GDP贡献率:第二产业:累计值:季(%) |
| `CONTRI_SECOND_CUR` | GDP贡献率:第二产业:当期值:季(%) |
| `CONTRI_THIRD_CUM` | GDP贡献率:第三产业:累计值:季(%) |
| `CONTRI_THIRD_CUR` | GDP贡献率:第三产业:当期值:季(%) |
| `CONTRI_TRANSPORT_CUM` | GDP贡献率:交通运输、仓储和邮政业:累计值:季(%) |
| `GDP_ENDDATE` | GDP指标截止日期 |
| `GDP_INFOPUBLDATE` | GDP指标发布日期 |
| `NOMINAL_GDP_CUM` | GDP(现价):累计值:季(亿) |
| `NOMINAL_GDP_CUM_YOY` | GDP(现价):累计同比:季(亿) |
| `NOMINAL_GDP_CUR` | GDP(现价):当期值:季(亿) |
| `NOMINAL_GDP_CUR_YOY` | GDP(现价):当期同比:季(亿) |
| `PULL_ALGRICULTURE_CUM` | GDP拉动率:农林牧渔业:累计值:季(%) |
| `PULL_BUILD_CUM` | GDP拉动率:建筑业:累计值:季(%) |
| `PULL_CAPITAL_CUM` | GDP拉动率:资本形成总额:累计值:季(%) |
| `PULL_CAPITAL_CUR` | GDP拉动率:资本形成总额:当期值:季(%) |
| `PULL_CONSUME_CUM` | GDP拉动率:最终消费支出:累计值:季(%) |
| `PULL_CONSUME_CUR` | GDP拉动率:最终消费支出:当期值:季(%) |
| `PULL_FINANCE_CUM` | GDP拉动率:金融业:累计值:季(%) |
| `PULL_FIRST_CUM` | GDP拉动率:第一产业:累计值:季(%) |
| `PULL_FIRST_CUR` | GDP拉动率:第一产业:当期值:季(%) |
| `PULL_IMPORT_CUM` | GDP拉动率:货物和服务净出口:累计值:季(%) |
| `PULL_IMPORT_CUR` | GDP拉动率:货物和服务净出口:当期值:季(%) |
| `PULL_IT_CUM` | GDP拉动率:信息传输、软件和信息技术服务业:累计值:季(%) |
| `PULL_MANUFACTURE_CUM` | GDP拉动率:工业:累计值:季(%) |
| `PULL_OTHER_CUM` | GDP拉动率:其他服务业:累计值:季(%) |
| `PULL_REALESTATE_CUM` | GDP拉动率:房地产业:累计值:季(%) |
| `PULL_RENT_CUM` | GDP拉动率:租赁和商务服务业:累计值:季(%) |
| `PULL_RESTERAUNT_CUM` | GDP拉动率:住宿和餐饮业:累计值:季(%) |
| `PULL_RETAIL_CUM` | GDP拉动率:批发和零售业:累计值:季(%) |
| `PULL_SECOND_CUM` | GDP拉动率:第二产业:累计值:季(%) |
| `PULL_SECOND_CUR` | GDP拉动率:第二产业:当期值:季(%) |
| `PULL_THIRD_CUM` | GDP拉动率:第三产业:累计值:季(%) |
| `PULL_THIRD_CUR` | GDP拉动率:第三产业:当期值:季(%) |
| `PULL_TRANSPORT_CUM` | GDP拉动率:交通运输、仓储和邮政业:累计值:季(%) |
| `REAL_GDP_CUM` | GDP(不变价):累计值:季(亿) |
| `REAL_GDP_CUM_YOY` | GDP(不变价):累计同比:季(%) |
| `REAL_GDP_CUR` | GDP(不变价):当期值:季(亿) |
| `REAL_GDP_CUR_YOY` | GDP(不变价):当期同比:季(%) |

## CPI/PPI（GDP价格指标）

| 字段 | 说明 |
| ---- | ---- |
| `CPI_PPI_ENDDATE` | CPI-PPI指标截止日期 |
| `CPI_PPI_INFOPUBLDATE` | CPI-PPI指标发布日期 |
| `CPI_YOY` | CPI:当期同比:月(%) |
| `CPI_YOY_CORE` | CPI:不包括食品和能源:当期同比:月(%) |
| `CPI_YOY_FOOD` | CPI:食品类:当期同比:月(%) |
| `CPI_YOY_JTTX` | CPI:交通和通信类:当期同比:月(%) |
| `CPI_YOY_JYWY` | CPI:教育文化和娱乐类:当期同比:月(%) |
| `CPI_YOY_JZ` | CPI:居住类:当期同比:月(%) |
| `CPI_YOY_NON_FOOD` | CPI:非食品类:当期同比:月(%) |
| `CPI_YOY_OTHER` | CPI:其他用品和服务类:当期同比:月(%) |
| `CPI_YOY_SHYP` | CPI:生活用品及服务类:当期同比:月(%) |
| `CPI_YOY_SPYJ` | CPI:食品烟酒类:当期同比:月(%) |
| `CPI_YOY_YLBJ` | CPI:医疗保健类:当期同比:月(%) |
| `CPI_YOY_YZ` | CPI:衣着类:当期同比:月(%) |
| `PPIRM_MOM` | 工业生产者购进价格指数PPIRM:环比:月(%) |
| `PPIRM_MOM_AGRICULTURE` | 工业生产者购进价格指数PPIRM:农副产品类:环比:月(%) |
| `PPIRM_MOM_BLACK_METAL` | 工业生产者购进价格指数PPIRM:黑色金属材料类:环比:月(%) |
| `PPIRM_MOM_BUILDING` | 工业生产者购进价格指数PPIRM:建筑材料类:环比:月(%) |
| `PPIRM_MOM_CHEMICAL_METAL` | 工业生产者购进价格指数PPIRM:化工原料类:环比:月(%) |
| `PPIRM_MOM_FUEL` | 工业生产者购进价格指数PPIRM:燃料、动力类:环比:月(%) |
| `PPIRM_MOM_INDUSTRIAL` | 工业生产者购进价格指数PPIRM:其他工业原材料及半成品类:环比:月(%) |
| `PPIRM_MOM_NONFERROUS_METAL` | 工业生产者购进价格指数PPIRM:有色金属材料类:环比:月(%) |
| `PPIRM_MOM_TEXTILE` | 工业生产者购进价格指数PPIRM:纺织原料类:环比:月(%) |
| `PPIRM_MOM_TIMBER` | 工业生产者购进价格指数PPIRM:木材及纸浆类:环比:月(%) |
| `PPIRM_YOY` | 工业生产者购进价格指数PPIRM:当期同比:月(%) |
| `PPIRM_YOY_AGRICULTURE` | 工业生产者购进价格指数PPIRM:农副产品类:当期同比:月(%) |
| `PPIRM_YOY_BLACK_METAL` | 工业生产者购进价格指数PPIRM:黑色金属材料类:当期同比:月(%) |
| `PPIRM_YOY_BUILDING` | 工业生产者购进价格指数PPIRM:建筑材料类:当期同比:月(%) |
| `PPIRM_YOY_CHEMICAL_METAL` | 工业生产者购进价格指数PPIRM:化工原料类:当期同比:月(%) |
| `PPIRM_YOY_FUEL` | 工业生产者购进价格指数PPIRM:燃料、动力类:当期同比:月(%) |
| `PPIRM_YOY_INDUSTRIAL` | 工业生产者购进价格指数PPIRM:其他工业原材料及半成品类:当期同比:月(%) |
| `PPIRM_YOY_NONFERROUS_METAL` | 工业生产者购进价格指数PPIRM:有色金属材料类:当期同比:月(%) |
| `PPIRM_YOY_TEXTILE` | 工业生产者购进价格指数PPIRM:纺织原料类:当期同比:月(%) |
| `PPIRM_YOY_TIMBER` | 工业生产者购进价格指数PPIRM:木材及纸浆类:当期同比:月(%) |
| `PPI_YOY` | PPI:当期同比:月(%) |
| `PPI_YOY_CONSUM` | PPI:耐用消费品类:当期同比:月(%) |
| `PPI_YOY_FOOD` | PPI:食品类:当期同比:月(%) |
| `PPI_YOY_LIVE` | PPI:生活资料:当期同比:月(%) |
| `PPI_YOY_PRODUCE` | PPI:生产资料:当期同比:月(%) |
| `PPI_YOY_USE` | PPI:一般日用品类:当期同比:月(%) |
| `PPI_YOY_WEAR` | PPI:衣着类:当期同比:月(%) |
| `PRICE_SCISSORS_CPI_PPI` | CPI-PPI:当期同比:月(%) |
| `PRICE_SCISSORS_CPI_PPI_FOOD` | CPI-PPI:食品类:当期同比:月(%) |
| `PRICE_SCISSORS_PPI_PPIRM` | PPI-PPIRM:当期同比:月(%) |

## PMI（GDP供给指标）

| 字段 | 说明 |
| ---- | ---- |
| `PMI_COMPREHENSIVE_CCZS` | 综合PMI:产出指数:季调:月 |
| `PMI_COMPREHENSIVE_CCZS_MOM` | 综合PMI:产出指数:季调:环比:月(%) |
| `PMI_ENDDATE` | PMI指标截止日期 |
| `PMI_INFOPUBLDATE` | PMI指标发布日期 |
| `PMI_MANU` | 制造业PMI:季调:月 |
| `PMI_MANU_CUR_YOY` | 制造业PMI:当期同比:月(%) |
| `PMI_MANU_IMPORT` | 制造业PMI:进口:季调:月 |
| `PMI_MANU_MOM` | 制造业PMI:季调:环比:月(%) |
| `PMI_MANU_ORDER_EXPORT` | 制造业PMI:新出口订单:季调:月 |
| `PMI_MANU_ORDER_INHAND` | 制造业PMI:在手订单:季调:月 |
| `PMI_MANU_ORDER_NEW` | 制造业PMI:新订单:季调:月 |
| `PMI_MANU_PRODUCE` | 制造业PMI:生产:季调:月 |
| `PMI_MANU_PRODUCT_INVENTORY` | 制造业PMI:产成品库存:季调:月 |
| `PMI_MANU_PURCHASE` | 制造业PMI:采购量:季调:月 |
| `PMI_MANU_RAWMATERIAL_INVENTORY` | 制造业PMI:原材料库存:季调:月 |
| `PMI_MANU_RAWMATERIAL_PURCHASE` | 制造业PMI:主要原材料购进价格:季调:月 |
| `PMI_NON_MANU_BUSINESS_ACTIVITY` | 非制造业PMI:商务活动:季调:月 |
| `PMI_NON_MANU_MATERIAL_PRICE` | 非制造业PMI:投入品价格:季调:月 |
| `PMI_NON_MANU_ORDER_EXPORT` | 非制造业PMI:新出口订单:季调:月 |
| `PMI_NON_MANU_ORDER_NEW` | 非制造业PMI:新订单:季调:月 |

## 工业企业利润（GDP供给指标）

| 字段 | 说明 |
| ---- | ---- |
| `ENTERPRISE_PROFIT_CUM` | 规模以上工业企业利润总额:累计值:月 |
| `ENTERPRISE_PROFIT_CUM_YOY` | 规模以上工业企业利润总额:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_CHEMICAL` | 规模以上工业企业利润总额:化学原料和化学制品制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_COAL` | 规模以上工业企业利润总额:煤炭开采和洗选业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_COMMON_EQUIP` | 规模以上工业企业利润总额:通用设备制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_DEDICATED_EQUIP` | 规模以上工业企业利润总额:专用设备制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_ELECTRIC` | 规模以上工业企业利润总额:电力、热力生产和供应业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_ELECTRIC_EQUIP` | 规模以上工业企业利润总额:电气机械和器材制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_FOOD` | 规模以上工业企业利润总额:食品制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_FURNITURE` | 规模以上工业企业利润总额:家具制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_INSTRUMENTATION` | 规模以上工业企业利润总额:仪器仪表制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_MEDICINE` | 规模以上工业企业利润总额:医药制造业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_METAL` | 规模以上工业企业利润总额:有色金属冶炼和压延加工业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_OIL` | 规模以上工业企业利润总额:石油和天然气开采业:累计同比:月(%) |
| `ENTERPRISE_PROFIT_CUM_YOY_PLASTIC` | 规模以上工业企业利润总额:橡胶和塑料制品业:累计同比:月(%) |
| `PROFIT_ENDDATE` | 工业企业利润指标截止日期 |
| `PROFIT_INFOPUBLDATE` | 工业企业利润指标发布日期 |

## 工业增加值（GDP供给指标）

| 字段 | 说明 |
| ---- | ---- |
| `IAV_CUM_YOY` | 规模以上工业增加值:累计同比:月(%) |
| `IAV_CUM_YOY_AGIRICULTURE` | 规模以上工业增加值:农副食品加工业:累计同比:月(%) |
| `IAV_CUM_YOY_BLACK_METAL` | 规模以上工业增加值:黑色金属冶炼和压延加工业:累计同比:月(%) |
| `IAV_CUM_YOY_CAR` | 规模以上工业增加值:汽车制造业:累计同比:月(%) |
| `IAV_CUM_YOY_CHEMICAL` | 规模以上工业增加值:化学原料和化学制品制造业:累计同比:月(%) |
| `IAV_CUM_YOY_COAL` | 规模以上工业增加值:煤炭开采和洗选业:累计同比:月(%) |
| `IAV_CUM_YOY_COMMON_EQUIP` | 规模以上工业增加值:通用设备制造业:累计同比:月(%) |
| `IAV_CUM_YOY_DEDICATED_EQUIP` | 规模以上工业增加值:专用设备制造业:累计同比:月(%) |
| `IAV_CUM_YOY_ELECTRIC` | 规模以上工业增加值:电力、热力生产和供应业:累计同比:月(%) |
| `IAV_CUM_YOY_ELECTRIC_EQUIP` | 规模以上工业增加值:电气机械和器材制造业:累计同比:月(%) |
| `IAV_CUM_YOY_FOOD` | 规模以上工业增加值:食品制造业:累计同比:月(%) |
| `IAV_CUM_YOY_HIGH_TEC` | 规模以上工业增加值:高技术制造业:累计同比:月(%) |
| `IAV_CUM_YOY_MEDICINE` | 规模以上工业增加值:医药制造业:累计同比:月(%) |
| `IAV_CUM_YOY_METAL_PRODUCTS` | 规模以上工业增加值:金属制品业:累计同比:月(%) |
| `IAV_CUM_YOY_MINING` | 规模以上工业增加值:采矿业:累计同比:月(%) |
| `IAV_CUM_YOY_NONFERROUS_METAL` | 规模以上工业增加值:有色金属冶炼和压延加工业:累计同比:月(%) |
| `IAV_CUM_YOY_NON_MENTAL` | 规模以上工业增加值:非金属矿物制品业:累计同比:月(%) |
| `IAV_CUM_YOY_OIL` | 规模以上工业增加值:石油和天然气开采业:累计同比:月(%) |
| `IAV_CUM_YOY_PLASTIC` | 规模以上工业增加值:橡胶和塑料制品业:累计同比:月(%) |
| `IAV_CUM_YOY_RAILWAY` | 规模以上工业增加值:铁路、船舶、航空航天和其他运输设备制造业:累计同比:月(%) |
| `IAV_CUM_YOY_TEXTILE` | 规模以上工业增加值:纺织业:累计同比:月(%) |
| `IAV_CUM_YOY_TMT` | 规模以上工业增加值:计算机、通信和其他电子设备制造业:累计同比:月(%) |
| `IAV_CUM_YOY_WINE` | 规模以上工业增加值:酒、饮料和精制茶制造业:累计同比:月(%) |
| `VALUEADDED_ENDDATE` | 工业增加值指标截止日期 |
| `VALUEADDED_INFOPUBLDATE` | 工业增加值指标发布日期 |

## 消费（GDP需求指标）

| 字段 | 说明 |
| ---- | ---- |
| `CONSUMPTION_ENDDATE` | 消费指标截止日期 |
| `CONSUMPTION_INFOPUBLDATE` | 消费指标发布日期 |
| `CONSUMP_CAR_CUM` | 限额以上单位商品零售总额:汽车类:累计值:月(亿) |
| `CONSUMP_CAR_CUM_YOY` | 限额以上单位商品零售总额:汽车类:累计同比:月(%) |
| `CONSUMP_COSMETIC_CUM` | 限额以上单位商品零售总额:化妆品类:累计值:月(亿) |
| `CONSUMP_COSMETIC_CUM_YOY` | 限额以上单位商品零售总额:化妆品类:累计同比:月(%) |
| `CONSUMP_CUM` | 社会消费品零售总额:累计值:月(亿) |
| `CONSUMP_CUM_YOY` | 社会消费品零售总额:累计同比:月(%) |
| `CONSUMP_CUR` | 社会消费品零售总额:当期值:月(亿) |
| `CONSUMP_CUR_MOM` | 社会消费品零售总额:环比:月(%) |
| `CONSUMP_CUR_YOY` | 社会消费品零售总额:当期同比:月(%) |
| `CONSUMP_DECORATE_CUM` | 限额以上单位商品零售总额:建筑及装潢材料类:累计值:月(亿) |
| `CONSUMP_DECORATE_CUM_YOY` | 限额以上单位商品零售总额:建筑及装潢材料类:累计同比:月(%) |
| `CONSUMP_ENTERTAIN_CUM` | 限额以上单位商品零售总额:体育、娱乐用品类:累计值:月(亿) |
| `CONSUMP_ENTERTAIN_CUM_YOY` | 限额以上单位商品零售总额:体育、娱乐用品类:累计同比:月(%) |
| `CONSUMP_FURNITURE_CUM` | 限额以上单位商品零售总额:家具类:累计值:月(亿) |
| `CONSUMP_FURNITURE_CUM_YOY` | 限额以上单位商品零售总额:家具类:累计同比:月(%) |
| `CONSUMP_JEWELRY_CUM` | 限额以上单位商品零售总额:金银珠宝类:累计值:月(亿) |
| `CONSUMP_JEWELRY_CUM_YOY` | 限额以上单位商品零售总额:金银珠宝类:累计同比:月(%) |
| `CONSUMP_MAGZINE_CUM` | 限额以上单位商品零售总额:书报杂志类:累计值:月(亿) |
| `CONSUMP_MAGZINE_CUM_YOY` | 限额以上单位商品零售总额:书报杂志类:累计同比:月(%) |
| `CONSUMP_MEDISN_CUM` | 限额以上单位商品零售总额:中西药品类:累计值:月(亿) |
| `CONSUMP_MEDISN_CUM_YOY` | 限额以上单位商品零售总额:中西药品类:累计同比:月(%) |
| `CONSUMP_OFFICE_CUM` | 限额以上单位商品零售总额:文化办公用品类:累计值:月(亿) |
| `CONSUMP_OFFICE_CUM_YOY` | 限额以上单位商品零售总额:文化办公用品类:累计同比:月(%) |
| `CONSUMP_OIL_CUM` | 限额以上单位商品零售总额:石油及制品类:累计值:月(亿) |
| `CONSUMP_OIL_CUM_YOY` | 限额以上单位商品零售总额:石油及制品类:累计同比:月(%) |
| `CONSUMP_PHONE_CUM` | 限额以上单位商品零售总额:通讯器材类:累计值:月(亿) |
| `CONSUMP_PHONE_CUM_YOY` | 限额以上单位商品零售总额:通讯器材类:累计同比:月(%) |
| `CONSUMP_TELEVISION_CUM` | 限额以上单位商品零售总额:家用电器和音像器材类:累计值:月(亿) |
| `CONSUMP_TELEVISION_CUM_YOY` | 限额以上单位商品零售总额:家用电器和音像器材类:累计同比:月(%) |

## 投资（GDP需求指标）

| 字段 | 说明 |
| ---- | ---- |
| `INVEST_ENDDATE` | 投资指标截止日期 |
| `INVEST_INFOPUBLDATE` | 投资指标发布日期 |
| `INV_INFRA_COM_MACHINE_CUM_YOY` | 固定资产投资额:通用设备制造业:累计同比:月(%) |
| `INV_INFRA_CUM_YOY` | 民间固定资产投资额:基础设施:累计同比:月(%) |
| `INV_INFRA_INFO_TRANS_CUM_YOY` | 固定资产投资额:信息传输业:累计同比:月(%) |
| `INV_INFRA_ROAD_TRANS_CUM_YOY` | 固定资产投资额:道路运输业:累计同比:月(%) |
| `INV_INFRA_SMELT_CUM_YOY` | 固定资产投资额:黑色金属冶炼及压延加工业:累计同比:月(%) |
| `INV_MANU_CAR_CUM_YOY` | 民间固定资产投资额:汽车制造业:累计同比:月(%) |
| `INV_MANU_CUM_YOY` | 民间固定资产投资额:制造业:累计同比:月(%) |
| `INV_MANU_DEDIC_MACHINE_CUM_YOY` | 民间固定资产投资额:专用设备制造业:累计同比:月(%) |
| `INV_MANU_ELECTRICAL_CUM_YOY` | 民间固定资产投资额:电气机械和器材制造业:累计同比:月(%) |
| `INV_MANU_RAIL_CUM_YOY` | 民间固定资产投资额:铁路、船舶、航空航天和其他运输设备制造业:累计同比:月(%) |
| `INV_MANU_TMT_CUM_YOY` | 民间固定资产投资额:计算机、通信和其他电子设备制造业:累计同比:月(%) |
| `INV_REALESTATE_AMT_COMPLETE_CUM` | 房地产开发投资完成额:累计值:月 |
| `INV_REALESTATE_AMT_COMPLETE_CUM_YOY` | 房地产开发投资完成额:累计同比:月(%) |
| `INV_REALESTATE_AMT_CUR` | 房地产开发投资额:当期值:月 |
| `INV_REALESTATE_AMT_CUR_MOM` | 房地产开发投资额:环比:月(%) |
| `INV_REALESTATE_AMT_CUR_YOY` | 房地产开发投资额:当期同比:月(%) |
| `INV_REALESTATE_AMT_TOTAL_CUM` | 房地产开发投资总额:累计值:月 |
| `INV_REALESTATE_AMT_TOTAL_CUM_YOY` | 房地产开发投资总额:累计同比:月(%) |
| `INV_REALESTATE_CAP_DEPOSIT_CUM` | 房地产开发投资额:按资金来源:定金及预收款:累计值:月 |
| `INV_REALESTATE_CAP_DEPOSIT_CUM_YOY` | 房地产开发投资额:按资金来源:定金及预收款:累计同比:月(%) |
| `INV_REALESTATE_CAP_FOREIGN_CUM` | 房地产开发投资额:按资金来源:利用外资:累计值:月 |
| `INV_REALESTATE_CAP_FOREIGN_CUM_YOY` | 房地产开发投资额:按资金来源:利用外资:累计同比:月(%) |
| `INV_REALESTATE_CAP_LOAN_CUM` | 房地产开发投资额:按资金来源:国内贷款:累计值:月 |
| `INV_REALESTATE_CAP_LOAN_CUM_YOY` | 房地产开发投资额:按资金来源:国内贷款:累计同比:月(%) |
| `INV_REALESTATE_CAP_OTHER_CUM` | 房地产开发投资额:按资金来源:其他资金:累计值:月 |
| `INV_REALESTATE_CAP_OTHER_CUM_YOY` | 房地产开发投资额:按资金来源:其他资金:累计同比:月(%) |
| `INV_REALESTATE_CAP_SELF_CUM` | 房地产开发投资额:按资金来源:自筹资金:累计值:月 |
| `INV_REALESTATE_CAP_SELF_CUM_YOY` | 房地产开发投资额:按资金来源:自筹资金:累计同比:月(%) |
| `INV_REALESTATE_COMPLETE_CUM` | 房屋竣工面积:累计值:月 |
| `INV_REALESTATE_COMPLETE_CUM_YOY` | 房屋竣工面积:累计同比:月(%) |
| `INV_REALESTATE_FORSALE` | 房屋待售面积:月 |
| `INV_REALESTATE_FORSALE_YOY` | 房屋待售面积:同比:月(%) |
| `INV_REALESTATE_INCONSTRU_CUM` | 房屋施工面积:累计值:月 |
| `INV_REALESTATE_INCONSTRU_CUM_YOY` | 房屋施工面积:累计同比:月(%) |
| `INV_REALESTATE_NEW_CUM` | 房屋新开工面积:累计值:月 |
| `INV_REALESTATE_NEW_CUM_YOY` | 房屋新开工面积:累计同比:月(%) |
| `INV_REALESTATE_REVENUE_CUM` | 房屋销售额:累计值:月 |
| `INV_REALESTATE_REVENUE_CUM_YOY` | 房屋销售额:累计同比:月(%) |
| `INV_REALESTATE_SALED_CUM` | 房屋销售面积:累计值:月 |
| `INV_REALESTATE_SALED_CUM_YOY` | 房屋销售面积:累计同比:月(%) |
| `INV_REALESTATE_SALED_CUR` | 房屋销售面积:当期值:月 |
| `INV_REALESTATE_SALED_CUR_YOY` | 房屋销售面积:当期同比:月(%) |

## 融资（货币需求指标）

| 字段 | 说明 |
| ---- | ---- |
| `FINANCING_ENDDATE` | 社融指标截止日期 |
| `FINANCING_INFOPUBLDATE` | 社融指标发布日期 |
| `SR_INC` | 社会融资规模增量:累计值:月 |
| `SR_INC_ABS` | 社会融资规模增量:存款类金融机构资产支持证券:月 |
| `SR_INC_BOND` | 社会融资规模增量:企业债券:月 |
| `SR_INC_ENTRUSTED_LOAN` | 社会融资规模增量:委托贷款:月 |
| `SR_INC_FOREIGN_LOAN` | 社会融资规模增量:外币贷款(折合人民币):月 |
| `SR_INC_GOVERN_BOND` | 社会融资规模增量:政府债券:月 |
| `SR_INC_LOAN` | 社会融资规模增量:人民币贷款:月 |
| `SR_INC_LOAN_WRITEOFF` | 社会融资规模增量:贷款核销:月 |
| `SR_INC_STOCK` | 社会融资规模增量:非金融企业境内股票融资:月 |
| `SR_INC_TRUST` | 社会融资规模增量:信托贷款:月 |
| `SR_INC_UNDISCOUNTED_BANK_ACCEPTANCE` | 社会融资规模增量:未贴现银行承兑汇票:月 |
| `SR_INC_YOY` | 社会融资规模增量:累计同比:月(%) |
| `SR_INC_YOY_ABS` | 社会融资规模增量:存款类金融机构资产支持证券:同比:月(%) |
| `SR_INC_YOY_BOND` | 社会融资规模增量:企业债券:同比:月(%) |
| `SR_INC_YOY_ENTRUSTED_LOAN` | 社会融资规模增量:委托贷款:同比:月(%) |
| `SR_INC_YOY_FOREIGN_LOAN` | 社会融资规模增量:外币贷款(折合人民币):同比:月(%) |
| `SR_INC_YOY_GOVERN_BOND` | 社会融资规模增量:政府债券:同比:月(%) |
| `SR_INC_YOY_LOAN` | 社会融资规模增量:人民币贷款:同比:月(%) |
| `SR_INC_YOY_LOAN_WRITEOFF` | 社会融资规模增量:贷款核销:同比:月(%) |
| `SR_INC_YOY_STOCK` | 社会融资规模增量:非金融企业境内股票融资:同比:月(%) |
| `SR_INC_YOY_TRUST` | 社会融资规模增量:信托贷款:同比:月(%) |
| `SR_INC_YOY_UNDISCOUNTED_BANK_ACCEPTANCE` | 社会融资规模增量:未贴现银行承兑汇票:同比:月(%) |
| `SR_SIZE` | 社会融资规模存量:月 |
| `SR_SIZE_ABS` | 社会融资规模存量:存款类金融机构资产支持证券:月 |
| `SR_SIZE_BOND` | 社会融资规模存量:企业债券:月 |
| `SR_SIZE_ENTRUSTED_LOAN` | 社会融资规模存量:委托贷款:月 |
| `SR_SIZE_FOREIGN_LOAN` | 社会融资规模存量:外币贷款(折合人民币):月 |
| `SR_SIZE_GOVERN_BOND` | 社会融资规模存量:政府债券:月 |
| `SR_SIZE_LOAN` | 社会融资规模存量:人民币贷款:月 |
| `SR_SIZE_LOAN_WRITEOFF` | 社会融资规模存量:贷款核销:月 |
| `SR_SIZE_STOCK` | 社会融资规模存量:非金融企业境内股票融资:月 |
| `SR_SIZE_TRUST` | 社会融资规模存量:信托贷款:月 |
| `SR_SIZE_UNDISCOUNTED_BANK_ACCEPTANCE` | 社会融资规模存量:未贴现银行承兑汇票:月 |
| `SR_SIZE_YOY` | 社会融资规模存量:同比:月(%) |
| `SR_SIZE_YOY_ABS` | 社会融资规模存量:存款类金融机构资产支持证券:同比:月(%) |
| `SR_SIZE_YOY_BOND` | 社会融资规模存量:企业债券:同比:月(%) |
| `SR_SIZE_YOY_ENTRUSTED_LOAN` | 社会融资规模存量:委托贷款:同比:月(%) |
| `SR_SIZE_YOY_FOREIGN_LOAN` | 社会融资规模存量:外币贷款(折合人民币):同比:月(%) |
| `SR_SIZE_YOY_GOVERN_BOND` | 社会融资规模存量:政府债券:同比:月(%) |
| `SR_SIZE_YOY_LOAN` | 社会融资规模存量:人民币贷款:同比:月(%) |
| `SR_SIZE_YOY_LOAN_WRITEOFF` | 社会融资规模存量:贷款核销:同比:月(%) |
| `SR_SIZE_YOY_STOCK` | 社会融资规模存量:非金融企业境内股票融资:同比:月(%) |
| `SR_SIZE_YOY_TRUST` | 社会融资规模存量:信托贷款:同比:月(%) |
| `SR_SIZE_YOY_UNDISCOUNTED_BANK_ACCEPTANCE` | 社会融资规模存量:未贴现银行承兑汇票:同比:月(%) |

## 货币供应量（货币供给指标）

| 字段 | 说明 |
| ---- | ---- |
| `FUNDQUANTITY_ENDDATE` | 货币供给量指标截止日期 |
| `FUNDQUANTITY_INFOPUBLDATE` | 货币供给量指标发布日期 |
| `M0` | 流通中现金(M0):月(亿) |
| `M0_YOY` | 流通中现金(M0):同比:月(%) |
| `M1` | 狭义货币供应量(M1):月(亿) |
| `M1_YOY` | 狭义货币供应量(M1):同比:月(%) |
| `M2` | 货币和准货币(M2):月(亿) |
| `M2_YOY` | 货币和准货币(M2):同比:月(%) |
| `SCISSORS_M1_M2` | M1-M2剪刀差:月(%) |
| `SCISSORS_M1_M2_MOM` | M1-M2剪刀差:环比:月(%) |

## 利率（货币供给指标）

| 字段 | 说明 |
| ---- | ---- |
| `FDR001` | 银行间回购定盘利率:FDR001:日 |
| `FDR007` | 银行间回购定盘利率:FDR007:日 |
| `FDR014` | 银行间回购定盘利率:FDR014:日 |
| `FR001` | 银行间回购定盘利率:FR001:日 |
| `FR007` | 银行间回购定盘利率:FR007:日 |
| `FR014` | 银行间回购定盘利率:FR014:日 |
| `FUNDCOST_ENDDATE` | 货币供给利率指标截止日期 |
| `FUNDCOST_INFOPUBLDATE` | 货币供给利率指标发布日期 |
| `GC001` | 债券回购加权平均:质押式回购:GC001:上海证券交易所:日 |
| `GC007` | 债券回购加权平均:质押式回购:GC007:上海证券交易所:日 |
| `GC014` | 债券回购加权平均:质押式回购:GC014:上海证券交易所:日 |
| `R001` | 质押式回购:深圳证券交易所:R-001:日 |
| `R002` | 质押式回购:深圳证券交易所:R-002:日 |
| `R003` | 质押式回购:深圳证券交易所:R-003:日 |
| `R004` | 质押式回购:深圳证券交易所:R-004:日 |
| `R007` | 质押式回购:深圳证券交易所:R-007:日 |
| `R014` | 质押式回购:深圳证券交易所:R-014:日 |
| `R028` | 质押式回购:深圳证券交易所:R-028:日 |
| `R091` | 质押式回购:深圳证券交易所:R-091:日 |
| `R182` | 质押式回购:深圳证券交易所:R-182:日 |
| `SHIBOR_1M` | SHIBOR:1个月:日 |
| `SHIBOR_1W` | SHIBOR:1周:日 |
| `SHIBOR_1Y` | SHIBOR:1年:日 |
| `SHIBOR_2W` | SHIBOR:2周:日 |
| `SHIBOR_3M` | SHIBOR:3个月:日 |
| `SHIBOR_6M` | SHIBOR:6个月:日 |
| `SHIBOR_9M` | SHIBOR:9个月:日 |
| `SHIBOR_OVERNIGHT` | SHIBOR:隔夜:日 |
