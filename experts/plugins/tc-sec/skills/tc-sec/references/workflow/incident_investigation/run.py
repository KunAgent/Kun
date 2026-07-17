import sys,os,json,glob,re
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,any_of,emit,product_zh,is_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["CWP","WAF","CFW","BH"],name="incident_investigation")

enabled=detect_enabled()
apply_enabled(a,enabled)

DAYS=a.days or 7
TIP=a.target_ip
TUUID=a.target_uuid
TQUUID=a.target_quuid
DETAIL_MAX=a.detail_max or 50
start,end=wf.time_range(DAYS*24,"h")

def F(k,v): return json.dumps([{"Key":k,"Values":[v]}],ensure_ascii=False)

IPV4=re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$")
IPV6=re.compile(r"^[0-9a-fA-F:]+$")
def is_ip_like(s):
    s=(s or "").strip()
    if not s: return False
    if IPV4.match(s): return True
    if ":" in s and IPV6.match(s.split("/")[0]): return True
    return False
def short_id(s,n=8):
    s=str(s or "")
    return (s[:n]+"…") if len(s)>n+1 else s
def cleanloc(s):
    parts=[p.strip() for p in (s or "").replace("：",":").split("::")]
    parts=[p for p in parts if p]
    return " ".join(parts) or "-"

cmds=[]
if has(a,"WAF"): cmds.append([PY,T,"waf","DescribeAttackOverview","--FromTime",start,"--ToTime",end,"--output","json"])
if has(a,"BH"): cmds.append([PY,T,"bh","DescribeOperationEvent","--Limit","100","--Offset","0","--output","json"])
if TIP and has(a,"CFW"):
    cmds.append([PY,T,"cfw","DescribeBlockByIpTimesList","--StartTime",start,"--EndTime",end,"--Ip",TIP,"--output","json"])
res=wf.batch(cmds,workers=4) if cmds else {}

def _ft(k,v): return [{"Key":k,"Values":[v]}] if v else None

if has(a,"CWP"):
    _bf_ft=_ft("SrcIp",TIP) or (_ft("Uuid",TUUID))
    _ae_ft=_ft("SrcIP",TIP) or (_ft("Uuids",TUUID))
    bf=wf.page("cwp","DescribeBruteAttackList","BruteAttackList",filters=_bf_ft,limit=100,workers=3)
    ae=wf.page("cwp","DescribeAttackEvents","List",filters=_ae_ft,limit=100,workers=3)
    mw=wf.page("cwp","DescribeMalWareList","MalWareList",filters=_ft("IpOrAlias",TIP),limit=100,workers=3)
    rs=wf.page("cwp","DescribeReverseShellEvents","List",filters=_ft("Keywords",TIP),limit=100,workers=3)
    rd=wf.page("cwp","DescribeRiskDnsEventList","List",filters=_ft("IP",TIP),limit=100,workers=3)
    be=wf.page("cwp","DescribeBashEvents","List",limit=100,workers=3)
else:
    bf=ae=mw=rs=rd=be={}

if TQUUID and has(a,"CWP"):
    cmds2=[
        [PY,T,"cwp","DescribeAssetProcessInfoList","--Quuid",TQUUID,"--Limit","200","--Offset","0","--output","json"],
        [PY,T,"cwp","DescribeAssetPortInfoList","--Quuid",TQUUID,"--Limit","200","--Offset","0","--output","json"],
        [PY,T,"cwp","DescribeAssetUserList","--Quuid",TQUUID,"--Limit","200","--Offset","0","--output","json"],
    ]
    res.update(wf.batch(cmds2,workers=3))

def R(k):
    d=res.get(k)
    if not isinstance(d,dict): return {}
    if "Error" in d: return {}
    return d.get("Response") or d

def _ok_page(d): return isinstance(d,dict) and "Error" not in d and bool(d)

def ok(pref):
    if pref=="cwp.": return has(a,"CWP") and any(_ok_page(d) for d in [bf,ae,mw,rs,rd,be])
    ks=[k for k in res if k.startswith(pref)]
    if not ks: return False
    return any(not is_unavailable(res.get(k)) for k in ks)

def lv(n): return "critical" if n>=50 else "high" if n>=10 else "medium" if n>=3 else "low" if n>0 else "info"

ov=R("waf.DescribeAttackOverview")
bh=R("bh.DescribeOperationEvent")

