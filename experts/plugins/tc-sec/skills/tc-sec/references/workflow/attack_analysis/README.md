---
name: attack-analysis
description: 分析指定时间段内的攻击事件，包括 WAF 攻击日志、防火墙拦截、主机入侵检测
triggers:
  - "攻击分析"
  - "被攻击了"
  - "攻击态势"
  - "攻击日志"
  - "谁在攻击我"
  - "攻击来源"
  - "attack analysis"
  - "who is attacking"
products: [waf, cfw, cwp]
template: references/template/attack_analysis.md
---

# 攻击事件分析

## 适用场景

用户需要了解近期的攻击态势，包括 WAF 拦截的 Web 攻击、云防火墙拦截的网络攻击、主机安全检测到的入侵行为等。适用于攻击态势分析、攻击溯源、安全事件通报等场景。默认分析过去 24 小时，用户可指定其他时间范围。

## 执行脚本

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

start,end=wf.time_range(24,"h")

cmds=[
    [PY,T,"waf","DescribeAttackOverview","--FromTime",start,"--ToTime",end,"--output","json"],
    [PY,T,"waf","DescribeAttackType","--FromTime",start,"--ToTime",end,"--output","json"],
    [PY,T,"waf","DescribeTopAttackDomain","--FromTime",start,"--ToTime",end,"--output","json"],
    [PY,T,"waf","DescribePeakValue","--FromTime",start,"--ToTime",end,"--output","json"],
    [PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","ip","--Top","10","--output","json"],
    [PY,T,"cwp","DescribeBruteAttackList","--Limit","100","--Offset","0","--output","json"],
    [PY,T,"cwp","DescribeAttackEvents","--Limit","100","--Offset","0","--output","json"],
]

wf.out(wf.batch(cmds))
```

## 数据完整性保障

CWP 攻击事件可能较多，用 `wf.page` 按 TotalCount 分页补全：

```python
res["cwp.DescribeBruteAttackList"]=wf.page("cwp","DescribeBruteAttackList","BruteAttackList")
res["cwp.DescribeAttackEvents"]=wf.page("cwp","DescribeAttackEvents","List")
```

## 二阶段深入分析（可选）

当第一阶段发现明显攻击源 IP 时，可通过 CFW 按 IP 查询详细拦截记录（`wf.exec` 单条执行）：

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

start,end=wf.time_range(24,"h")
attack_ip="<从第一阶段结果中提取的攻击源IP>"

d=wf.exec([PY,T,"cfw","DescribeBlockByIpTimesList","--StartTime",start,"--EndTime",end,"--Ip",attack_ip,"--output","json"])
wf.out(d)
```

## 输出格式

使用 `references/template/attack_analysis.md` 模板，重点填充：

- 攻击概览：总攻击次数、拦截次数、攻击类型分布（以 DescribeAttackOverview 为准）
- 攻击来源 TOP：DescribeBlockStaticList 返回的 Top IP
- 被攻击目标 TOP：DescribeTopAttackDomain 返回的受攻击域名
- 攻击时间分布：DescribePeakValue 返回的攻击高峰
- 处置建议：封禁建议、策略加固建议

## 注意事项

- WAF 时间参数名为 FromTime/ToTime，CFW 为 StartTime/EndTime
- CFW DescribeBlockStaticList 的 QueryType="ip" 表示按 IP 统计拦截，Top=10 返回前 10 条
- CFW DescribeBlockByIpTimesList 需要指定具体 Ip（必传），仅用于二阶段深入分析
- CWP DescribeBruteAttackList/DescribeAttackEvents 返回全量数据（无时间范围参数），分析时需根据事件中的时间字段筛选指定时间段内的事件
- CWP DescribeBruteAttackList/DescribeAttackEvents 的 TotalCount 为全量数据总数
