import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,any_of,emit,product_zh,is_unavailable,all_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["CFW","WAF"],name="firewall_policy_review")
enabled=detect_enabled()
apply_enabled(a,enabled)

DMAX=a.detail_max or 10
HIGH_PORTS={"22","23","3389","3306","6379","1433","1521","27017","9200","11211","5432","5984","7001","8009","8161","9000","2375","2376"}
ANY_SRC={"0.0.0.0/0","::/0","any","*","0.0.0.0","ANY",""}
ANY_PORT={"-1/-1","-1","0-65535","all","ALL","ANY","any","*",""}
ANY_PROTO={"ANY","any","*",""}
DENY_KW=("封禁","拒绝","禁止","屏蔽","block","deny")

def _src(r,m):return str((r.get("SourceId") if m=="CFW-ESG" else r.get("SourceContent")) or "")
def _tgt(r,m):return str((r.get("TargetId") if m=="CFW-ESG" else r.get("TargetContent")) or "")

def _action_raw(r,m):
    if m=="CFW-ESG":
        s=r.get("Strategy")
        try:return {1:"drop",2:"accept"}.get(int(s),str(s or ""))
        except:return str(s or "")
    return str(r.get("RuleAction","") or "")

def _accept(r,m):
    if m=="CFW-ESG":
        try:return int(r.get("Strategy",0))==2
        except:return str(r.get("Strategy","")).strip() in ("2","accept","allow","放行")
    return str(r.get("RuleAction","")).strip().lower() in ("accept","allow","pass","放行")

def _desc_raw(r,m):
    return str((r.get("Detail") if m=="CFW-ESG" else (r.get("Description") or r.get("Detail"))) or "").strip()

def _desc_clean(r,m):
    d=_desc_raw(r,m)
    if not d or d.isdigit() or len(d)<3:return ""
    return d

def _enable(r,m):
    if m=="CFW-ESG":
        try:return int(r.get("Status",0))==1
        except:return str(r.get("Status","")).strip().lower() in ("1","true","启用","yes")
    return str(r.get("Enable","")).strip().lower() in ("true","1","启用","开启","enabled","yes")

def _port_set(p):
    s=str(p or "").strip()
    if not s or s in ANY_PORT:return None
    out=set()
    for seg in s.replace(";",",").split(","):
        seg=seg.strip()
        if "/" in seg or "-" in seg:
            sep="/" if "/" in seg else "-"
            try:
                a2,b=seg.split(sep); a2=int(a2); b=int(b)
                if a2<=0 and b>=65535:return None
                for hp in HIGH_PORTS:
                    if a2<=int(hp)<=b:out.add(hp)
            except:pass
        elif seg in HIGH_PORTS:out.add(seg)
    return out

def _wide(r,m):
    s_any=_src(r,m).strip() in ANY_SRC
    t_any=_tgt(r,m).strip() in ANY_SRC
    p_any=str(r.get("Port","")).strip() in ANY_PORT
    pr_any=str(r.get("Protocol","")).strip() in ANY_PROTO
    accept=_accept(r,m)
    return s_any,t_any,p_any,pr_any,accept,sum([s_any,t_any,p_any,pr_any])

def _classify(r,m):
    s_any,t_any,p_any,pr_any,accept,wide_n=_wide(r,m)
    src=_src(r,m); tgt=_tgt(r,m)
    risk_ports=_port_set(str(r.get("Port","")).strip())
    if accept and s_any and (p_any or pr_any) and (t_any or tgt.endswith("/0")):
        return "critical","全方位放行(any→any:any/any)"
    if accept and s_any and risk_ports:
        return "critical",f"公网放行高危端口 {','.join(sorted(risk_ports))}"
    if accept and wide_n>=2:
        return "high",f"过宽规则({wide_n}维 any)"
    if accept and (p_any or pr_any) and not s_any:
        return "high","端口/协议放行过宽"
    if m=="CFW-NAT":
        try:
            if int(r.get("Direction",1))==0:return None,None
        except:pass
    if accept and wide_n>=1:
        return "medium","单维度 any 放行"
    return None,None