bf=bf if _ok_page(bf) else {}
ae=ae if _ok_page(ae) else {}
mw=mw if _ok_page(mw) else {}
rs=rs if _ok_page(rs) else {}
rd=rd if _ok_page(rd) else {}
be=be if _ok_page(be) else {}

bf_l=bf.get("BruteAttackList") or []
ae_l=ae.get("List") or []
mw_l=mw.get("MalWareList") or []
rs_l=rs.get("List") or []
rd_l=rd.get("List") or []
be_l=be.get("List") or []
bh_l=bh.get("OperationEventSet") or []

bf_t=bf.get("TotalCount",0) or 0
ae_t=ae.get("TotalCount",0) or 0
mw_t=mw.get("TotalCount",0) or 0
rs_t=rs.get("TotalCount",0) or 0
rd_t=rd.get("TotalCount",0) or 0
be_t=be.get("TotalCount",0) or 0
bh_t=bh.get("TotalCount",0) or 0

waf_atk=ov.get("AttackCount",0) or 0
waf_acc=ov.get("AccessCount",0) or 0
waf_cc=ov.get("CCCount",0) or 0

cwp_ok=has(a,"CWP") and ok("cwp.")
waf_ok=has(a,"WAF") and ok("waf.") and (waf_atk or waf_acc or waf_cc)
bh_ok=has(a,"BH") and ok("bh.") and bh_l
cfw_ok=has(a,"CFW") and ok("cfw.")

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()))]
sources=[]
for p,active in [("CWP",cwp_ok),("WAF",waf_ok),("CFW",cfw_ok),("BH",bh_ok)]:
    if not has(a,p): continue
    if active: sources.append(product_zh(p))
    else:
        z=product_zh(p)
        if z not in unav: unav.append(z)

body=""

clue=[]
if TIP: clue.append(f"IP={TIP}")
if TUUID: clue.append(f"主机告警实例={TUUID}")
if TQUUID: clue.append(f"主机实例={TQUUID}")
clue_s=" ".join(clue) if clue else "（无）"
mode="全局背景调查（未提供线索）" if not (TIP or TUUID or TQUUID) else f"针对性追溯（{clue_s}）"
_filter_note=f"CWP 各类事件已按 {clue_s} 过滤，下方 TotalCount 为过滤后结果，非账号全量。" if (TIP or TUUID) else ""

bf_succ=[x for x in bf_l if (x.get("Status") or "").upper()=="SUCCESS" or x.get("EventType")==300] if cwp_ok else []
ae_succ=[x for x in ae_l if x.get("Type")==1] if cwp_ok else []
rs_total=rs_t if cwp_ok else 0
mw_pending=[x for x in mw_l if x.get("Status") in (4,"4")] if cwp_ok else []

severity="低风险"; sev_lv="info"
if bf_succ or ae_succ or rs_total>0:
    severity="紧急"; sev_lv="critical"
elif mw_t>0 or be_t>10 or rd_t>10:
    severity="高风险"; sev_lv="high"
elif bf_t>0 or ae_t>0:
    severity="中风险"; sev_lv="medium"

ctx_cards=[("调查模式",mode,"info"),("综合风险",severity,sev_lv)]
if cwp_ok:
    ctx_cards+=[
        ("CWP 暴破事件",f"{bf_t:,}",lv(bf_t)),
        ("CWP 网络攻击",f"{ae_t:,}",lv(ae_t)),
        ("CWP 木马事件",f"{mw_t:,}",lv(mw_t)),
        ("CWP 反弹 Shell",f"{rs_t:,}","critical" if rs_t else "info"),
        ("CWP 高危命令",f"{be_t:,}",lv(be_t)),
        ("CWP 恶意请求",f"{rd_t:,}",lv(rd_t)),
    ]
if waf_ok: ctx_cards.append(("WAF 拦截 / 总请求 / CC",f"{waf_atk:,} / {waf_acc:,} / {waf_cc:,}",lv(waf_atk)))
if bh_ok: ctx_cards.append(("BH 操作事件",f"{bh_t:,}",lv(bh_t)))
_ctx_blocks=[H.cards(ctx_cards),H.para(H.html(f"调查线索：<b>{clue_s}</b> &nbsp;|&nbsp; 时间范围：{start} ~ {end} CST"))]
if _filter_note: _ctx_blocks.append(H.note(_filter_note))
body+=H.section("调查上下文",*_ctx_blocks)

if not (TIP or TUUID or TQUUID):
    body+=H.note("当前无具体调查目标，仅展示全局事件背景。如需溯源单一 IP/主机，可指定来源 IP（IP 维度关联）、主机告警实例（主机告警过滤）或主机实例（资产快照：进程/端口/用户）后重跑。")

