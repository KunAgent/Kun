import sys,os,json,glob,re
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,any_of,emit,product_zh,severity_filter,is_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["CWP","WAF","CFW","TCSS"],name="daily_alert_report")

enabled=detect_enabled()
apply_enabled(a,enabled)

start=wf.time("start-of","day")
end=wf.time("now")
td=wf.time("today")

cmds=[]
if has(a,"CWP"): cmds.append([PY,T,"cwp","DescribeSecurityDynamics","--Limit","100","--Offset","0","--output","json"])
if has(a,"WAF"): cmds.append([PY,T,"waf","DescribeAttackOverview","--FromTime",start,"--ToTime",end,"--output","json"])
if has(a,"CFW"): cmds.append([PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","ip","--Top","10","--output","json"])
if has(a,"TCSS"):
    cmds.append([PY,T,"tcss","DescribeContainerSecEventSummary","--output","json"])
    cmds.append([PY,T,"tcss","DescribeSecEventsTendency","--StartTime",td,"--EndTime",td,"--output","json"])
res=wf.batch(cmds) if cmds else {}

dyn=res.get("cwp.DescribeSecurityDynamics") or {}
if isinstance(dyn,dict) and "Error" not in dyn and dyn.get("TotalCount",0)>100 and len(dyn.get("SecurityDynamics",[]))<dyn.get("TotalCount",0):
    p=wf.page("cwp","DescribeSecurityDynamics","SecurityDynamics",limit=100)
    if isinstance(p,dict) and "Error" not in p:
        dyn=p
        res["cwp.DescribeSecurityDynamics"]=p

waf=res.get("waf.DescribeAttackOverview") or {}
cfw=res.get("cfw.DescribeBlockStaticList") or {}
tcss_sum=res.get("tcss.DescribeContainerSecEventSummary") or {}
tcss_tend=res.get("tcss.DescribeSecEventsTendency") or {}

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()) or set())]

cwp_ok=has(a,"CWP") and not is_unavailable(dyn)
def _waf_empty(d):
    if not isinstance(d,dict) or "Error" in d: return False
    keys=("AttackCount","AccessCount","ACLCount","CCCount","BotCount")
    return all(int(d.get(k,0) or 0)==0 for k in keys) and not any(k in d for k in keys if d.get(k) not in (None,0,"0"))
waf_ok=has(a,"WAF") and not is_unavailable(waf) and not (isinstance(waf,dict) and all(k not in waf for k in ("AttackCount","AccessCount","ACLCount","CCCount","BotCount")))
cfw_ok=has(a,"CFW") and not is_unavailable(cfw)
tcss_ok=has(a,"TCSS") and not is_unavailable(tcss_sum)

if has(a,"CWP") and not cwp_ok: unav.append(product_zh("CWP"))
if has(a,"WAF") and not waf_ok: unav.append(product_zh("WAF"))
if has(a,"CFW") and not cfw_ok: unav.append(product_zh("CFW"))
if has(a,"TCSS") and not tcss_ok: unav.append(product_zh("TCSS"))
seen=set(); unav=[x for x in unav if not (x in seen or seen.add(x))]
sources=[product_zh(p) for p in ("CWP","WAF","CFW","TCSS") if has(a,p) and product_zh(p) not in unav]

dyn_list=dyn.get("SecurityDynamics",[]) if cwp_ok else []
dyn_total=int(dyn.get("TotalCount",0) or 0) if cwp_ok else 0
_SL_LV={"RISK":"critical","HIGH":"high","MEDIUM":"medium","NORMAL":"medium","LOW":"low","INFO":"info","NOTICE":"info","UNKNOWNED":"info"}
today_dyn=[d for d in dyn_list if isinstance(d,dict) and (d.get("EventTime","") or "").startswith(td) and severity_filter(a, _SL_LV.get((d.get("SecurityLevel","") or "INFO").upper(),"info"))]

