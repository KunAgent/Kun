import sys,os,json,glob,re
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,emit,product_zh,page_limit,is_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["CWP","WAF","CFW","TCSS","KMS","SSM"],name="weekly_security_inspection")
enabled=detect_enabled()
apply_enabled(a,enabled)

DAYS=a.days or 7
s,e=wf.time_range(DAYS,"d")
sd,ed=wf.time_date_range(DAYS,"d")

cmds=[]
if has(a,"CWP"):
    cmds.append([PY,T,"cwp","DescribeGeneralStat","--output","json"])
    cmds.append([PY,T,"cwp","DescribeOverviewStatistics","--output","json"])
    cmds.append([PY,T,"cwp","DescribeSecurityEventsCnt","--output","json"])
    cmds.append([PY,T,"cwp","DescribeVulHostCountScanTime","--output","json"])
    cmds.append([PY,T,"cwp","DescribeSecurityTrends","--BeginDate",sd,"--EndDate",ed,"--output","json"])
    cmds.append([PY,T,"cwp","DescribeVulList","--Limit","20","--Offset","0","--output","json"])
if has(a,"WAF"):
    cmds.append([PY,T,"waf","DescribeAttackOverview","--FromTime",s,"--ToTime",e,"--output","json"])
    cmds.append([PY,T,"waf","DescribeHosts","--output","json"])
if has(a,"CFW"):
    cmds.append([PY,T,"cfw","DescribeBlockStaticList","--StartTime",s,"--EndTime",e,"--QueryType","ip","--Top","10","--output","json"])
    cmds.append([PY,T,"cfw","DescribeBlockStaticList","--StartTime",s,"--EndTime",e,"--QueryType","port","--Top","10","--output","json"])
    cmds.append([PY,T,"cfw","DescribeRuleOverview","--output","json"])
    cmds.append([PY,T,"cfw","DescribeSwitchLists","--Limit","20","--Offset","0","--output","json"])
if has(a,"TCSS"):
    cmds.append([PY,T,"tcss","DescribeTcssSummary","--output","json"])
    cmds.append([PY,T,"tcss","DescribeVulSummary","--output","json"])
    cmds.append([PY,T,"tcss","DescribeContainerSecEventSummary","--output","json"])
if has(a,"KMS"):
    cmds.append([PY,T,"kms","GetRegions","--output","json"])
if has(a,"SSM"):
    cmds.append([PY,T,"ssm","ListSecrets","--Offset","0","--Limit",str(page_limit(a)),"--output","json"])
res=wf.batch(cmds,workers=6) if cmds else {}

_kms_rgn_resp=res.get("kms.GetRegions") or {}
_kms_regions=(_kms_rgn_resp.get("Regions") or []) if isinstance(_kms_rgn_resp,dict) and "Error" not in _kms_rgn_resp else ["ap-guangzhou","ap-beijing","ap-shanghai","ap-chengdu","ap-nanjing"]
def _kms_fetch(r):
    return r,wf.page("kms","ListKeyDetail","KeyMetadatas",limit=200,workers=3,extra=["--region",r,"--KeyState","0","--KeyUsage","ALL","--Origin","ALL"])
_kms_by_region=wf.pmap(_kms_fetch,_kms_regions,workers=8) if has(a,"KMS") and _kms_regions else {}
_kms_all_keys=[]
_kms_region_totals={}
for _r,_resp in (_kms_by_region.items() if isinstance(_kms_by_region,dict) else []):
    if is_unavailable(_resp): continue
    _kms_all_keys.extend(_resp.get("KeyMetadatas") or [])
    _kms_region_totals[_r]=_resp.get("TotalCount",0)
_ks_combined={"KeyMetadatas":_kms_all_keys,"Keys":_kms_all_keys,"TotalCount":sum(_kms_region_totals.values())} if _kms_region_totals else {}
if has(a,"KMS"): res["kms.ListKeyDetail"]=_ks_combined

def R(k):
    d=res.get(k)
    if not isinstance(d,dict) or "Error" in d: return {}
    return d
def avail(k):
    d=res.get(k)
    if is_unavailable(d): return False
    return bool(d) and isinstance(d,dict) and "Error" not in d