def host_fb(x):
    return x.get("HostName") or x.get("MachineName") or short_id(x.get("Quuid")) or x.get("PrivateIP") or x.get("WanIP") or "-"

def _scope(fetched, total, label=""):
    if fetched>=total: return f"全量 {total} 条{label}"
    return f"已采 {fetched} / 共 {total} 条{label}，实际数量以共计值为准"

if cwp_ok:
    crit_blocks=[]
    if bf_succ:
        rows=[[(x.get("SrcIp") or "-"),(x.get("MachineIp") or "-"),(x.get("UserName") or "-"),(x.get("Protocol") or "-"),cleanloc(x.get("Location")),(x.get("ModifyTime") or x.get("CreateTime") or "-")] for x in bf_succ[:DETAIL_MAX]]
        crit_blocks.append(H.para(H.color(f"暴破成功 {len(bf_succ)} 条","critical"),f"（{_scope(len(bf_l),bf_t,'暴破事件')}）"))
        crit_blocks.append(H.table(["来源 IP","主机 IP","用户名","协议","归属","时间"],rows))
    if ae_succ:
        rows=[[(x.get("SrcIP") or "-"),(x.get("DstPort") or "-"),(x.get("VulName") or "-"),host_fb(x),cleanloc(x.get("Location")),(x.get("MergeTime") or "-")] for x in ae_succ[:DETAIL_MAX]]
        crit_blocks.append(H.para(H.color(f"Web 漏洞攻击成功 {len(ae_succ)} 条","critical"),f"（{_scope(len(ae_l),ae_t,'网络攻击事件')}）"))
        crit_blocks.append(H.table(["来源 IP","目标端口","漏洞","主机","归属","时间"],rows))
    if rs_l:
        seen=set(); dedup=[]
        for x in rs_l:
            k=(x.get("Hostip") or "",x.get("DstIp") or "",x.get("ProcessName") or "",x.get("UserName") or "",(x.get("CmdLine") or "")[:80])
            if k in seen: continue
            seen.add(k); dedup.append(x)
        rows=[[(x.get("Hostip") or "-"),(x.get("DstIp") or "-"),(x.get("ProcessName") or "-"),(x.get("UserName") or "-"),((x.get("CmdLine") or "")[:80] or "-"),(x.get("CreateTime") or "-")] for x in dedup[:DETAIL_MAX]]
        crit_blocks.append(H.para(H.color(f"反弹 Shell {rs_t} 条","critical"),f"（已采 {len(rs_l)} 条，去重展示 {len(dedup)} / 共 {rs_t} 条）"))
        crit_blocks.append(H.table(["主机 IP","目标 IP","进程","用户","命令","时间"],rows))
    if crit_blocks:
        body+=H.finding_crit("严重发现：已确认入侵迹象",*crit_blocks)

ip_agg={}
def add_ip(ip,key,loc=""):
    if not ip: return
    e=ip_agg.setdefault(ip,{"ip":ip,"bf":0,"ae":0,"rs":0,"rd":0,"loc":loc})
    e[key]+=1
    if loc and not e["loc"]: e["loc"]=loc
if cwp_ok:
    for x in bf_l:
        ip=x.get("SrcIp") or ""
        if is_ip_like(ip): add_ip(ip,"bf",x.get("Location") or "")
    for x in ae_l:
        ip=x.get("SrcIP") or ""
        if is_ip_like(ip): add_ip(ip,"ae",x.get("Location") or "")
    for x in rs_l:
        ip=x.get("DstIp") or ""
        if is_ip_like(ip): add_ip(ip,"rs","")
    for x in rd_l:
        s=x.get("Domain") or ""
        if is_ip_like(s): add_ip(s,"rd","")