ET_LABEL={
    "MALWARE":"木马文件","BRUTEATTACK":"暴力破解","HOST_LOGIN":"异常登录",
    "BASH":"高危命令","HIGH_RISK_BASH":"高危命令","RISK_DNS":"恶意请求",
    "REVERSE_SHELL":"反弹Shell","PRIVILEGE":"本地提权","ATTACK_LOGS":"网络攻击",
    "WEB_ATTACK":"Web 攻击","SYS_VUL":"系统漏洞","WEB_VUL":"Web 漏洞",
    "EMERGENCY_VUL":"应急漏洞","BASE_LINE":"基线检查","BASELINE":"基线检查",
    "SAFE_BASE_LINE":"基线检查","NON_LOCAL_LOGIN":"异地登录",
    "CYBER_ATTACK":"网络攻击","MALICIOUS_REQUEST":"恶意请求",
    "LOGIN":"登录审计","VUL":"漏洞","TROJAN":"木马文件","TAMPER":"文件篡改",
    "ESCAPE":"容器逃逸","K8S_API":"K8s API 异常",
}
_TCSS_ET={"ET_ABNORMAL_PROCESS":"异常进程","ET_FILE":"文件篡改","ET_ESCAPE":"容器逃逸","ET_REVERSE_SHELL":"反弹Shell","ET_RISK_SYSCALL":"风险系统调用","ET_VIRUS":"恶意病毒","ET_MALICIOUS_CONNECTION":"恶意外联","ET_K8S_API":"K8s API 异常","ET_ACCESS_CONTROL":"访问控制"}
def et_zh(e):
    if not e: return "未知"
    e=str(e).upper()
    if e in ET_LABEL: return ET_LABEL[e]
    if e in _TCSS_ET: return _TCSS_ET[e]
    if e.startswith("ET_"): return e[3:].replace("_"," ").title()
    return e.replace("_"," ").title()
ET_LV={"MALWARE":"critical","REVERSE_SHELL":"critical","BRUTEATTACK":"high","HIGH_RISK_BASH":"high","BASH":"high","RISK_DNS":"high","HOST_LOGIN":"medium","ATTACK_LOGS":"high","WEB_ATTACK":"high","PRIVILEGE":"high","SYS_VUL":"medium","WEB_VUL":"medium","EMERGENCY_VUL":"high","BASE_LINE":"low","BASELINE":"low","SAFE_BASE_LINE":"low","NON_LOCAL_LOGIN":"medium","CYBER_ATTACK":"high","MALICIOUS_REQUEST":"high","LOGIN":"info","VUL":"medium","TROJAN":"critical"}
SL_ORDER=["RISK","HIGH","MEDIUM","NORMAL","LOW","INFO"]
SL_LABEL={"RISK":"严重","HIGH":"高危","MEDIUM":"中危","NORMAL":"中危","LOW":"低危","INFO":"提示","NOTICE":"提示","UNKNOWNED":"未分级"}
SL_LV={"RISK":"critical","HIGH":"high","MEDIUM":"medium","NORMAL":"medium","LOW":"low","INFO":"info","NOTICE":"info","UNKNOWNED":"info"}

_BAD_IPS={"0.0.0.0","255.255.255.255","1.1.1.1","1.2.3.4","8.8.8.8","8.8.4.4","127.0.0.1","localhost"}
def _bad_ip(ip):
    if ip in _BAD_IPS: return True
    parts=ip.split(".")
    if len(parts)!=4: return True
    try:
        a0=int(parts[0]); a1=int(parts[1])
    except Exception:
        return True
    if a0==127: return True
    if a0==0: return True
    if a0>=224: return True
    if a0==169 and a1==254: return True
    return False

et_cnt={}; sl_cnt={}; sl_other=0; ip_msg={}
for d in today_dyn:
    et=(d.get("EventType","") or "UNKNOWN")
    sl=(d.get("SecurityLevel","") or "INFO").upper()
    et_cnt[et]=et_cnt.get(et,0)+1
    if sl in SL_ORDER:
        sl_cnt[sl]=sl_cnt.get(sl,0)+1
    else:
        sl_other+=1
    for ip in re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", d.get("Message","") or ""):
        if _bad_ip(ip): continue
        ip_msg[ip]=ip_msg.get(ip,0)+1

