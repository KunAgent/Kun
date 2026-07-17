---
name: weekly-security-inspection
description: 生成过去一周的安全巡检报告，覆盖所有安全产品的关键指标和安全态势评分
triggers:
  - "安全周报"
  - "过去一周安全"
  - "一周安全情况"
  - "安全巡检"
  - "本周安全"
  - "weekly security report"
  - "past week security"
products: [cwp, waf, cfw, tcss, csip, kms, ssm]
template: references/template/security_inspection.md
---

# 过去一周安全巡检

## 适用场景

用户需要了解过去一周的整体安全态势，包括各产品的告警趋势、漏洞变化、攻击情况、合规状态等。适用于安全周报、团队汇报、管理层安全态势通报等场景。

## 执行脚本

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

start,end=wf.time_range(7,"d")
start_date,end_date=wf.time_date_range(7,"d")

cmds=[
    [PY,T,"cwp","DescribeGeneralStat","--output","json"],
    [PY,T,"cwp","DescribeOverviewStatistics","--output","json"],
    [PY,T,"cwp","DescribeSecurityEventsCnt","--output","json"],
    [PY,T,"cwp","DescribeVulHostCountScanTime","--output","json"],
    [PY,T,"cwp","DescribeSecurityTrends","--BeginDate",start_date,"--EndDate",end_date,"--output","json"],
    [PY,T,"cwp","DescribeVulList","--Limit","10","--Offset","0","--output","json"],
    [PY,T,"waf","DescribeAttackOverview","--FromTime",start,"--ToTime",end,"--output","json"],
    [PY,T,"waf","DescribeHosts","--output","json"],
    [PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","ip","--Top","10","--output","json"],
    [PY,T,"cfw","DescribeSwitchLists","--Limit","10","--Offset","0","--output","json"],
    [PY,T,"cfw","DescribeRuleOverview","--output","json"],
    [PY,T,"tcss","DescribeTcssSummary","--output","json"],
    [PY,T,"tcss","DescribeVulSummary","--output","json"],
    [PY,T,"tcss","DescribeContainerSecEventSummary","--output","json"],
    [PY,T,"kms","ListKeys","--Offset","0","--Limit","100","--output","json"],
    [PY,T,"ssm","ListSecrets","--Offset","0","--Limit","100","--output","json"],
]

wf.out(wf.batch(cmds,workers=6))
```

## 数据完整性保障

- `DescribeGeneralStat` / `DescribeOverviewStatistics` / `DescribeSecurityEventsCnt` 返回全局统计，无分页问题
- `DescribeVulList` 首次 Limit=10 仅为探测 TotalCount，报告中使用 TotalCount 作为漏洞总数
- `ListKeys` / `ListSecrets` 若 TotalCount > 100，用 `wf.page` 补全：

```python
res["kms.ListKeys"]=wf.page("kms","ListKeys","Keys",workers=3)
res["ssm.ListSecrets"]=wf.page("ssm","ListSecrets","SecretMetadatas",workers=3)
```

## 输出格式

使用 `references/template/security_inspection.md` 模板，重点填充：

- 安全态势评分：根据各产品数据对主机安全、网络安全、应用安全、数据安全、身份安全五个维度评分
- 各产品巡检结果：CWP/WAF/CFW/TCSS/KMS/SSM 各项指标
- 发现的问题：汇总各产品中需要关注的安全问题
- 待办事项：根据发现的问题生成处置建议

## 注意事项

- 此工作流涉及多个产品，未开通的产品 API 返回错误时在报告中标注"未开通"
- 所有统计数值以 TotalCount 为准，不以当前页返回条数为准
- 评分逻辑需根据实际数据综合判断（告警数、漏洞数、合规率等）
- `DescribeSecurityTrends` 的 BeginDate/EndDate 需使用纯日期格式（如 "2026-06-10"），通过 `time_util.py date-range` 获取