cwp_keys=["cwp.DescribeGeneralStat","cwp.DescribeOverviewStatistics","cwp.DescribeSecurityEventsCnt","cwp.DescribeVulHostCountScanTime","cwp.DescribeSecurityTrends","cwp.DescribeVulList"]
waf_keys=["waf.DescribeAttackOverview","waf.DescribeHosts"]
cfw_keys=["cfw.DescribeBlockStaticList","cfw.DescribeBlockStaticList_1","cfw.DescribeRuleOverview","cfw.DescribeSwitchLists"]
tcss_keys=["tcss.DescribeTcssSummary","tcss.DescribeVulSummary","tcss.DescribeContainerSecEventSummary"]
kms_keys=["kms.ListKeyDetail"]
ssm_keys=["ssm.ListSecrets"]

def all_unav(ks): return all(not avail(k) for k in ks)

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()) or [])]
def _add_unav(p):
    z=product_zh(p)
    if z not in unav: unav.append(z)
if has(a,"CWP") and all_unav(cwp_keys): _add_unav("CWP")
if has(a,"WAF") and all_unav(waf_keys): _add_unav("WAF")
if has(a,"CFW") and all_unav(cfw_keys): _add_unav("CFW")
if has(a,"TCSS") and all_unav(tcss_keys): _add_unav("TCSS")
if has(a,"KMS") and all_unav(kms_keys): _add_unav("KMS")
if has(a,"SSM") and all_unav(ssm_keys): _add_unav("SSM")
sources=[product_zh(p) for p in ("CWP","WAF","CFW","TCSS","KMS","SSM") if has(a,p) and product_zh(p) not in unav]

gs=R("cwp.DescribeGeneralStat");ov=R("cwp.DescribeOverviewStatistics");ec=R("cwp.DescribeSecurityEventsCnt")
vs=R("cwp.DescribeVulHostCountScanTime");trd=R("cwp.DescribeSecurityTrends");vl=R("cwp.DescribeVulList")
wao=R("waf.DescribeAttackOverview");wh=R("waf.DescribeHosts")
cbl_ip=R("cfw.DescribeBlockStaticList");cbl_pt=R("cfw.DescribeBlockStaticList_1");cro=R("cfw.DescribeRuleOverview");csl=R("cfw.DescribeSwitchLists")
tsum=R("tcss.DescribeTcssSummary");tvul=R("tcss.DescribeVulSummary");tev=R("tcss.DescribeContainerSecEventSummary")
ks=R("kms.ListKeyDetail");ss=R("ssm.ListSecrets")

def n(v,d=0):
    try: return int(v)
    except Exception: return d

m_all=n(gs.get("MachinesAll"));m_on=n(gs.get("AgentsOnline"));m_off=n(gs.get("AgentsOffline"));m_pro=n(gs.get("AgentsPro"));m_risk=n(gs.get("RiskMachine"));m_flag=n(gs.get("FlagshipMachineCnt"));m_uninst=n(gs.get("MachinesUninstalled"));m_added=n(gs.get("AddedOnTheFifteen"))
ov_mal=n(ov.get("MalwareNum"));ov_login=n(ov.get("NonlocalLoginNum"));ov_brute=n(ov.get("BruteAttackSuccessNum"));ov_vul=n(ov.get("VulNum"));ov_base=n(ov.get("BaseLineNum"))
def cnt(d,k): x=(d or {}).get(k) or {}; return n(x.get("EventCnt")) if isinstance(x,dict) else 0
ec_mal=cnt(ec,"Malware");ec_brute=cnt(ec,"BruteAttack");ec_login=cnt(ec,"HostLogin");ec_rev=cnt(ec,"ReverseShell");ec_bash=cnt(ec,"Bash");ec_base=cnt(ec,"BaseLine");ec_priv=cnt(ec,"PrivilegeRules");ec_dns=cnt(ec,"RiskDns");ec_atk=cnt(ec,"AttackLogs");ec_evul=cnt(ec,"EmergencyVul");ec_svul=cnt(ec,"SysVul");ec_wvul=cnt(ec,"WebVul");ec_winvul=cnt(ec,"WindowVul");ec_lvul=cnt(ec,"LinuxVul")
ec_total=n(ec.get("EventsCount"));ec_eff=n(ec.get("EffectMachineCount"))
vs_total=n(vs.get("TotalVulCount"));vs_hosts=n(vs.get("VulHostCount"));vs_scan=vs.get("ScanTime") or "-"

vul_total=n(vl.get("TotalCount"));vul_focus=n(vl.get("FollowVulCount"));vlist=vl.get("VulInfoList") or []
sev=high=mid=low=0
for v in vlist:
    lv=n(v.get("Level"))
    if lv>=4: sev+=1
    elif lv==3: high+=1
    elif lv==2: mid+=1
    else: low+=1

