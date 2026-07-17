import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,any_of,emit,product_zh,is_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["CSIP","CWP"],name="asset_risk_overview")
requested=set(a.products)
enabled=detect_enabled()
apply_enabled(a,enabled)

LM={"extreme":"critical","critical":"critical","high":"high","middle":"medium","medium":"medium","low":"low","info":"info"}
LZ={"extreme":"严重","critical":"严重","high":"高危","middle":"中危","medium":"中危","low":"低危","info":"提示"}
LW={"extreme":4,"critical":4,"high":3,"middle":2,"medium":2,"low":1,"info":0}
HRP={22:"SSH",23:"Telnet",3389:"RDP",3306:"MySQL",6379:"Redis",27017:"MongoDB",5432:"PostgreSQL",1433:"SQL Server",9200:"ES",2375:"Docker",2379:"etcd",11211:"Memcached",5984:"CouchDB",1521:"Oracle",873:"Rsync"}
ITZ={"CVM":"CVM 云服务器","CDB":"CDB 数据库","CBS":"CBS 云硬盘","COS":"COS 对象存储","CLB":"CLB 负载均衡","ACL":"网络 ACL","SUBNET":"子网","SECURITYGROUP":"安全组","HAVIP":"高可用虚拟 IP","TKECLUSTER":"TKE 集群","APIGATEWAY":"API 网关","POSTGRES":"PostgreSQL","MARIADB":"MariaDB","LISTENER":"CLB 监听器","LOCAL":"本地镜像","MANAGED_CLUSTER":"托管集群","REP":"镜像仓库","LH":"轻量应用服务器","KMS":"密钥管理 KMS","SSL":"SSL 证书","DOMAIN":"域名","NAT":"NAT 网关","DNSPOD":"DNSPod 域名","TKE":"TKE 集群","TDSQL":"TDSQL 数据库","REDIS":"Redis","MEMCACHED":"Memcached","ES":"ES 集群","CKAFKA":"消息队列","VPC":"私有网络","BMS":"裸金属","COSBUCKET":"COS 存储桶","CFW":"云防火墙","WAF":"Web 应用防火墙","TCSS":"容器安全","CSIP":"安全中心","CWP":"主机安全","SCF":"云函数","TCB":"云开发"}
_RAW_BUCKET={"OTHER","UNKNOWN","UNKNOWNED","其他","未知","NA","N/A"}
def itnorm(v):
    if v is None: return "其他"
    s=str(v).strip()
    if not s or s in ("0","1","-"): return "其他"
    if s.upper() in _RAW_BUCKET: return "其他"
    return ITZ.get(s.upper(), ITZ.get(s, "其他"))
def is_image_like(itype,asset):
    return (itype in ("Local","managed_cluster","Rep")) or (isinstance(asset,str) and asset.startswith("sha256:"))

cmds=[]
if has(a,"CWP"):
    cmds.append([PY,T,"cwp","DescribeGeneralStat","--output","json"])
    cmds.append([PY,T,"cwp","DescribeOverviewStatistics","--output","json"])
    cmds.append([PY,T,"cwp","DescribeVulHostCountScanTime","--output","json"])
r=wf.batch(cmds) if cmds else {}

vul=wf.page("csip","DescribeRiskCenterAssetViewVULRiskList","Data",limit=100,workers=3) if has(a,"CSIP") else {}
cfg=wf.page("csip","DescribeRiskCenterAssetViewCFGRiskList","Data",limit=100,workers=3) if has(a,"CSIP") else {}
prt=wf.page("csip","DescribeRiskCenterAssetViewPortRiskList","Data",limit=100,workers=3) if has(a,"CSIP") else {}

def U(d):
    if not isinstance(d,dict): return {}
    return d.get("Response") or d

def call_ok(d):
    return isinstance(d,dict) and "Error" not in d and bool(d)

gs_raw=r.get("cwp.DescribeGeneralStat") if has(a,"CWP") else None
ov_raw=r.get("cwp.DescribeOverviewStatistics") if has(a,"CWP") else None
vs_raw=r.get("cwp.DescribeVulHostCountScanTime") if has(a,"CWP") else None
gs=U(gs_raw) if call_ok(gs_raw) else {}
ov=U(ov_raw) if call_ok(ov_raw) else {}
vs=U(vs_raw) if call_ok(vs_raw) else {}