top_ip=sorted([v for v in ip_agg.values() if v["ip"]],key=lambda v:-(v["bf"]+v["ae"]+v["rs"]+v["rd"]))[:15]
if top_ip:
    rows=[]
    for v in top_ip:
        s=v["bf"]+v["ae"]+v["rs"]+v["rd"]
        rows.append([v["ip"],v.get("loc") or "-",v["bf"] or "-",v["ae"] or "-",v["rs"] or "-",v["rd"] or "-",(str(s),lv(s))])
    _ip_full=len(bf_l)>=bf_t and len(ae_l)>=ae_t and len(rs_l)>=rs_t and len(rd_l)>=rd_t
    _ip_title=f"Top 关联攻击源（前 {len(top_ip)}）" if _ip_full else f"已采样本 Top 关联攻击源（前 {len(top_ip)}，非全量排序）"
    _ip_note=f"暴破 {len(bf_l)}/{bf_t}、网络攻击 {len(ae_l)}/{ae_t}、反弹 Shell {len(rs_l)}/{rs_t}、恶意请求 {len(rd_l)}/{rd_t}。" + ("" if _ip_full else "已采量未覆盖全量，IP 排名仅供参考，完整排序需全量导出。")
    body+=H.section(_ip_title,H.table(["来源 IP","归属","暴破","Web 攻击","反弹 Shell","恶意请求","合计"],rows),H.note(_ip_note),)

host_agg={}
def add_h(uuid,name,ip,key):
    k=uuid or name or ip
    if not k: return
    e=host_agg.setdefault(k,{"k":k,"name":name or "-","ip":ip or "-","bf":0,"ae":0,"mw":0,"rs":0,"be":0,"is_id":bool(uuid and not name)})
    e[key]+=1
if cwp_ok:
    for x in bf_l: add_h(x.get("Uuid"),x.get("MachineName"),x.get("MachineIp"),"bf")
    for x in ae_l: add_h(x.get("Uuid"),x.get("HostName"),x.get("WanIP") or x.get("PrivateIP"),"ae")
    for x in mw_l: add_h(x.get("Uuid"),x.get("Alias"),x.get("HostIp"),"mw")
    for x in rs_l: add_h(x.get("Uuid"),x.get("MachineName"),x.get("Hostip"),"rs")
    for x in be_l: add_h(x.get("Uuid"),x.get("HostName"),x.get("Hostip"),"be")
top_host=sorted(host_agg.values(),key=lambda v:-(v["bf"]+v["ae"]+v["mw"]+v["rs"]+v["be"]))[:10]
if top_host:
    rows=[]
    for v in top_host:
        s=v["bf"]+v["ae"]+v["mw"]+v["rs"]+v["be"]
        nm=v["name"]
        if nm=="-" and v.get("is_id"): nm=short_id(v["k"])
        elif len(nm)>32 and IPV4.match(nm) is None: nm=short_id(nm,16)
        rows.append([nm,v["ip"],v["bf"] or "-",v["ae"] or "-",v["mw"] or "-",v["rs"] or "-",v["be"] or "-",(str(s),lv(s))])
    _host_full=len(bf_l)>=bf_t and len(ae_l)>=ae_t and len(mw_l)>=mw_t and len(rs_l)>=rs_t and len(be_l)>=be_t
    _host_title=f"受影响主机 Top {len(top_host)}" if _host_full else f"已采样本受影响主机 Top {len(top_host)}（非全量排序）"
    body+=H.section(_host_title,
        H.table(["主机名 / 标识","IP","暴破","Web 攻击","木马","反弹 Shell","高危命令","合计"],rows),
        H.note("当主机名为空时以主机标识缩写代替；建议在 CWP 控制台核对主机名以提升可读性。" + ("" if _host_full else "各事件类型均未采集全量，排名仅供参考。")),
    )

tl=[]
def add_tl(t,typ,sm):
    if t: tl.append({"t":t,"type":typ,"sum":sm})
if cwp_ok:
    for x in bf_l: add_tl(x.get("CreateTime"),"暴力破解",f"来源={x.get('SrcIp','')} → {x.get('MachineIp','')} 用户={x.get('UserName','')} 状态={x.get('Status','')}")
    for x in ae_l: add_tl(x.get("MergeTime"),"网络攻击",f"来源={x.get('SrcIP','')} → {host_fb(x)}:{x.get('DstPort','')} 漏洞={x.get('VulName','')} 是否成功={('成功' if x.get('Type')==1 else '尝试')}")
    for x in mw_l: add_tl(x.get("CreateTime"),"木马",f"主机={x.get('HostIp','')} 路径={(x.get('FilePath','') or '')[:60]} 病毒={x.get('VirusName','')}")
    for x in rs_l: add_tl(x.get("CreateTime"),"反弹Shell",f"{x.get('Hostip','')} → {x.get('DstIp','')} 进程={x.get('ProcessName','')} 用户={x.get('UserName','')}")
    for x in rd_l: add_tl(x.get("LastTime") or x.get("FirstTime"),"恶意请求",f"主机={x.get('HostIp','')} 域名={x.get('Domain','')} 进程={x.get('ProcessName','')}")
    for x in be_l: add_tl(x.get("CreateTime"),"高危命令",f"主机={x.get('Hostip','')} 用户={x.get('User','')} 命令={(x.get('BashCmd') or x.get('Exe') or '')[:80]} 规则={x.get('RuleName','')}")