w_acc=n(wao.get("AccessCount"));w_atk=n(wao.get("AttackCount"));w_acl=n(wao.get("ACLCount"));w_cc=n(wao.get("CCCount"));w_bot=n(wao.get("BotCount"));w_api=n(wao.get("ApiAssetsCount"))
w_hosts=wh.get("HostList") or [];w_htot=n(wh.get("TotalCount"),len(w_hosts))

cf_all=n(cro.get("AllTotal"));cf_use=n(cro.get("StrategyNum"));cf_on=n(cro.get("StartRuleNum"));cf_off=n(cro.get("StopRuleNum"));cf_rem=n(cro.get("RemainingNum"))
cbl_ips=cbl_ip.get("Data") or [];cbl_pts=cbl_pt.get("Data") or []
csl_data=csl.get("Data") or [];csl_tot=n(csl.get("Total"),len(csl_data))
csl_on=sum(1 for x in csl_data if x.get("Switch") in (1,"1"));csl_off=len(csl_data)-csl_on

t_img=n(tsum.get("ImageCnt"))+n(tsum.get("RepositoryImageCnt"));t_rimg=n(tsum.get("RiskLocalImageCnt"))+n(tsum.get("RiskRepositoryImageCnt"));t_cont=n(tsum.get("ContainerCnt"));t_rcont=n(tsum.get("RiskContainerCnt"));t_clu=n(tsum.get("ClusterCnt"));t_rclu=n(tsum.get("RiskClusterCnt"));t_evt=n(tsum.get("RuntimeUnhandleEventCnt"));t_base=n(tsum.get("RiskBaseLineCnt"));t_uns_img=n(tsum.get("UnScannedImageCnt"));t_uns_clu=n(tsum.get("UnScannedClusterCnt"))
t_vul_total=n(tvul.get("VulTotalCount"));t_vul_ser=n(tvul.get("SeriousVulCount"));t_vul_em=n(tvul.get("EmergencyVulnerabilityCount"));t_vul_poc=n(tvul.get("PocExpLevelVulCount"))
t_ev_file=n(tev.get("UnhandledFileCnt"));t_ev_esc=n(tev.get("UnhandledEscapeCnt"));t_ev_rev=n(tev.get("UnhandledReverseShellCnt"));t_ev_pro=n(tev.get("UnhandledAbnormalProcessCnt"));t_ev_vir=n(tev.get("UnhandledVirusEventCnt"));t_ev_mal=n(tev.get("UnhandledMaliciousConnectionEventCnt"));t_ev_k8s=n(tev.get("UnhandledK8sApiEventCnt"));t_ev_sys=n(tev.get("UnhandledRiskSyscallCnt"))

k_list=ks.get("KeyMetadatas") or ks.get("Keys") or [];k_tot=n(ks.get("TotalCount"),len(k_list))
s_list=ss.get("SecretMetadatas") or [];s_tot=n(ss.get("TotalCount"),len(s_list))
s_rot_on=sum(1 for x in s_list if x.get("RotationStatus") in (1,True))
s_rot_off=len(s_list)-s_rot_on
s_pend=[x for x in s_list if x.get("Status")=="PendingDelete"]
s_dis=[x for x in s_list if x.get("Status")=="Disabled"]
ks_no_rot=sum(1 for k in k_list if not k.get("KeyRotationEnabled") and k.get("KeyState")=="Enabled")
ks_pending=sum(1 for k in k_list if k.get("KeyState")=="PendingImport")

def score(host_signals, used, has_data):
    if not used: return None
    if not has_data: return None
    p=100-min(40,host_signals*2)
    return max(0,p)

cwp_used=has(a,"CWP") and (avail("cwp.DescribeGeneralStat") or avail("cwp.DescribeSecurityEventsCnt"))
cfw_used=has(a,"CFW") and avail("cfw.DescribeRuleOverview")
waf_used=has(a,"WAF") and avail("waf.DescribeHosts") and w_htot>0
tcss_used=has(a,"TCSS") and avail("tcss.DescribeTcssSummary")
kms_used=has(a,"KMS") and avail("kms.ListKeyDetail")
ssm_used=has(a,"SSM") and avail("ssm.ListSecrets")
id_used=kms_used or ssm_used