cwp_ok=has(a,"CWP") and (call_ok(gs_raw) or call_ok(ov_raw) or call_ok(vs_raw))
csip_ok=has(a,"CSIP") and (call_ok(vul) or call_ok(cfg) or call_ok(prt))

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()))]
if has(a,"CWP") and not cwp_ok: unav.append(product_zh("CWP"))
if has(a,"CSIP") and not csip_ok: unav.append(product_zh("CSIP"))
sources=[product_zh(p) for p in ("CWP","CSIP") if has(a,p) and product_zh(p) not in unav]

vul_total=vul.get("TotalCount",0) if call_ok(vul) else 0
cfg_total=cfg.get("TotalCount",0) if call_ok(cfg) else 0
prt_total=prt.get("TotalCount",0) if call_ok(prt) else 0
vul_data=vul.get("Data",[]) if call_ok(vul) else []
cfg_data=cfg.get("Data",[]) if call_ok(cfg) else []
prt_data=prt.get("Data",[]) if call_ok(prt) else []
risk_total=vul_total+cfg_total+prt_total

mach_all=gs.get("MachinesAll",0) or 0
agt_all=gs.get("AgentsAll",0) or 0
agt_on=gs.get("AgentsOnline",0) or 0
agt_off=gs.get("AgentsOffline",0) or 0
agt_uni=gs.get("MachinesUninstalled",0) or 0
agt_pro=gs.get("AgentsPro",0) or 0
agt_basic=gs.get("AgentsBasic",0) or 0
flag_cnt=gs.get("FlagshipMachineCnt",0) or 0
risk_mach=gs.get("RiskMachine",0) or 0
on_rate=(agt_on*100/agt_all) if agt_all else 0
unprotect=mach_all-agt_pro-flag_cnt-agt_basic if mach_all else 0
if unprotect<0: unprotect=agt_uni

def lvl_cnt(items):
    c={"critical":0,"high":0,"medium":0,"low":0,"info":0}
    for x in items:
        lv=LM.get((x.get("Level") or "").lower(),"info")
        c[lv]=c.get(lv,0)+1
    return c

vul_lv=lvl_cnt(vul_data)
cfg_lv=lvl_cnt(cfg_data)
prt_lv=lvl_cnt(prt_data)

def by_inst(items):
    c={}
    for x in items:
        k=itnorm(x.get("InstanceType"))
        c[k]=c.get(k,0)+1
    return c

inst_vul=by_inst(vul_data)
inst_cfg=by_inst(cfg_data)
inst_prt=by_inst(prt_data)
all_inst=set(list(inst_vul)+list(inst_cfg)+list(inst_prt))

asset_idx={}
def add(items,kind):
    for x in items:
        k=x.get("AffectAsset") or x.get("InstanceId") or x.get("InstanceName") or "未知"
        e=asset_idx.setdefault(k,{"asset":k,"name":x.get("InstanceName") or "","itype_raw":x.get("InstanceType") or "","vul":0,"cfg":0,"prt":0,"score":0,"top":"info"})
        if not e["name"]: e["name"]=x.get("InstanceName") or ""
        if not e["itype_raw"]: e["itype_raw"]=x.get("InstanceType") or ""
        e[kind]+=1
        lv=LM.get((x.get("Level") or "").lower(),"info")
        w=LW.get((x.get("Level") or "").lower(),0)
        e["score"]+=w*(4 if kind=="vul" else 2 if kind=="cfg" else 1)
        if LW.get(e["top"],0)<w: e["top"]=lv

add(vul_data,"vul"); add(cfg_data,"cfg"); add(prt_data,"prt")
top_assets=sorted(asset_idx.values(),key=lambda v:(-v["score"],-(v["vul"]+v["cfg"]+v["prt"])))[:20]

vul_name={}
for x in vul_data:
    n=x.get("VULName") or x.get("CVE") or "未知"
    vul_name[n]=vul_name.get(n,0)+1
top_vul=sorted(vul_name.items(),key=lambda kv:-kv[1])[:10]

