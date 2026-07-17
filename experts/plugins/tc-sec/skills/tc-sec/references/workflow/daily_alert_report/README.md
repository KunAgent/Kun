---
name: daily-alert-report
description: 生成今日新增安全告警汇总报告，覆盖主机入侵、WAF 攻击、防火墙告警、容器安全告警
triggers:
  - "今日告警"
  - "今天新增告警"
  - "今日告警报告"
  - "今天有什么告警"
  - "告警日报"
  - "today's alerts"
  - "new alerts today"
products: [cwp, waf, cfw, tcss]
template: references/template/alert_analysis.md
---

# 今日新增告警报告

## 适用场景

用户需要了解今天产生了哪些新的安全告警，包括主机入侵检测告警、WAF 攻击告警、云防火墙拦截告警、容器安全告警等。适用于每日安全运维巡检、晨会汇报等场景。

## 执行脚本

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

start=wf.time("start-of","day")
end=wf.time("now")
td=wf.time("today")

cmds=[
    [PY,T,"cwp","DescribeSecurityEventsCnt","--output","json"],
    [PY,T,"cwp","DescribeSecurityEventStat","--output","json"],
    [PY,T,"cwp","DescribeSecurityDynamics","--Limit","100","--Offset","0","--output","json"],
    [PY,T,"waf","DescribeAttackOverview","--FromTime",start,"--ToTime",end,"--output","json"],
    [PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","ip","--Top","10","--output","json"],
    [PY,T,"tcss","DescribeContainerSecEventSummary","--output","json"],
    [PY,T,"tcss","DescribeSecEventsTendency","--StartTime",td,"--EndTime",td,"--output","json"],
]

wf.out(wf.batch(cmds))
```

## 数据完整性保障

- `DescribeSecurityEventsCnt` 返回各类事件的 TotalCount，直接作为统计数据源
- `DescribeSecurityEventStat` 返回安全事件统计概览
- `DescribeSecurityDynamics` 的 Limit=100 为首次探测，若 TotalCount > 100 用 `wf.page` 补全：

```python
res["cwp.DescribeSecurityDynamics"]=wf.page("cwp","DescribeSecurityDynamics","SecurityDynamics")
```

## 输出格式

使用 `references/template/alert_analysis.md` 模板，重点填充：

- 报告概览：报告时间为今日，分析周期为今日 00:00:00 ~ 当前时间
- 告警统计：按产品汇总告警总数（以 TotalCount/EventCnt 为准）、按严重等级分布
- 重点告警详情：列出严重/高危告警的具体信息
- 处置建议：针对高优先级告警给出处置建议

## 注意事项

- 统计数值必须以 API 返回的 TotalCount/EventCnt 字段为准，不以当前页返回条数为准
- 若某产品未开通，对应 API 会返回错误，报告中标注"未开通"
- CFW DescribeBlockStaticList 的 QueryType: "ip"=按IP统计拦截, Top=返回 Top N 条
- TCSS DescribeSecEventsTendency 的 StartTime/EndTime 需要纯日期格式（如 "2026-06-17"），使用 `time_util.py today` 获取
- CWP DescribeSecurityDynamics 返回最近的安全动态（无时间范围参数），分析时需根据事件时间字段筛选今日数据，避免将历史事件计入今日报告