BH_RES={0:"成功",1:"失败"}
if bh_ok:
    for x in bh_l: add_tl(x.get("Time"),"BH 操作",f"用户={x.get('UserName','')}({x.get('RealName','')}) 来源={x.get('SourceIp','')} 操作={x.get('Operation','')} 结果={BH_RES.get(x.get('Result'),x.get('Result',''))}")
tl.sort(key=lambda v:v["t"],reverse=True)
if tl:
    sev_map={"反弹Shell":"critical","木马":"high","网络攻击":"high","高危命令":"high","BH 操作":"high","暴力破解":"medium","恶意请求":"medium"}
    rows=[[v["t"],(v["type"],sev_map.get(v["type"],"info")),v["sum"]] for v in tl[:80]]
    _tl_all=len(bf_l)>=bf_t and len(ae_l)>=ae_t and len(mw_l)>=mw_t and len(rs_l)>=rs_t and len(rd_l)>=rd_t and len(be_l)>=be_t
    _tl_note="时间线由已采事件合并排序；" + ("已覆盖全量数据。" if _tl_all else "未采集全量，时间线仅供攻击链推断，总量以各章节给出的 TotalCount 为准。") + "堡垒机操作类按管理员行为统一标记为高危，便于审计。"
    body+=H.section(f"事件时间线（按时间倒序，前 {len(rows)} / 合并 {len(tl)}）",
        H.table(["时间","类型","摘要"],rows),
        H.note(_tl_note),
    )

if cwp_ok and mw_l:
    rows=[]
    for x in mw_l[:DETAIL_MAX]:
        st=x.get("Status",0)
        st_s={4:"待处理",5:"信任",6:"已隔离",10:"隔离中",11:"恢复隔离中",14:"已处理"}.get(st,str(st))
        rows.append([x.get("HostIp") or "-",(x.get("FilePath") or "")[:60] or "-",x.get("VirusName") or "-",(x.get("MD5") or "-").lower(),(st_s,"critical" if st in (4,) else "info"),x.get("CreateTime") or "-"])
    body+=H.section(f"木马 / 恶意文件（前 {len(rows)} / 总数 {mw_t}）",H.table(["主机 IP","路径","病毒名","MD5","状态","时间"],rows))

if cwp_ok and be_l:
    rows=[[x.get("Hostip") or "-",x.get("User") or "-",x.get("RuleName") or "-",((x.get("BashCmd") or x.get("Exe") or "")[:120] or "-"),x.get("CreateTime") or "-"] for x in be_l[:30]]
    body+=H.section(f"高危命令（前 {len(rows)} / 总数 {be_t}）",H.table(["主机 IP","用户","规则","命令","时间"],rows))

if cwp_ok and rd_l:
    rows=[[x.get("HostIp") or "-",x.get("Domain") or "-",x.get("ProcessName") or "-",(x.get("AccessCount") or "-"),x.get("LastTime") or x.get("FirstTime") or "-"] for x in rd_l[:30]]
    body+=H.section(f"恶意请求 / DNS（前 {len(rows)} / 总数 {rd_t}）",H.table(["主机 IP","域名 / URL","进程","次数","最近时间"],rows))

if TQUUID and cwp_ok:
    pi=R("cwp.DescribeAssetProcessInfoList")
    po=R("cwp.DescribeAssetPortInfoList")
    us=R("cwp.DescribeAssetUserList")
    pi_l=pi.get("Process") or []
    po_l=po.get("Ports") or []
    us_l=us.get("Users") or []
    blk=[]
    if pi_l:
        rows=[[x.get("Name") or "-",x.get("User") or "-",x.get("Pid") or "-",(x.get("Path") or "")[:80] or "-",x.get("StartTime") or "-"] for x in pi_l[:30]]
        blk.append(H.para(H.color(f"运行进程 {pi.get('Total',len(pi_l))}","high")))
        blk.append(H.table(["进程名","用户","PID","路径","启动时间"],rows))
    if po_l:
        rows=[[x.get("Port") or "-",x.get("Proto") or "-",x.get("ProcessName") or "-",x.get("Pid") or "-",x.get("User") or "-"] for x in po_l[:30]]
        blk.append(H.para(H.color(f"开放端口 {po.get('Total',len(po_l))}","high")))
        blk.append(H.table(["端口","协议","监听进程","PID","用户"],rows))
    if us_l:
        rows=[[x.get("Name") or "-",x.get("Uid") or "-",x.get("LoginType") or "-",x.get("LastLoginTime") or "-",("Root","critical") if x.get("IsRoot")==1 else "-"] for x in us_l[:30]]
        blk.append(H.para(H.color(f"系统用户 {us.get('Total',len(us_l))}","high")))
        blk.append(H.table(["用户名","Uid","登录方式","最近登录","权限"],rows))
    if blk: body+=H.section(f"主机资产快照（{short_id(TQUUID,12)}）",*blk)

