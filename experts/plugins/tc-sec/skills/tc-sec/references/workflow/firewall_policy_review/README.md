---
name: firewall-policy-review
description: 审计云防火墙和 WAF 的策略配置，检查过宽规则、冗余规则、未命中规则
triggers:
  - "策略审计"
  - "规则检查"
  - "防火墙审计"
  - "防火墙规则"
  - "WAF策略检查"
  - "规则梳理"
  - "policy audit"
  - "firewall rule review"
products: [cfw, waf]
template: references/template/policy_audit.md
---

# 防火墙策略审计

## 适用场景

用户需要审计云防火墙（CFW）和 Web 应用防火墙（WAF）的策略配置，识别过宽规则、冗余规则、长期未命中规则、冲突规则等安全隐患。适用于定期策略审计、合规检查、安全加固等场景。

## 执行脚本

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

cmds=[
    [PY,T,"cfw","DescribeAcLists","--Limit","100","--Offset","0","--output","json"],
    [PY,T,"cfw","DescribeNatAcRule","--Limit","100","--Offset","0","--output","json"],
    [PY,T,"cfw","DescribeEnterpriseSecurityGroupRuleList","--Limit","100","--Offset","0","--output","json"],
    [PY,T,"cfw","DescribeRuleOverview","--output","json"],
    [PY,T,"waf","DescribeHosts","--output","json"],
    [PY,T,"waf","DescribeDomains","--Offset","0","--Limit","100","--output","json"],
]

wf.out(wf.batch(cmds))
```

## 二阶段：WAF 域名规则详情

获取域名列表后，逐个查询每个域名的自定义规则（DescribeCustomRuleList 需要 Domain 必传参数），用 `wf.pmap` 并发：

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

domains=["<从Phase1 DescribeDomains结果中提取的域名列表>"]

def fetch_rules(domain):
    return domain,wf.exec([PY,T,"waf","DescribeCustomRuleList","--Domain",domain,"--Offset","0","--Limit","100","--output","json"])

wf.out(wf.pmap(fetch_rules,domains))
```

## 数据完整性保障

CFW 规则列表和 WAF 域名列表用 `wf.page` 按 TotalCount 分页补全：

```python
res["cfw.DescribeAcLists"]=wf.page("cfw","DescribeAcLists","Data",workers=3)
res["cfw.DescribeNatAcRule"]=wf.page("cfw","DescribeNatAcRule","Data",workers=3)
res["cfw.DescribeEnterpriseSecurityGroupRuleList"]=wf.page("cfw","DescribeEnterpriseSecurityGroupRuleList","Data",workers=3)
res["waf.DescribeDomains"]=wf.page("waf","DescribeDomains","Domains",workers=3)
```

## 审计分析逻辑

获取规则列表后，按以下维度分析：

1. **过宽规则**：源/目标为 any、端口为 all、协议为 any 的放行规则
2. **冗余规则**：被更高优先级规则完全覆盖的规则
3. **未命中规则**：长期命中次数为 0 的规则
4. **冲突规则**：相同匹配条件但动作不同的规则对
5. **高风险放行**：放行高危端口（如 22/3389/3306 等）到公网的规则

## 输出格式

使用 `references/template/policy_audit.md` 模板，重点填充：

- 策略概览：各产品规则总数（以 TotalCount 为准）、启用/禁用比例
- 风险规则列表：按风险等级排序的问题规则
- 规则优化建议：针对每条问题规则的具体优化方案
- 合规对标：与安全最佳实践的差距分析

## 注意事项

- CFW DescribeEnterpriseSecurityGroupRuleList 必传 Limit 和 Offset
- CFW DescribeNatAcRule 必传 Limit 和 Offset
- WAF DescribeCustomRuleList 必传 Domain/Offset/Limit，需先获取域名列表再逐个查询；若单个域名规则超过 100 条，需按 TotalCount 分页采集
- WAF DescribeIpAccessControl 必传 Domain 和 Count，按需在二阶段使用
- 审计结果为建议性质，修改规则前必须与用户确认