waf_atk=int(waf.get("AttackCount",0) or 0) if waf_ok else 0
waf_acc=int(waf.get("AccessCount",0) or 0) if waf_ok else 0
waf_acl=int(waf.get("ACLCount",0) or 0) if waf_ok else 0
waf_cc=int(waf.get("CCCount",0) or 0) if waf_ok else 0
waf_bot=int(waf.get("BotCount",0) or 0) if waf_ok else 0

cfw_data=cfw.get("Data",[]) if cfw_ok else []
cfw_total=sum(int(x.get("Num",0) or 0) for x in cfw_data)

ts_proc=int(tcss_sum.get("UnhandledAbnormalProcessCnt",0) or 0) if tcss_ok else 0
ts_file=int(tcss_sum.get("UnhandledFileCnt",0) or 0) if tcss_ok else 0
ts_esc=int(tcss_sum.get("UnhandledEscapeCnt",0) or 0) if tcss_ok else 0
ts_rsh=int(tcss_sum.get("UnhandledReverseShellCnt",0) or 0) if tcss_ok else 0
ts_sys=int(tcss_sum.get("UnhandledRiskSyscallCnt",0) or 0) if tcss_ok else 0
ts_vir=int(tcss_sum.get("UnhandledVirusEventCnt",0) or 0) if tcss_ok else 0
ts_mal=int(tcss_sum.get("UnhandledMaliciousConnectionEventCnt",0) or 0) if tcss_ok else 0
ts_k8s=int(tcss_sum.get("UnhandledK8sApiEventCnt",0) or 0) if tcss_ok else 0
ts_total=ts_proc+ts_file+ts_esc+ts_rsh+ts_sys+ts_vir+ts_mal+ts_k8s

cards=[]
if cwp_ok: cards.append(("CWP 今日新增", (str(len(today_dyn)),"c-high"), f"严重 {sl_cnt.get('RISK',0)} · 高危 {sl_cnt.get('HIGH',0)}"))
if waf_ok: cards.append(("WAF 攻击次数", (str(waf_atk),"c-high"), f"访问 {waf_acc}"))
if cfw_ok: cards.append(("CFW Top10 IP 命中", (str(cfw_total),"c-medium"), f"前 {len(cfw_data)} 源 IP 合计"))
if tcss_ok: cards.append(("TCSS 未处理告警", (str(ts_total),"c-medium"), f"逃逸 {ts_esc} · 反弹 {ts_rsh}"))

today_et=sorted(et_cnt.items(),key=lambda x:-x[1])
today_et_rows=[[et_zh(e),str(c)] for e,c in today_et]

cfw_rows=[[x.get("Ip","-"), x.get("Address","-"), x.get("InsName","-") or x.get("InsID","-"), x.get("Port","-"), (str(x.get("Num",0)),"c-high")] for x in cfw_data]
ip_top=sorted(ip_msg.items(),key=lambda x:-x[1])[:10]
ip_rows=[[ip,(str(c),"c-high")] for ip,c in ip_top]

ts_rows=[("异常进程",ts_proc,"high"),("文件篡改",ts_file,"medium"),("容器逃逸",ts_esc,"critical"),("反弹Shell",ts_rsh,"critical"),("风险系统调用",ts_sys,"high"),("恶意病毒",ts_vir,"critical"),("恶意外联",ts_mal,"high"),("K8s API 异常",ts_k8s,"medium")]
ts_rows=[[lab,(str(v),lv)] for lab,v,lv in ts_rows]

ts_today={}
for e in (tcss_tend.get("EventTendencySet",[]) if isinstance(tcss_tend,dict) else []):
    et=e.get("EventType","")
    s=sum(int(x.get("Cnt",0) or 0) for x in (e.get("EventSet",[]) or []) if (x.get("CurTime","") or "")==td)
    if s>0: ts_today[et]=s