cwp_data=m_all>0 or ec_total>0 or vul_total>0
waf_data=w_htot>0 or w_atk>0
cfw_data=cf_all>0 or len(cbl_ips)>0 or csl_tot>0
tcss_data=t_img>0 or t_cont>0 or t_clu>0
id_data=k_tot>0 or s_tot>0

host_signal=ec_mal+ec_brute+ec_rev+ec_priv+ov_brute*2+m_risk*5+sev*3+high
net_signal=len(cbl_ips)+csl_off
app_signal=w_atk//50+w_cc//100+w_bot//100
data_signal=t_rcont+t_rimg+t_evt//5+t_vul_ser//50+t_ev_esc*5+t_ev_rev*3
id_signal=s_rot_off+len(s_pend)*5+ks_no_rot*3+ks_pending*5

dim_score=[]
if has(a,"CWP"): dim_score.append(("主机安全",score(host_signal,cwp_used,cwp_data),"CWP"))
if has(a,"CFW"): dim_score.append(("网络安全",score(net_signal,cfw_used,cfw_data),"CFW"))
if has(a,"WAF"): dim_score.append(("应用安全",score(app_signal,waf_used,waf_data),"WAF"))
if has(a,"TCSS") or id_used: dim_score.append(("数据安全",score(data_signal,tcss_used or id_used,tcss_data or id_data),"TCSS/KMS"))
if id_used or has(a,"KMS") or has(a,"SSM"): dim_score.append(("身份安全",score(id_signal,id_used,id_data),"KMS/SSM"))

def lvl(p):
    if p is None: return "info"
    if p>=95: return "low"
    if p>=85: return "info"
    if p>=70: return "medium"
    if p>=50: return "high"
    return "critical"
def grade(p):
    if p is None: return "未开通/无数据"
    if p>=95: return "良好"
    if p>=85: return "一般"
    if p>=70: return "偏弱"
    if p>=50: return "高危"
    return "严重"

dim_rows=[[d, (str(p) if p is not None else "-", lvl(p)), (grade(p), lvl(p)), prod] for d,p,prod in dim_score]
overall_vals=[p for _,p,_ in dim_score if p is not None]
overall=sum(overall_vals)//len(overall_vals) if overall_vals else None

kpi=[("综合评分",(str(overall) if overall is not None else "-",lvl(overall)))]
if cwp_used and cwp_data:
    kpi.append(("纳管主机",str(m_all),f"在线 {m_on} / 离线 {m_off}"))
    kpi.append(("CWP 安全事件",(str(ec_total),"c-high" if ec_total>0 else "c-info")))
    kpi.append(("漏洞数（待处理）",(str(vs_total),"c-high" if vs_total>0 else "c-info")))
elif has(a,"CWP") and cwp_used and not cwp_data:
    kpi.append(("CWP","0","纳管主机为 0，无可观测数据"))
if waf_used and waf_data: kpi.append(("WAF 攻击拦截",(str(w_atk),"c-high" if w_atk>0 else "c-info")))
if cfw_used and cfw_data: kpi.append(("CFW 启用规则",f"{cf_on} / {cf_all}"))
if tcss_used and tcss_data:
    kpi.append(("TCSS 风险镜像",(str(t_rimg),"c-high" if t_rimg>0 else "c-info")))
    kpi.append(("TCSS 严重高危漏洞",(str(t_vul_ser),"c-high" if t_vul_ser>0 else "c-info")))
if id_used and id_data: kpi.append(("密钥/凭据",f"{k_tot} / {s_tot}"))

cwp_rows=[
    ["主机总数",str(m_all),"在线 Agent",str(m_on)],
    ["离线 Agent",str(m_off),"未安装",str(m_uninst)],
    ["专业版",str(m_pro),"旗舰版",str(m_flag)],
    ["风险主机",(str(m_risk),"c-high" if m_risk>0 else "c-info"),"近 15 天新增",str(m_added)],
    ["最近扫描时间",vs_scan,"受漏洞影响主机",str(vs_hosts)],
]