def _hits(r):
    for k in ("Count","DetectedTimes","HitTimes","HitCount"):
        v=r.get(k)
        if v is None:continue
        try:return int(v)
        except:pass
    return -1

def _ddup(rows):
    seen=set();out=[];d=0
    for r in rows:
        u=str(r.get("Uuid","") or r.get("RuleUuid","") or "")
        if u and u in seen:d+=1;continue
        if u:seen.add(u)
        out.append(r)
    return out,d

cmds=[]
if has(a,"CFW"):
    cmds.append([PY,T,"cfw","DescribeRuleOverview","--output","json"])
ov=wf.batch(cmds) if cmds else {}
acl=wf.page("cfw","DescribeAclRule","Data",workers=3) if has(a,"CFW") else {}
nat=wf.page("cfw","DescribeNatAcRule","Data",workers=3) if has(a,"CFW") else {}
esg=wf.page("cfw","DescribeEnterpriseSecurityGroupRuleList","Data",workers=3) if has(a,"CFW") else {}
wafd=wf.page("waf","DescribeDomains","Domains",workers=3) if has(a,"WAF") else {}

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()))]
o=ov.get("cfw.DescribeRuleOverview",{}) or {}
cfw_ok=has(a,"CFW") and not is_unavailable(o) and not all_unavailable(acl,nat,esg)
if has(a,"CFW") and not cfw_ok and product_zh("CFW") not in unav:
    unav.append(product_zh("CFW"))

waf_doms_raw=wafd.get("Domains",[]) if has(a,"WAF") and not is_unavailable(wafd) else []
waf_avail=has(a,"WAF") and not is_unavailable(wafd) and bool(waf_doms_raw)
if has(a,"WAF") and not waf_avail and product_zh("WAF") not in unav:
    unav.append(product_zh("WAF"))

sources=[]
if cfw_ok:sources.append(product_zh("CFW"))
if waf_avail:sources.append(product_zh("WAF"))

raw_acl=acl.get("Data",[]) or [] if cfw_ok and not is_unavailable(acl) else []
raw_nat=nat.get("Data",[]) or [] if cfw_ok and not is_unavailable(nat) else []
raw_esg=esg.get("Data",[]) or [] if cfw_ok and not is_unavailable(esg) else []
acl_data,acl_dup=_ddup(raw_acl)
nat_data,nat_dup=_ddup(raw_nat)
esg_data,esg_dup=_ddup(raw_esg)

def _tot(d,raw_n):
    if not d or is_unavailable(d):return 0
    try:return int(d.get("AllTotal") or d.get("Total") or d.get("TotalCount") or raw_n or 0)
    except:return raw_n or 0
acl_total=_tot(acl,len(raw_acl))
nat_total=_tot(nat,len(raw_nat))
esg_total=_tot(esg,len(raw_esg))

rule_total=int(o.get("AllTotal") or 0) if cfw_ok else 0
start_n=int(o.get("StartRuleNum") or 0) if cfw_ok else 0
stop_n=int(o.get("StopRuleNum") or 0) if cfw_ok else 0
remain=int(o.get("RemainingNum") or 0) if cfw_ok else 0

waf_total=int(wafd.get("Total") or len(waf_doms_raw)) if waf_avail else 0
waf_doms=waf_doms_raw if waf_avail else []

findings=[]
for r in acl_data:
    lv,reason=_classify(r,"CFW-ACL")
    if lv:findings.append((lv,reason,r,"CFW-ACL"))
for r in nat_data:
    lv,reason=_classify(r,"CFW-NAT")
    if lv:findings.append((lv,reason,r,"CFW-NAT"))
for r in esg_data:
    lv,reason=_classify(r,"CFW-ESG")
    if lv:findings.append((lv,reason,r,"CFW-ESG"))
crit=[f for f in findings if f[0]=="critical"]
high=[f for f in findings if f[0]=="high"]
med=[f for f in findings if f[0]=="medium"]
disabled=[]
for rows,m in ((acl_data,"CFW-ACL"),(nat_data,"CFW-NAT"),(esg_data,"CFW-ESG")):
    for r in rows:
        if not _enable(r,m):disabled.append((r,m))