ts_today_rows=sorted([[et_zh(k),(str(v),"c-high")] for k,v in ts_today.items()],key=lambda r:-int(r[1][0]))

risks=[]
crit_dyn=[d for d in today_dyn if (d.get("SecurityLevel","") in ("RISK","HIGH"))][:8]
if crit_dyn:
    risks.append(H.finding_crit("今日严重/高危告警明细",
        H.para(f"今日共采集 <b>{len(today_dyn)}</b> 条动态，其中严重/高危 <b>{sl_cnt.get('RISK',0)+sl_cnt.get('HIGH',0)}</b> 条。前 8 条："),
        H.table(["时间","等级","类型","主机 UUID","摘要"],
            [[d.get("EventTime","-"),(SL_LABEL.get((d.get("SecurityLevel","INFO") or "INFO").upper(),d.get("SecurityLevel","-")),SL_LV.get((d.get("SecurityLevel","INFO") or "INFO").upper(),"info")),
              et_zh(d.get("EventType","")), (d.get("Uuid","-") or "-")[:36],
              (d.get("Message","") or "")[:120]] for d in crit_dyn])))
if tcss_ok and (ts_esc>0 or ts_rsh>0 or ts_vir>0):
    risks.append(H.finding_crit("容器关键告警未处置",
        H.ul([f"容器逃逸未处置 <b>{ts_esc}</b> 起，建议立即排查 Pod 运行时与共享内核风险",
              f"反弹 Shell 未处置 <b>{ts_rsh}</b> 起，疑似入侵后控制通道建立",
              f"病毒/恶意文件未处置 <b>{ts_vir}</b> 起"][:3])))
if cfw_ok and cfw_total>0 and cfw_data:
    top=cfw_data[0]
    risks.append(H.finding("防火墙 Top 攻击源",
        H.para(f"今日拦截最多的攻击源 IP <code>{top.get('Ip','-')}</code>（{top.get('Address','-')}）共 <b>{top.get('Num',0)}</b> 次，目标 {top.get('InsName','-')}/{top.get('Port','-')}。建议在 CFW 配置黑名单或封堵策略。")))
if not risks:
    risks.append(H.note("今日未发现严重/高危关键告警，已采集事件均为常规风险或低危。"))

actions=[]
_seen_act={}; _dedup_act=[]
for d in crit_dyn:
    k=((d.get("Uuid","") or ""),(d.get("EventType","") or ""))
    if k in _seen_act:
        _seen_act[k]["__cnt"]+=1
    else:
        e2=dict(d); e2["__cnt"]=1; _seen_act[k]=e2; _dedup_act.append(e2)
for d in _dedup_act[:5]:
    uuid=(d.get("Uuid","") or "")[:36]
    et=et_zh(d.get("EventType",""))
    raw=d.get("Message","") or ""
    msg=raw[:160]+("…" if len(raw)>160 else "")
    cnt=d.get("__cnt",1)
    suf=f"，当日触发 {cnt} 次" if cnt>1 else ""
    if uuid:
        actions.append(f"主机 <code>{uuid}</code>（{et}{suf}）：在 CWP 控制台隔离/查杀，并核查告警详情：{msg}")
if cfw_ok and cfw_data:
    for x in cfw_data[:3]:
        ip=x.get("Ip","-"); n=x.get("Num",0)
        actions.append(f"在 CFW 加封禁规则：源 IP <code>{ip}</code>（拦截 {n} 次，目标 {x.get('InsName','-')}/{x.get('Port','-')}）")
if tcss_ok and ts_esc>0:
    actions.append(f"TCSS 容器逃逸 <b>{ts_esc}</b> 起待处置：登录容器安全控制台逐条确认 Pod，必要时杀死容器并隔离镜像")
if tcss_ok and ts_rsh>0:
    actions.append(f"TCSS 反弹 Shell <b>{ts_rsh}</b> 起待处置：检查对应主机出向连接、定位 Shell 父进程并切断")