ev_rows=[
    ["木马事件",(str(ec_mal),"high" if ec_mal>0 else "info")],
    ["暴力破解",(str(ec_brute),"high" if ec_brute>0 else "info")],
    ["登录事件",(str(ec_login),"info")],
    ["反弹 Shell",(str(ec_rev),"critical" if ec_rev>0 else "info")],
    ["高危命令",(str(ec_bash),"high" if ec_bash>0 else "info")],
    ["本地提权",(str(ec_priv),"critical" if ec_priv>0 else "info")],
    ["恶意请求",(str(ec_dns),"high" if ec_dns>0 else "info")],
    ["网络攻击",(str(ec_atk),"high" if ec_atk>0 else "info")],
    ["应急漏洞",(str(ec_evul),"critical" if ec_evul>0 else "info")],
    ["系统漏洞",(str(ec_svul),"high" if ec_svul>0 else "info")],
    ["Web 漏洞",(str(ec_wvul),"high" if ec_wvul>0 else "info")],
    ["Linux 软件漏洞",(str(ec_lvul),"medium" if ec_lvul>0 else "info")],
    ["Windows 漏洞",(str(ec_winvul),"medium" if ec_winvul>0 else "info")],
    ["基线告警",(str(ec_base),"medium" if ec_base>0 else "info")],
]

vul_lvl_map={4:"严重",3:"高危",2:"中危",1:"低危"}
def vlevel_color(l): return {"严重":"critical","高危":"high","中危":"medium","低危":"low"}.get(l,"info")
def _clean_cve(nm):
    if not nm: return "-"
    cves=re.findall(r"CVE-\d{4}-\d+",nm)
    if len(cves)>=2 and cves[0]==cves[1]:
        nm=re.sub(r"\s*\(CVE-\d{4}-\d+\)\s*$","",nm)
    return nm
top_vuls=[]
for v in (vlist or [])[:10]:
    l=vul_lvl_map.get(n(v.get("Level")),"-")
    nm=_clean_cve(v.get("Name",""))[:60]
    top_vuls.append([nm or "-",(l,vlevel_color(l)),v.get("CveId") or "-",str(n(v.get("HostCount"))),str(v.get("CvssScore","-")),v.get("LastTime","-")])

waf_host_rows=[]
for h in (w_hosts or [])[:10]:
    eng={1:"拦截",10:"观察+AI关",11:"观察+AI观察",12:"观察+AI拦截",20:"拦截+AI关",21:"拦截+AI观察",22:"拦截+AI拦截"}.get(n(h.get("Engine")),"-")
    cls=("已开启","info") if h.get("ClsStatus")==1 else ("未开启","medium")
    waf_host_rows.append([h.get("Domain","-"),h.get("Edition","-"),eng,cls,h.get("Region","-"),str(h.get("Level","-"))])

cbl_ip_rows=[[d.get("Address",d.get("Ip","-")),str(d.get("Num",d.get("Count","-"))),d.get("InCount","-"),d.get("OutCount","-")] for d in (cbl_ips or [])[:10]]
cbl_pt_rows=[[str(d.get("Port",d.get("Port","-"))),str(d.get("Num",d.get("Count","-"))),d.get("Protocol","-")] for d in (cbl_pts or [])[:10]]

tcss_rows=[
    ["镜像总数",str(t_img),"风险镜像",(str(t_rimg),"c-high" if t_rimg>0 else "c-info")],
    ["未扫描镜像",str(t_uns_img),"应急漏洞",(str(t_vul_em),"c-critical" if t_vul_em>0 else "c-info")],
    ["容器总数",str(t_cont),"风险容器",(str(t_rcont),"c-high" if t_rcont>0 else "c-info")],
    ["集群总数",str(t_clu),"风险集群",(str(t_rclu),"c-high" if t_rclu>0 else "c-info")],
    ["运行时未处置事件",(str(t_evt),"c-high" if t_evt>0 else "c-info"),"基线风险",(str(t_base),"c-medium" if t_base>0 else "c-info")],
    ["漏洞总数",str(t_vul_total),"严重高危漏洞",(str(t_vul_ser),"c-high" if t_vul_ser>0 else "c-info")],
]

tev_rows=[
    ["文件监控",(str(t_ev_file),"high" if t_ev_file>0 else "info")],
    ["容器逃逸",(str(t_ev_esc),"critical" if t_ev_esc>0 else "info")],
    ["反弹 Shell",(str(t_ev_rev),"critical" if t_ev_rev>0 else "info")],
    ["异常进程",(str(t_ev_pro),"high" if t_ev_pro>0 else "info")],
    ["病毒事件",(str(t_ev_vir),"critical" if t_ev_vir>0 else "info")],
    ["恶意外联",(str(t_ev_mal),"high" if t_ev_mal>0 else "info")],
    ["K8s API",(str(t_ev_k8s),"medium" if t_ev_k8s>0 else "info")],
    ["高危系统调用",(str(t_ev_sys),"high" if t_ev_sys>0 else "info")],
]