no_hit_raw=[r for r in acl_data+nat_data if _hits(r)==0 and _enable(r,"CFW-ACL" if r in acl_data else "CFW-NAT")]
sig=set();no_hit=[]
for r in no_hit_raw:
    k=(str(r.get("SourceContent","")),str(r.get("TargetContent","")),str(r.get("Port","")),str(r.get("Protocol","")),str(r.get("RuleAction","")))
    if k in sig:continue
    sig.add(k);no_hit.append(r)

waf_mode={"观察":0,"拦截":0,"未知":0}; waf_status={"防护中":0,"防护关闭":0}; waf_cls={"已开通":0,"未开通":0}
for d in waf_doms:
    m=d.get("Mode")
    waf_mode["观察" if m==0 else "拦截" if m==1 else "未知"]+=1
    waf_status["防护中" if d.get("Status")==1 else "防护关闭"]+=1
    waf_cls["已开通" if d.get("ClsStatus")==1 else "未开通"]+=1

def _act_cell(r,m):
    av=_action_raw(r,m); desc=_desc_raw(r,m)
    if _accept(r,m) and any(k in desc.lower() if k.isascii() else k in desc for k in DENY_KW):
        return H.html(f'<b>{av}</b> <span class="badge badge-critical">描述/动作矛盾</span>')
    return av

def _desc_cell(r,m):
    d=_desc_clean(r,m)
    return d if d else H.html('<span class="low">（无有效描述）</span>')

body=""
cards=[]
if cfw_ok:
    cards+=[("CFW 规则总数",rule_total),("启用规则",(start_n,"c-info")),
            ("停用规则(仅互联网边界 ACL)",(stop_n,"c-low"),"概览口径仅统计互联网边界 ACL 的停用项"),
            ("剩余配额",(remain,"c-info"))]
if waf_avail:
    cards.append(("WAF 防护域名",waf_total))
if cfw_ok:
    cards+=[("严重风险",(len(crit),"c-critical")),("高危规则",(len(high),"c-high")),
            ("中等风险",(len(med),"c-medium")),
            ("禁用规则(全模块)",(len(disabled),"c-low"),"跨 ACL/NAT/企业安全组 全部未启用项"),
            ("零命中(启用,去重)",(len(no_hit),"c-low"))]
if cards:body+=H.section("策略风险概览",H.cards(cards))

def _modrow(label,total,raw_n,uniq_n):
    notes=[]
    if raw_n>total:notes.append(f"采集 {raw_n} 条 &gt; 接口返回总量 {total}（疑分页重叠，已按规则唯一标识去重）")
    if raw_n!=uniq_n:notes.append(f"去重移除 {raw_n-uniq_n} 条重复定义")
    if not notes:notes.append("采集量与接口总量一致")
    return [label,total,uniq_n,H.html("; ".join(notes))]