cfg_name={}
for x in cfg_data:
    n=x.get("CFGName") or x.get("CheckType") or "未知"
    cfg_name[n]=cfg_name.get(n,0)+1
top_cfg=sorted(cfg_name.items(),key=lambda kv:-kv[1])[:10]

port_cnt={}; high_port=[]
for x in prt_data:
    p=x.get("Port")
    if p is None: continue
    port_cnt[p]=port_cnt.get(p,0)+1
top_port=sorted(port_cnt.items(),key=lambda kv:-kv[1])[:10]
hp_total={}
for x in prt_data:
    p=x.get("Port")
    if p in HRP:
        hp_total[p]=hp_total.get(p,0)+1
seen_hp=set()
for x in prt_data:
    p=x.get("Port")
    if p in HRP and p not in seen_hp:
        seen_hp.add(p)
        high_port.append({"port":p,"name":HRP[p],"asset":x.get("AffectAsset") or "-","svc":x.get("Service") or "-","level":(x.get("Level") or "info").lower(),"comp":x.get("Component") or "-","total":hp_total.get(p,0)})

body=""

ov_cards=[("总风险项",(f"{risk_total:,}","c-critical" if risk_total>=100 else "c-high" if risk_total>=20 else "c-info"))]
if has(a,"CSIP") and csip_ok:
    ov_cards.append(("漏洞风险",(f"{vul_total:,}","c-critical" if vul_total>0 else "c-info")))
    ov_cards.append(("配置风险",(f"{cfg_total:,}","c-high" if cfg_total>0 else "c-info")))
    ov_cards.append(("端口暴露",(f"{prt_total:,}","c-high" if prt_total>0 else "c-info")))
if has(a,"CWP") and cwp_ok:
    ov_cards.append(("CWP 受影响主机",(str(risk_mach),"c-high" if risk_mach else "c-info")))
if has(a,"CSIP") and csip_ok:
    ov_cards.append(("风险对象数",(str(len(asset_idx)),"c-medium" if asset_idx else "c-info"),"含主机/镜像/网络对象等"))
body+=H.section("一、风险概览",
    H.cards(ov_cards),
    H.note("CSIP 提供漏洞/配置/端口三类风险（按资产-条目维度去重统计），CWP 提供主机层 Agent 与历史漏洞扫描数据（按主机-条目维度统计）。两者数值口径不同，互不冲突。统计数值以 API TotalCount 为准；明细列表如超 1 万条会自动截断。"),
)

if has(a,"CSIP") and csip_ok:
    body+=H.section("二、风险类型分布",
        H.table(["风险类型","TotalCount","已采明细","严重","高危","中危","低危","提示"],[
            [("漏洞风险","c-critical"),f"{vul_total:,}",len(vul_data),(vul_lv["critical"],"c-critical") if vul_lv["critical"] else 0,(vul_lv["high"],"c-high") if vul_lv["high"] else 0,vul_lv["medium"],vul_lv["low"],vul_lv["info"]],
            [("配置风险","c-high"),f"{cfg_total:,}",len(cfg_data),(cfg_lv["critical"],"c-critical") if cfg_lv["critical"] else 0,(cfg_lv["high"],"c-high") if cfg_lv["high"] else 0,cfg_lv["medium"],cfg_lv["low"],cfg_lv["info"]],
            [("端口暴露","c-medium"),f"{prt_total:,}",len(prt_data),(prt_lv["critical"],"c-critical") if prt_lv["critical"] else 0,(prt_lv["high"],"c-high") if prt_lv["high"] else 0,prt_lv["medium"],prt_lv["low"],prt_lv["info"]],
        ]),
        H.note("各等级数量基于已采明细按等级聚合，云 API 未提供按等级直接返回的合计字段。"),
    )