if waf_ok and waf_atk>0:
    actions.append(f"WAF 今日攻击 <b>{waf_atk}</b> 次：进入 WAF 控制台查看攻击日志 Top 规则与源 IP，按需启用拦截/CC 防护策略")

body=""
if cards:
    body+=H.section("今日告警概览",H.cards(cards),
        H.note(f"统计周期 {start} ~ {end} CST。CWP 数据按告警发生时间筛选当日新增；WAF/CFW 限定今日窗口；TCSS 取当前未处理告警快照。数据来源：{('、'.join(sources)) if sources else '无'}。"))

if has(a,"CWP"):
    cwp_cards=[("今日新增", (str(len(today_dyn)),"c-high"), f"近 {dyn_total} 条样本（今日子集 {len(today_dyn)}）"),
               ("严重", (str(sl_cnt.get('RISK',0)),"c-critical")),
               ("高危", (str(sl_cnt.get('HIGH',0)),"c-high")),
               ("中危", (str(sl_cnt.get('MEDIUM',0)+sl_cnt.get('NORMAL',0)),"c-medium")),
               ("低危/提示", (str(sl_cnt.get('LOW',0)+sl_cnt.get('INFO',0)),"c-info"))]
    if sl_other>0:
        cwp_cards.append(("未分级", (str(sl_other),"c-info"), "安全等级未知/系统未分级"))
    notes=[]
    if dyn.get("_Capped"):
        notes.append(H.note(f"⚠️ 动态数据量超过采集上限（10000 条），已截断展示；今日真实告警量可能高于此处统计，建议缩短时间窗或在 CWP 控制台核对。"))
    body+=H.section("CWP 今日新增告警",
        H.cards(cwp_cards) if cwp_ok else H.note("CWP 不可用：" + (dyn.get("Error",{}).get("Message","") if isinstance(dyn,dict) else "")),
        *notes,
        H.table(["类型","条数"],today_et_rows) if today_et_rows else (H.note("CWP 今日无新增告警。") if cwp_ok else ""))

if waf_ok:
    body+=H.section("WAF 攻击概览",
        H.cards([("攻击次数",(str(waf_atk),"c-high")),("访问次数",str(waf_acc)),
                 ("ACL 拦截",(str(waf_acl),"c-medium")),("CC 攻击",(str(waf_cc),"c-medium")),("Bot 请求",(str(waf_bot),"c-low"))]))

if cfw_ok:
    body+=H.section("CFW 拦截 Top 10 攻击源 IP",
        H.table(["攻击 IP","归属","目标资产","端口","拦截次数"],cfw_rows) if cfw_rows else H.note("今日无 CFW 拦截记录。"))

if has(a,"CWP") and ip_rows:
    body+=H.section(f"CWP 告警描述中提取的 Top {len(ip_rows)} IP",
        H.note("从当日告警描述文本中提取，已剔除 0.0.0.0/127.x/示例 IP 等占位地址；可能混合源/目标 IP，仅作参考。"),
        H.table(["IP","出现次数"],ip_rows))

if tcss_ok:
    body+=H.section("TCSS 容器安全（未处理告警快照 + 今日趋势）",
        H.table(["告警类别","未处理数"],ts_rows),
        H.table(["事件类型","今日新增"],ts_today_rows) if ts_today_rows else H.note("今日 TCSS 暂无新增事件。"))

risk_blocks=list(risks)
if actions:
    risk_blocks.append(H.finding("可执行处置建议",H.ul(actions)))
body+=H.section("今日关键风险摘要与处置建议",*risk_blocks)

if not a.products:
    body=H.note("当前过滤参数下没有任何启用产品可查询，请检查产品开通状态或调整范围。")
elif not body:
    body=H.note("当前过滤参数下没有任何启用产品可查询，请检查产品开通状态或调整范围。")

if __name__=="__main__":
    emit(a, H.wrap("今日告警报告",body,
        period=f"{start} ~ {end} CST",
        sources=sources or None,
        unavailable=unav or None))