if cfw_ok:
    body+=H.section("CFW 各模块规则统计",H.table(["模块","总量","已采集(去重后)","说明"],[
        _modrow("互联网边界 ACL",acl_total,len(raw_acl),len(acl_data)),
        _modrow("NAT 防火墙 ACL",nat_total,len(raw_nat),len(nat_data)),
        _modrow("企业安全组",esg_total,len(raw_esg),len(esg_data))
    ]))
    if crit:
        rows=[[(mod,"c-critical"),reason,_src(r,mod),_tgt(r,mod),str(r.get("Port","") or ""),str(r.get("Protocol","") or ""),_act_cell(r,mod),_desc_cell(r,mod)] for lv,reason,r,mod in crit[:30]]
        body+=H.finding_crit(f"严重风险规则 (共 {len(crit)})",H.table(["模块","风险类型","源","目的","端口","协议","动作","描述"],rows),H.note("公网→内部高危端口放行 / 全方位 任意-任意-任意 放行：建议立即收敛源 IP、限制端口范围、改为白名单模式。『描述/动作矛盾』徽章表示动作为放行但描述含『封禁/拒绝/禁止/屏蔽』，需人工复核动作配置是否被错配。"))
    if high:
        rows=[[(mod,"c-high"),reason,_src(r,mod),_tgt(r,mod),str(r.get("Port","") or ""),str(r.get("Protocol","") or ""),_act_cell(r,mod)] for lv,reason,r,mod in high[:30]]
        body+=H.section("高危过宽规则 (Top 30)",H.table(["模块","风险类型","源","目的","端口","协议","动作"],rows))
    if med:
        rows=[[(mod,"c-medium"),reason,_src(r,mod),_tgt(r,mod),str(r.get("Port","") or ""),str(r.get("Protocol","") or "")] for lv,reason,r,mod in med[:20]]
        body+=H.section("中等风险规则 (Top 20)",H.table(["模块","风险类型","源","目的","端口","协议"],rows))
    if no_hit:
        rows=[[r.get("Uuid",""),r.get("SourceContent",""),r.get("TargetContent",""),r.get("Port",""),r.get("Protocol",""),_act_cell(r,"CFW-ACL" if r in acl_data else "CFW-NAT"),_desc_cell(r,"CFW-ACL" if r in acl_data else "CFW-NAT")] for r in no_hit[:20]]
        body+=H.section(f"长期零命中规则 (去重后 {len(no_hit)} / 原始 {len(no_hit_raw)}, Top 20)",H.table(["规则 ID","源","目的","端口","协议","动作","描述"],rows),H.note("规则已启用但命中次数为 0，可能是规则失效、对象已下线或匹配条件错误。建议复核或下线。多条规则共享同一 (源,目的,端口,协议,动作) 的重复定义已去重。"))
    if disabled:
        rows=[[r.get("Uuid","") or r.get("RuleUuid",""),mod,_src(r,mod),_tgt(r,mod),str(r.get("Port","") or ""),_act_cell(r,mod),_desc_cell(r,mod)] for r,mod in disabled[:15]]
        body+=H.section(f"已禁用规则 (共 {len(disabled)}, Top 15)",H.table(["规则 ID","模块","源","目的","端口","动作","描述"],rows),H.note("禁用规则不生效但占用配额。注意：上方『停用规则(仅互联网边界 ACL)』口径来自 CFW 概览，仅统计互联网边界 ACL 模块；本表则统计跨 ACL/NAT/企业安全组 全部未启用的规则项，故两个数字口径不同。建议清理无用项，保留的禁用项应在描述中标注原因。"))