id_rows=[
    ["KMS 密钥总数",str(k_tot),"SSM 凭据总数",str(s_tot)],
    ["凭据已开启轮换",(str(s_rot_on),"c-info"),"凭据未开启轮换",(str(s_rot_off),"c-high" if s_rot_off>0 else "c-info")],
    ["凭据待删除",(str(len(s_pend)),"c-critical" if s_pend else "c-info"),"凭据已禁用",(str(len(s_dis)),"c-medium" if s_dis else "c-info")],
]

risks=[]
if cwp_used and cwp_data and (ec_rev>0 or ec_priv>0):
    risks.append(H.finding_crit("发现入侵后渗透行为",H.para(f"过去 {DAYS} 天检测到 反弹 Shell <b>{ec_rev}</b> 起 / 本地提权 <b>{ec_priv}</b> 起，建议立即排查涉事主机。")))
if cwp_used and cwp_data and (ec_evul>0 or ec_mal>0):
    risks.append(H.finding_crit("应急漏洞或恶意文件未处置",H.para(f"应急漏洞事件 <b>{ec_evul}</b> 起、木马 <b>{ec_mal}</b> 起，建议优先修复并清理。")))
if tcss_used and tcss_data and (t_ev_esc>0 or t_ev_vir>0):
    risks.append(H.finding_crit("容器侧严重事件",H.para(f"容器逃逸 <b>{t_ev_esc}</b> 起、病毒事件 <b>{t_ev_vir}</b> 起。")))
if ssm_used and s_pend:
    risks.append(H.finding_crit("凭据待删除",H.para(f"<b>{len(s_pend)}</b> 个 SSM 凭据处于待删除状态，删除后依赖应用将不可用。"),H.ul([str(x.get("SecretName","-")) for x in s_pend[:10]])))
if cwp_used and cwp_data and (sev>0 or high>0):
    _vul_sampled=len(vlist)<vul_total
    _vul_title=f"漏洞中发现 {sev+high} 条高危及以上（{'采样 '+str(len(vlist))+' 条' if _vul_sampled else '全量 '+str(vul_total)+' 条'}）"
    _vul_suffix="漏洞清单按等级倒序，全量高危及以上数量预计远高于此处采样值。建议结合资产重要性优先修复。" if _vul_sampled else "建议结合资产重要性优先修复。"
    risks.append(H.finding(_vul_title,H.para(f"严重 <b>{sev}</b> · 高危 <b>{high}</b> · 中危 {mid} · 低危 {low}（{'采样 '+str(len(vlist))+' / 总 '+str(vul_total) if _vul_sampled else '全量 '+str(vul_total)}）。{_vul_suffix}")))
if waf_used and waf_data and w_atk>0:
    risks.append(H.finding(f"WAF 累计拦截 {w_atk} 次攻击",H.para(f"接入 {w_htot} 个域名，访问量 {w_acc}，CC {w_cc} · Bot {w_bot} · ACL {w_acl}。")))
if cfw_used and cfw_data and csl_off>0:
    risks.append(H.finding(f"CFW 资产开关 {csl_off} 个未开启",H.para(f"采样 {len(csl_data)} 个资产，已开启 {csl_on}，未开启 {csl_off}。建议核查未开启资产是否需纳入防护。")))
if ssm_used and s_rot_off>0:
    _ssm_scope=f"已采样 {len(s_list)} / 总 {s_tot}" if len(s_list)<s_tot else f"全量 {s_tot}"
    risks.append(H.finding(f"SSM 凭据 {s_rot_off} 个未启用轮换（{_ssm_scope} 中）",H.para(f"{_ssm_scope} 个凭据中 {s_rot_off} 个未启用自动轮换，长期有效凭据存在泄露风险。" + ("实际未轮换总数可能更高。" if len(s_list)<s_tot else ""))))
if unav:
    risks.append(H.finding("安全产品覆盖度不足",H.para(f"本次周报涉及但未开通：<b>{'、'.join(unav)}</b>。建议评估是否需要开通以补全网络/应用/数据层防护链。")))
if has(a,"CWP") and cwp_used and m_all==0:
    risks.append(H.finding("CWP 未纳管任何主机",H.para("当前账号下 0 台主机被纳管，主机层无可观测数据。请确认 CWP Agent 安装状态、跨账号采集范围及当前凭据访问的地域范围。")))