if bh_ok:
    rows=[[x.get("Time") or "-",x.get("UserName") or "-",x.get("RealName") or "-",x.get("SourceIp") or "-",x.get("Operation") or "-",(BH_RES.get(x.get("Result"),x.get("Result")) or "-")] for x in bh_l[:30]]
    body+=H.section(f"堡垒机操作事件（前 {len(rows)} / 总数 {bh_t}）",
        H.table(["时间","用户","真实姓名","来源 IP","操作","结果"],rows),
        H.note("BH 操作事件为全局列表，需结合调查目标手工关联；管理类操作建议人工复核审计合规性。"),
    )

iocs=[]
ips=set()
for v in top_ip[:10]:
    if is_ip_like(v["ip"]): ips.add(v["ip"])
md5s={(x.get("MD5") or "").lower() for x in mw_l if x.get("MD5")} if cwp_ok else set()
md5s.discard("")
raw_doms={(x.get("Url") or x.get("Domain")) for x in rd_l if (x.get("Url") or x.get("Domain"))} if cwp_ok else set()
doms=set()
for d in raw_doms:
    if is_ip_like(d): ips.add(d)
    else: doms.add(d)
if ips: iocs.append(("可疑 IP","、".join(sorted(ips)[:15])))
if md5s: iocs.append(("木马 MD5","、".join(sorted(list(md5s))[:15])))
if doms: iocs.append(("恶意域名","、".join(sorted(list(doms))[:15])))
if iocs:
    body+=H.section("IOC 指标汇总",H.table(["类型","值"],[[k,v] for k,v in iocs]))

advice=[]
if cwp_ok and rs_l: advice.append(("发现反弹 Shell：立即隔离主机、抓取进程树、保留取证镜像","critical"))
if cwp_ok and bf_succ: advice.append(("暴破成功：重置受影响账号口令、改用密钥登录、限制 SSH/RDP 来源","critical"))
if cwp_ok and ae_succ: advice.append(("Web 漏洞攻击成功：下线/修补受影响 Web 服务、检查 webshell 落点","critical"))
if cwp_ok and mw_pending: advice.append(("存在待处理木马：触发 CWP 隔离/清除并核查同源 MD5 是否扩散","high"))
if top_ip:
    bl_targets=[]
    if cfw_ok: bl_targets.append("CFW")
    if waf_ok: bl_targets.append("WAF")
    if bl_targets:
        advice.append((f"将首页样本高频源 IP（如 {top_ip[0]['ip']}）加入 {'/'.join(bl_targets)} 黑名单","high"))
    else:
        advice.append((f"将首页样本高频源 IP（如 {top_ip[0]['ip']}）加入云服务器安全组 / 主机层 iptables 黑名单（CFW/WAF 未开通）","high"))
if cwp_ok and be_t>20: advice.append(("高危命令量较大：复核 Bash 审计与堡垒机操作合规性","medium"))
if not (TIP or TUUID or TQUUID): advice.append(("当前为全局背景；建议结合具体 IP/主机 UUID 重跑工作流缩小范围","info"))
if unav: advice.append((f"未开通：{'、'.join(unav)}；建议评估是否需要开通以补全防护链","info"))
if not advice: advice.append(("当前未发现明确入侵证据，保持监控与基线巡检","info"))
body+=H.section("处置建议",H.ul([(t,l) for t,l in advice]))

if not a.products:
    body=H.note("当前产品筛选后没有任何启用产品可查询，请检查参数。")
elif not body:
    body=H.note("当前产品筛选后没有任何启用产品可查询，请检查参数。")

period=f"{start} ~ {end} CST"
if __name__=="__main__":
    emit(a, H.wrap("安全事件调查",body,period=period,sources=sources or None,unavailable=unav or None))
