---
name: asset-risk-overview
description: 生成资产风险概览报告，展示各类资产的风险分布、暴露面、防护覆盖情况
triggers:
  - "资产风险"
  - "风险概览"
  - "安全态势"
  - "资产安全情况"
  - "风险资产"
  - "asset risk overview"
  - "security posture"
products: [csip, cwp]
template: references/template/risk_report.md
---

# 资产风险概览

## 适用场景

用户需要了解当前资产的整体风险状况，包括存在漏洞风险的资产、配置风险资产、端口暴露资产等。适用于安全态势通报、资产风险盘点、管理层汇报等场景。

## 执行脚本

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

cmds=[
    [PY,T,"cwp","DescribeGeneralStat","--output","json"],
    [PY,T,"cwp","DescribeOverviewStatistics","--output","json"],
    [PY,T,"cwp","DescribeVulHostCountScanTime","--output","json"],
]

wf.out(wf.batch(cmds))
```

## 数据完整性保障

CSIP 风险列表的 `Limit`/`Offset` 嵌在 `--Filter` 对象内（顶层 `--Limit`/`--Offset` 无效），但 `wf.page` 会自动探测并 fallback 到对象内分页，直接用即可（无需 pageo、无需手写 --Filter.Limit）：

```python
res["csip.DescribeRiskCenterAssetViewVULRiskList"]=wf.page("csip","DescribeRiskCenterAssetViewVULRiskList","Data",workers=3)
res["csip.DescribeRiskCenterAssetViewCFGRiskList"]=wf.page("csip","DescribeRiskCenterAssetViewCFGRiskList","Data",workers=3)
res["csip.DescribeRiskCenterAssetViewPortRiskList"]=wf.page("csip","DescribeRiskCenterAssetViewPortRiskList","Data",workers=3)
```

## 输出格式

使用 `references/template/risk_report.md` 模板，重点填充：

- 风险概览：总资产数（DescribeGeneralStat）、风险资产数、风险资产占比
- 风险分布：按风险类型（漏洞/配置/端口暴露）分类统计，以各 API 的 TotalCount 为准
- 高风险资产 TOP：列出风险最高的资产及其风险详情
- 防护覆盖：DescribeOverviewStatistics 中的 Agent 在线/离线数
- 处置建议：优先处置的风险项和建议措施

## 注意事项

- CSIP 三个风险列表 API 均无必传参数，可直接调用；分页参数嵌在 `--Filter` 对象内（顶层 `--Limit`/`--Offset` 无效），但 `wf.page` 自动 fallback 到对象内分页，直接用即可
- CWP DescribeGeneralStat / DescribeOverviewStatistics 返回全局统计，无分页问题
- 报告中的统计数值以 TotalCount 为准
- CSIP 产品需确认已开通，未开通时标注"未开通"