if not risks:
    risks=[H.note(f"本期统计周期内未识别到显著风险信号。建议核查：1) 安全产品开通范围（当前数据来源 {len(sources)} 项）；2) 主机/容器纳管覆盖度；3) 当前凭据所覆盖的地域是否完整。")]

todos=[]
if (cwp_used and cwp_data and (ec_rev>0 or ec_priv>0)) or (tcss_used and tcss_data and (t_ev_esc>0 or t_ev_vir>0)):
    todos.append("立即排查并隔离受影响主机/容器，确认 IOC 并溯源。")
if cwp_used and cwp_data and (ec_evul>0 or sev>0):
    todos.append("优先修复应急/严重漏洞，必要时启用虚拟补丁。")
if cfw_used and cfw_data and csl_off>0:
    todos.append(f"核查 CFW {csl_off} 个未开启的资产开关。")
if ssm_used and s_rot_off>0:
    todos.append("为长期 SSM 凭据开启自动轮换。")
if tcss_used and tcss_data and (t_uns_img>0 or t_uns_clu>0):
    parts=[]
    if t_uns_img>0: parts.append(f"未扫描镜像 {t_uns_img} 个")
    if t_uns_clu>0: parts.append(f"未扫描集群 {t_uns_clu} 个")
    todos.append(f"完成 TCSS {' / '.join(parts)}的扫描。")
if unav:
    todos.append(f"评估开通 {'、'.join(unav)}，补全 网络 / 应用 / 容器 / 数据 层防护。")
if has(a,"CWP") and cwp_used and m_all==0:
    todos.append("安装 CWP Agent 或核对纳管范围；当前 0 台主机无可观测面。")
if not todos:
    todos.append("本期未触发处置项。建议持续巡检并核查产品开通与纳管覆盖度。")

body=""
if kpi:
    body+=H.section("一周态势总览",H.cards(kpi),H.para("综合评分基于已开通产品的多维信号加权（事件/告警/漏洞/未处置项越多得分越低）；未开通或零数据维度按 未开通/无数据 标注，不计入综合评分。"))
if dim_rows:
    body+=H.section(f"已开通 {len(dim_rows)} 项维度评分",H.table(["维度","评分","等级","数据来源"],dim_rows),H.note("评分仅作为相对参考。具体处置请结合资产重要性与业务影响判断。"))

if cwp_used and cwp_data:
    body+=H.section("主机安全 CWP",
        H.cards([("木马（累计）",(str(ov_mal),"c-high" if ov_mal>0 else "c-info")),
                 ("异地登录（累计）",(str(ov_login),"c-medium" if ov_login>0 else "c-info")),
                 ("暴力破解成功（累计）",(str(ov_brute),"c-critical" if ov_brute>0 else "c-info")),
                 ("漏洞数（累计）",(str(ov_vul),"c-high" if ov_vul>0 else "c-info")),
                 ("基线告警（累计）",(str(ov_base),"c-medium" if ov_base>0 else "c-info")),
                 ("受影响主机",(str(ec_eff),"c-high" if ec_eff>0 else "c-info"))]),
        H.note("CWP 概览数据为自纳管以来累计统计，非本周内增量。"),
        H.table(["指标","数值","指标","数值"],cwp_rows),
        H.para(H.color(f"CWP 安全事件分类（过去 {DAYS} 天）","c-info")),
        H.table(["事件类型","数量","事件类型","数量"],[[ev_rows[i][0],ev_rows[i][1],ev_rows[i+1][0] if i+1<len(ev_rows) else "",ev_rows[i+1][1] if i+1<len(ev_rows) else ""] for i in range(0,len(ev_rows),2)]),
        H.note(f"CWP 事件总数 {ec_total}，上表 14 类合计 {ec_mal+ec_brute+ec_login+ec_rev+ec_bash+ec_base+ec_priv+ec_dns+ec_atk+ec_evul+ec_svul+ec_wvul+ec_winvul+ec_lvul}，差额为其他子类型（如 RASP、恶意外联等未列入本表的分类）。") if ec_total>0 else "",
        H.para(f"漏洞清单全状态 <b>{vul_total}</b>，其中待处理 <b>{vs_total}</b>，重点关注 <b>{vul_focus}</b>。Top {min(10,len(top_vuls))} 高危漏洞：") if top_vuls else H.note("漏洞列表为空。"),
        H.note("总览卡片『漏洞数（待处理）』为 CWP 主机漏洞扫描的待处理数；本节『漏洞清单全状态』包含已修复/已忽略，差额为已处置部分。"),
        H.table(["漏洞名称","等级","CVE","影响主机","CVSS","最近检测"],top_vuls) if top_vuls else "")