if waf_avail:
    body+=H.section("WAF 防护态势",H.cards([("域名总数",waf_total),("拦截模式",(waf_mode["拦截"],"c-info")),("观察模式",(waf_mode["观察"],"c-medium")),("防护关闭",(waf_status["防护关闭"],"c-high")),("访问日志已开通",waf_cls["已开通"]),("访问日志未开通",(waf_cls["未开通"],"c-low"))]))
    off=[d for d in waf_doms if d.get("Status")!=1]
    if off:
        rows=[[d.get("Domain",""),d.get("Edition",""),"观察" if d.get("Mode")==0 else "拦截",("防护关闭","c-high"),d.get("InstanceName","")] for d in off[:20]]
        body+=H.finding_crit(f"WAF 防护未开启域名 (共 {len(off)})",H.table(["域名","版本","运行模式","防护状态","实例"],rows),H.note("『防护状态』非『防护中』表示该域名未受 WAF 实际防护，攻击流量会直达源站。建议尽快开启防护。"))
    obs=[d for d in waf_doms if d.get("Status")==1 and d.get("Mode")==0]
    if obs:
        rows=[[d.get("Domain",""),d.get("Edition",""),("观察","c-medium"),d.get("InstanceName","")] for d in obs[:20]]
        body+=H.section(f"WAF 观察模式域名 (共 {len(obs)}, Top 20)",H.table(["域名","版本","运行模式","实例"],rows),H.note("观察模式仅记录不拦截。攻击实际不被阻断；调优完成后建议切换到拦截模式。"))
    names=[d.get("Domain") for d in waf_doms if d.get("Domain")][:DMAX]
    def fr(dn):return dn,wf.exec([PY,T,"waf","DescribeCustomRuleList","--Domain",dn,"--Offset","0","--Limit","100","--output","json"])
    det=wf.pmap(fr,names,workers=5) if names else {}
    rows=[]; total_rules=0; dis_rules=0
    for dn,r in det.items():
        if is_unavailable(r):
            rows.append([dn,"-",("调用失败","c-low"),(r.get("Error",{}).get("Code","Error") if isinstance(r,dict) else "Error")]); continue
        tc=r.get("TotalCount") or 0
        try:tc=int(tc)
        except:tc=len(r.get("RuleList",[]) or [])
        total_rules+=tc
        rl=r.get("RuleList",[]) or []
        d_n=sum(1 for x in rl if str(x.get("Status","")) not in ("1","true","True"))
        dis_rules+=d_n
        rows.append([dn,tc,len(rl),(d_n,"c-low") if d_n else d_n])
    if names:
        body+=H.section(f"WAF 自定义规则 (前 {len(names)} 个域名)",H.cards([("域名样本",len(names)),("规则总数",total_rules),("禁用规则",(dis_rules,"c-low"))]),H.table(["域名","规则总量","已取","禁用数"],rows))
    odd=[]
    for dn,r in det.items():
        if is_unavailable(r):continue
        for x in r.get("RuleList",[]) or []:
            strats=x.get("Strategies",[]) or []
            if any(str(s.get("Field","")).upper()=="IP" and str(s.get("Content","")).strip() in ANY_SRC for s in strats):
                odd.append([dn,x.get("RuleId",""),x.get("Name",""),x.get("ActionType",""),"启用" if str(x.get("Status",""))in("1","true","True") else "禁用"])
    if odd:
        body+=H.section(f"WAF 可疑过宽自定义规则 (匹配 IP=任意, 共 {len(odd)}, Top 15)",H.table(["域名","规则 ID","名称","动作类型","状态"],odd[:15]),H.note("自定义规则匹配条件为 IP=任意，等同于无差别命中。请复核策略意图。"))

sug=[]
for lv,reason,r,mod in crit[:5]:
    rid=r.get("Uuid","") or r.get("RuleUuid","") or "?"
    sug.append(f"<b>立即下线/收敛 规则 ID {rid}</b> ({mod} {_src(r,mod)}→{_tgt(r,mod)}:{r.get('Port','')} {r.get('Protocol','')} {_action_raw(r,mod)})：{reason}")
sug+=["立即收敛严重风险规则：禁止 0.0.0.0/0 → 任意端口 → 任意协议 的放行组合。",
      "高危端口（22/3389/3306/6379 等）必须采用白名单源 IP，禁止公网直连。"]
if waf_avail:
    sug+=["WAF 防护未开启的域名应尽快切换为防护中状态，否则攻击流量将直达源站。",
          "WAF 观察模式域名应在调优完成后切换到拦截模式。"]
sug+=["长期零命中规则建议复核业务必要性，可下线或归档（同源/目的/端口的多条重复定义优先合并）。",
      "禁用规则需在描述中标注禁用原因，避免配额浪费与维护混乱。",
      "策略调整需走变更流程，修改前与业务方确认影响面。"]
body+=H.section("加固建议",H.ol(sug))

if not a.products:
    body=H.note("本次审计未涵盖任何产品：所选范围内的云防火墙（CFW）与 Web 应用防火墙（WAF）均未开通。如需开展防火墙策略审计，请先开通对应产品后重试。")
elif not body:
    body=H.note("当前所选范围内未获取到云防火墙（CFW）或 Web 应用防火墙（WAF）的有效策略数据，且接口未明确报错。请确认对应产品是否已开通并完成接入，必要时核查访问权限。")

period=f"数据时点：{wf.time('now')}"

if __name__=="__main__":
    emit(a, H.wrap("防火墙策略审计",body,period=period,sources=sources or None,unavailable=unav or None))