if has(a,"CWP") and cwp_ok:
    body+=H.section("三、Agent 在线率与防护覆盖（CWP）",
        H.cards([
            ("纳管主机总数",f"{mach_all:,}"),
            ("Agent 在线",(f"{agt_on:,}","c-high")),
            ("Agent 离线",(f"{agt_off:,}","c-medium" if agt_off else "c-info")),
            ("未安装 Agent",(f"{agt_uni:,}","c-critical" if agt_uni else "c-info")),
            ("在线率",(f"{on_rate:.1f}%","c-high" if on_rate>=90 else "c-medium" if on_rate>=70 else "c-critical")),
            ("旗舰版",(f"{flag_cnt:,}","c-info")),
            ("专业版",(f"{agt_pro:,}","c-info")),
            ("基础版",(f"{agt_basic:,}","c-info")),
        ]),
        H.note("CWP 概览统计为自纳管以来累计数据，非时间窗内增量："),
        H.para("木马 ",H.color(str(ov.get("MalwareNum",0) or 0),"high")," / 异地登录 ",H.color(str(ov.get("NonlocalLoginNum",0) or 0),"medium")," / 暴破成功 ",H.color(str(ov.get("BruteAttackSuccessNum",0) or 0),"critical")," / 漏洞 ",H.color(str(ov.get("VulNum",0) or 0),"high")," / 基线 ",H.color(str(ov.get("BaseLineNum",0) or 0),"medium"),"（累计）"),
        H.note(f"最近一次漏洞扫描：{vs.get('ScanTime') or '—'}；扫出漏洞主机 {vs.get('VulHostCount',0) or 0} 台 / 漏洞条目 {vs.get('TotalVulCount',0) or 0}；最近修复时间 {vs.get('LastFixTime') or '—'}。"),
    )

if has(a,"CSIP") and csip_ok and all_inst:
    rows=[]
    for it in sorted(all_inst,key=lambda k:-(inst_vul.get(k,0)+inst_cfg.get(k,0)+inst_prt.get(k,0))):
        rows.append([it,inst_vul.get(it,0),inst_cfg.get(it,0),inst_prt.get(it,0),inst_vul.get(it,0)+inst_cfg.get(it,0)+inst_prt.get(it,0)])
    body+=H.section("四、按资产类型的风险分布（CSIP）",
        H.table(["资产类型","漏洞","配置","端口","合计"],rows),
        H.note("镜像类（本地镜像 / 托管集群 / 镜像仓库）的漏洞由容器镜像扫描产生，并非 CVM 主机实际运行漏洞；网络对象类（安全组 / 子网 / 网络 ACL / 高可用虚拟 IP）的风险通常来自配置审计。"),
    )

if has(a,"CSIP") and csip_ok and top_assets:
    rows=[]
    for it in top_assets:
        raw_it=it["itype_raw"]
        is_img=is_image_like(raw_it,it["asset"])
        nm=(it["name"] or "")[:32]
        if is_img and (not nm or it["asset"].startswith(nm) or nm.startswith("sha256:") or nm==it["asset"][:len(nm)]):
            nm="(容器镜像)"
        elif raw_it in ("SECURITYGROUP","SUBNET","ACL","HAVIP","APIGATEWAY","LISTENER") and (not nm or nm==it["asset"]):
            nm="(网络对象)"
        rows.append([it["asset"][:40],nm or "-",itnorm(raw_it),(LZ.get(it["top"],"-"),LM.get(it["top"],"info")),(it["vul"],"c-critical") if it["vul"] else 0,(it["cfg"],"c-high") if it["cfg"] else 0,(it["prt"],"c-medium") if it["prt"] else 0,(str(it["score"]),"c-critical" if it["score"]>=20 else "c-high" if it["score"]>=10 else "c-medium")])
    body+=H.section(f"五、风险资产 TOP {len(top_assets)}（按加权评分）",
        H.table(["资产 IP/ID","实例名","类型","最高等级","漏洞","配置","端口","风险评分"],rows),
        H.note("评分=Σ(等级权重 × 类型权重)，等级权重 严重=4/高=3/中=2/低=1，类型权重 漏洞×4/配置×2/端口×1。仅基于 CSIP 已采明细统计。镜像类资产无独立实例名时显示为「(容器镜像)」。"),
    )

if has(a,"CSIP") and csip_ok and top_vul:
    rows=[[(n[:60]+"...") if len(n)>60 else n,c] for n,c in top_vul]
    body+=H.section("六、Top 漏洞名称分布",H.table(["漏洞名称","出现次数"],rows),H.note(f"基于 CSIP 已采 {len(vul_data)} / TotalCount {vul_total} 条聚合。"))