elif has(a,"CWP") and cwp_used and not cwp_data:
    body+=H.section("主机安全 CWP",H.note("CWP 已开通但当前账号下纳管主机为 0，本段不可用。请确认 Agent 安装与跨账号采集范围。"))

if waf_used and waf_data:
    body+=H.section("应用安全 WAF",
        H.cards([("访问量",str(w_acc)),("攻击数",(str(w_atk),"c-high" if w_atk>0 else "c-info")),
                 ("ACL 拦截",str(w_acl)),("CC 拦截",str(w_cc)),("Bot",str(w_bot)),
                 ("API 资产",str(w_api)),("接入域名",str(w_htot))]),
        H.para(f"防护域名（前 {len(waf_host_rows)} / 总 {w_htot}）："),
        H.table(["域名","版本","引擎模式","日志","地域","等级"],waf_host_rows) if waf_host_rows else H.note("暂无防护域名详情。"))
elif has(a,"WAF") and waf_used and not waf_data:
    body+=H.section("应用安全 WAF",H.note("WAF 已开通但暂未接入域名或 API 调用未返回数据，跳过细节展示。"))

if cfw_used and cfw_data:
    body+=H.section("网络安全 CFW",
        H.cards([("规则总数",str(cf_all)),("启用",(str(cf_on),"c-info")),("停用",(str(cf_off),"c-medium" if cf_off>0 else "c-info")),
                 ("剩余配额",str(cf_rem)),("策略组",str(cf_use)),
                 ("资产开关已开",(str(csl_on),"c-info")),("资产开关未开",(str(csl_off),"c-high" if csl_off>0 else "c-info"))]),
        H.para(f"拦截 IP TOP {min(10,len(cbl_ip_rows))}（过去 {DAYS} 天）：") if cbl_ip_rows else "",
        H.table(["IP","次数","入站","出站"],cbl_ip_rows) if cbl_ip_rows else H.note("无 CFW 封禁 IP 数据。"),
        H.para(f"拦截端口 TOP {min(10,len(cbl_pt_rows))}：") if cbl_pt_rows else "",
        H.table(["端口","次数","协议"],cbl_pt_rows) if cbl_pt_rows else "")
elif has(a,"CFW") and cfw_used and not cfw_data:
    body+=H.section("网络安全 CFW",H.note("CFW 已开通但本期无规则/拦截数据。"))

if tcss_used and tcss_data:
    body+=H.section("容器安全 TCSS",
        H.table(["指标","数值","指标","数值"],tcss_rows),
        H.para("运行时未处置事件分类（同一事件可能命中多个类型，各分类相加可大于总数）："),
        H.table(["事件类型","未处置数","事件类型","未处置数"],[[tev_rows[i][0],tev_rows[i][1],tev_rows[i+1][0] if i+1<len(tev_rows) else "",tev_rows[i+1][1] if i+1<len(tev_rows) else ""] for i in range(0,len(tev_rows),2)]))

if id_used and id_data:
    note_txt=f"KMS 密钥总数 {k_tot}（全地域合计），SSM 凭据总数 {s_tot}。"
    if _kms_region_totals:
        note_txt+=" 各地域："+", ".join(f"{r}={v}" for r,v in _kms_region_totals.items() if v>0)+"。"
    if len(k_list)<k_tot or len(s_list)<s_tot:
        note_txt+=" 轮换/状态统计基于已采样的前 100 条。"
    body+=H.section("身份与数据 KMS / SSM",H.table(["指标","数值","指标","数值"],id_rows),H.note(note_txt))
elif id_used and not id_data:
    body+=H.section("身份与数据 KMS / SSM",H.note("KMS/SSM 列表为空，未采样到任何密钥/凭据。"))

body+=H.section("关键风险与发现",*risks)
body+=H.section("处置建议",H.ol(todos))

if not a.products:
    body=H.note("当前过滤后没有任何启用产品可查询，请核对产品范围参数与产品开通状态。")
elif not body:
    body=H.note("当前过滤后没有任何启用产品可查询，请核对产品范围参数与产品开通状态。")

period=f"{sd} ~ {ed}" if DAYS>=7 else f"{s} ~ {e} CST"

if __name__=="__main__":
    emit(a, H.wrap("安全周报巡检",body,period=period,sources=sources or None,unavailable=unav or None))