if has(a,"CSIP") and csip_ok and top_cfg:
    rows=[[(n[:60]+"...") if len(n)>60 else n,c] for n,c in top_cfg]
    body+=H.section("七、Top 配置风险检查项",H.table(["检查项","出现次数"],rows),H.note(f"基于 CSIP 已采 {len(cfg_data)} / TotalCount {cfg_total} 条聚合。"))

if has(a,"CSIP") and csip_ok and top_port:
    rows=[]
    for p,c in top_port:
        risk=HRP.get(p,"-")
        rows.append([p,c,(risk,"c-critical") if risk!="-" else "-"])
    body+=H.section("八、Top 暴露端口分布",H.table(["端口","出现次数","高危识别"],rows))

if has(a,"CSIP") and csip_ok and high_port:
    rows=[[h["port"],(h["name"],"c-critical"),h["asset"],h["svc"],(h["comp"] or "-")[:30],(LZ.get(h["level"],"-"),LM.get(h["level"],"info")),h["total"]] for h in high_port[:15]]
    body+=H.section("九、高危端口暴露明细",
        H.table(["端口","风险","资产示例","服务","组件","等级","同端口暴露资产数"],rows),
        H.note("数据库/管理类端口暴露至公网风险极高，建议立即用安全组/CFW 限制来源 IP。每个端口仅展示 1 条样例资产，「同端口暴露资产数」列即该端口在公网共暴露的资产数；请结合 Top 端口表完整核查。"),
    )

findings=[]
if has(a,"CSIP") and csip_ok and vul_lv["critical"]>0:
    findings.append(H.finding_crit(f"严重等级漏洞 {vul_lv['critical']} 条暂未处置",H.para("CSIP 漏洞列表中严重等级条目通常具备远程利用条件，建议结合 Top 漏洞清单逐条核实并按 CVE 推动修复。")))
if has(a,"CSIP") and csip_ok and cfg_lv["critical"]+cfg_lv["high"]>0:
    findings.append(H.finding(f"高危配置风险 {cfg_lv['critical']+cfg_lv['high']} 条",H.para("配置类风险（如 Docker 2375 暴露、安全组 0.0.0.0/0、SSH 弱配置等）多为一次性可修复项，处置成本低、收益高。"),crit=True))
if has(a,"CSIP") and csip_ok and high_port:
    findings.append(H.finding_crit(f"检测到 {len(high_port)} 类高危端口（{','.join(str(h['port']) for h in high_port[:5])}）暴露至公网",H.para("数据库 / 容器管理 / 远程登录端口直接暴露公网将显著放大资产攻击面，应优先白名单收敛或下线。")))
if has(a,"CWP") and cwp_ok and (agt_uni>0 or on_rate<80):
    findings.append(H.finding(f"CWP 防护覆盖待补齐：未安装 {agt_uni} 台、在线率 {on_rate:.1f}%",H.para(f"未安装 Agent 的主机不在 CWP 检测覆盖内，应统一部署。Agent 离线 {agt_off} 台需排查网络/进程退出。"),crit=agt_uni>0))
if has(a,"CWP") and cwp_ok and risk_mach>0:
    findings.append(H.finding(f"CWP 标识 {risk_mach} 台风险主机",H.para("当前存在未处置告警/漏洞/基线问题的主机数。建议结合每日告警与漏洞清单逐台处置。")))
if not findings:
    findings.append(H.finding("整体资产风险态势平稳",H.para("当前未识别到明显严重风险点，建议保持周期巡检。")))
body+=H.section("十、风险洞察与处置建议",*findings)

if not a.products:
    body=H.note("当前 --include/--exclude 过滤后没有任何启用产品可查询。请检查参数或 check_products_enabled 输出。")
elif not body:
    body=H.note("当前 --include/--exclude 过滤后没有任何启用产品可查询。请检查参数或 check_products_enabled 输出。")

scope_zh=", ".join(p for p in ["CSIP","CWP"] if p in requested) or "(无)"
period=f"查询范围：{scope_zh}"

if __name__=="__main__":
    emit(a, H.wrap("资产风险概览",body,sources=sources or None,unavailable=unav or None,period=period))
