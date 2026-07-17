import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,any_of,emit,product_zh,top_n,is_unavailable,all_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["WAF","CFW","CWP"],name="attack_analysis")
enabled=detect_enabled()
apply_enabled(a,enabled)

H_HOURS=a.hours or 24
start,end=wf.time_range(H_HOURS,"h")

def jf(d): return json.dumps(d,ensure_ascii=False)

bf_ft=[{"Name":"ModifyBeginTime","Values":[start]},{"Name":"ModifyEndTime","Values":[end]}]
bf_ft_s=bf_ft+[{"Name":"Status","Values":["SUCCESS"]}]
ae_ft=[{"Name":"AttackTimeBegin","Values":[start]},{"Name":"AttackTimeEnd","Values":[end]}]
ae_ft_s=ae_ft+[{"Name":"Type","Values":["1"]}]

cmds=[]
keys=[]
def _add(k,c): keys.append(k); cmds.append(c)
if has(a,"WAF"):
    _add("waf_ov",[PY,T,"waf","DescribeAttackOverview","--FromTime",start,"--ToTime",end,"--output","json"])
    _add("waf_at",[PY,T,"waf","DescribeAttackType","--FromTime",start,"--ToTime",end,"--output","json"])
    _add("waf_td",[PY,T,"waf","DescribeTopAttackDomain","--FromTime",start,"--ToTime",end,"--Count",str(top_n(a,10)),"--output","json"])
    _add("waf_pv",[PY,T,"waf","DescribePeakValue","--FromTime",start,"--ToTime",end,"--output","json"])
if has(a,"CFW"):
    _add("cfw_ip",[PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","ip","--Top",str(top_n(a,10)),"--output","json"])
    _add("cfw_pt",[PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","port","--Top",str(top_n(a,10)),"--output","json"])
    _add("cfw_ad",[PY,T,"cfw","DescribeBlockStaticList","--StartTime",start,"--EndTime",end,"--QueryType","address","--Top",str(top_n(a,10)),"--output","json"])
res=wf.pmap(lambda kc:(kc[0],wf.exec(kc[1])),list(zip(keys,cmds))) if cmds else {}

if has(a,"CWP"):
    bf=wf.page("cwp","DescribeBruteAttackList","BruteAttackList",filters=bf_ft,limit=100,workers=3)
    bf_s=wf.page("cwp","DescribeBruteAttackList","BruteAttackList",filters=bf_ft_s,limit=100,workers=3)
    ae=wf.page("cwp","DescribeAttackEvents","List",filters=ae_ft,limit=100,workers=3)
    ae_s=wf.page("cwp","DescribeAttackEvents","List",filters=ae_ft_s,limit=100,workers=3)
else:
    bf=bf_s=ae=ae_s={}

def R(k):
    d=res.get(k)
    if not isinstance(d,dict) or "Error" in d or not d: return None
    return d.get("Response") or d

LV=lambda n: "critical" if n>=100 else "high" if n>=20 else "medium" if n>=5 else "low" if n>0 else "info"

def cleanloc(s):
    parts=[p.strip() for p in (s or "").replace("：",":").split("::")]
    parts=[p for p in parts if p]
    return " ".join(parts) or "-"

ov=R("waf_ov") or {}
at=R("waf_at") or {}
td=R("waf_td") or {}
pv=R("waf_pv") or {}
ip_=R("cfw_ip") or {}
pt_=R("cfw_pt") or {}
ad_=R("cfw_ad") or {}

def _ok_page(d): return isinstance(d,dict) and "Error" not in d and bool(d)
bf=bf if _ok_page(bf) else {}
bf_s=bf_s if _ok_page(bf_s) else {}
ae=ae if _ok_page(ae) else {}
ae_s=ae_s if _ok_page(ae_s) else {}

waf_keys=["waf_ov","waf_at","waf_td","waf_pv"]
cfw_keys=["cfw_ip","cfw_pt","cfw_ad"]
waf_call_ok=has(a,"WAF") and any(not is_unavailable(res.get(k)) for k in waf_keys)
cfw_call_ok=has(a,"CFW") and any(not is_unavailable(res.get(k)) for k in cfw_keys)
cwp_call_ok=has(a,"CWP") and any(_ok_page(d) for d in [bf,bf_s,ae,ae_s])
waf_zero=waf_call_ok and (int(ov.get("AccessCount",0) or 0)+int(ov.get("AttackCount",0) or 0)+int(ov.get("CCCount",0) or 0)+int(ov.get("BotCount",0) or 0)==0) and not (td.get("Web") or td.get("CC") or at.get("Piechart"))
waf_ok=waf_call_ok and not waf_zero

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()))]
if has(a,"WAF") and not waf_ok and product_zh("WAF") not in unav: unav.append(product_zh("WAF"))
if has(a,"CFW") and not cfw_call_ok and product_zh("CFW") not in unav: unav.append(product_zh("CFW"))
if has(a,"CWP") and not cwp_call_ok and product_zh("CWP") not in unav: unav.append(product_zh("CWP"))
sources=[]
if waf_ok: sources.append(product_zh("WAF"))
if cfw_call_ok: sources.append(product_zh("CFW"))
if cwp_call_ok: sources.append(product_zh("CWP"))

waf_attack=int(ov.get("AttackCount",0) or 0) if waf_ok else 0
waf_access=int(ov.get("AccessCount",0) or 0) if waf_ok else 0
waf_cc=int(ov.get("CCCount",0) or 0) if waf_ok else 0
waf_bot=int(ov.get("BotCount",0) or 0) if waf_ok else 0
peak_attack=int(pv.get("Attack",0) or 0) if waf_ok else 0
peak_cc=int(pv.get("Cc",0) or 0) if waf_ok else 0
peak_qps=int(pv.get("Access",0) or 0) if waf_ok else 0

bf_list=(bf.get("BruteAttackList") or []) if cwp_call_ok else []
bf_total=int(bf.get("TotalCount",0) or 0) if cwp_call_ok else 0
bf_count_sum=sum(int(x.get("Count") or 1) for x in bf_list) if cwp_call_ok else 0
bf_succ_list=(bf_s.get("BruteAttackList") or []) if cwp_call_ok else []
bf_succ_total=int(bf_s.get("TotalCount",0) or 0) if cwp_call_ok else 0

ae_list=(ae.get("List") or []) if cwp_call_ok else []
ae_total=int(ae.get("TotalCount",0) or 0) if cwp_call_ok else 0
ae_count_sum=sum(int(x.get("Count") or 1) for x in ae_list) if cwp_call_ok else 0
ae_succ_list=(ae_s.get("List") or []) if cwp_call_ok else []
ae_succ_total=int(ae_s.get("TotalCount",0) or 0) if cwp_call_ok else 0

cfw_ip_data=(ip_.get("Data") or []) if cfw_call_ok else []
cfw_pt_data=(pt_.get("Data") or []) if cfw_call_ok else []
cfw_ad_data=(ad_.get("Data") or []) if cfw_call_ok else []

merge_ip={}
if cfw_call_ok:
    for it in cfw_ip_data:
        ip=it.get("Ip") or ""
        if not ip: continue
        e=merge_ip.setdefault(ip,{"ip":ip,"cfw":0,"cwp_bf":0,"cwp_ae":0,"loc":cleanloc(it.get("Address"))})
        e["cfw"]+=int(it.get("Num") or 0)
if cwp_call_ok:
    for x in bf_list:
        ip=x.get("SrcIp") or ""
        if not ip: continue
        e=merge_ip.setdefault(ip,{"ip":ip,"cfw":0,"cwp_bf":0,"cwp_ae":0,"loc":cleanloc(x.get("Location"))})
        e["cwp_bf"]+=int(x.get("Count") or 1)
        if e["loc"]=="-": e["loc"]=cleanloc(x.get("Location"))
    for x in ae_list:
        ip=x.get("SrcIP") or ""
        if not ip: continue
        e=merge_ip.setdefault(ip,{"ip":ip,"cfw":0,"cwp_bf":0,"cwp_ae":0,"loc":cleanloc(x.get("Location"))})
        e["cwp_ae"]+=int(x.get("Count") or 1)
        if e["loc"]=="-": e["loc"]=cleanloc(x.get("Location"))
for v in merge_ip.values(): v["sum"]=v["cfw"]+v["cwp_bf"]+v["cwp_ae"]
top_ip=sorted(merge_ip.values(),key=lambda v:-v["sum"])[:15]

at_list=(at.get("Piechart") or []) if waf_ok else []
at_list=sorted([{"t":x.get("Type") or "未知","c":int(x.get("Count") or 0)} for x in at_list],key=lambda v:-v["c"])

web_top=(td.get("Web") or []) if waf_ok else []
cc_top=(td.get("CC") or []) if waf_ok else []

vul_cnt={}
for x in ae_list:
    n=x.get("VulName") or "未知漏洞"
    vul_cnt[n]=vul_cnt.get(n,0)+int(x.get("Count") or 1)
top_vul=sorted(vul_cnt.items(),key=lambda kv:-kv[1])[:10]

dst_port={}
for x in ae_list:
    p=x.get("DstPort")
    if p is None: continue
    dst_port[p]=dst_port.get(p,0)+int(x.get("Count") or 1)
top_dport=sorted(dst_port.items(),key=lambda kv:-kv[1])[:10]
dport_sum=sum(c for _,c in top_dport)

bf_user={}
for x in bf_list:
    u=x.get("UserName") or "(空)"
    bf_user[u]=bf_user.get(u,0)+int(x.get("Count") or 1)
top_user=sorted(bf_user.items(),key=lambda kv:-kv[1])[:10]

body=""

ov_cards=[]
if waf_ok:
    ov_cards+=[("WAF 拦截攻击",f"{waf_attack:,}",LV(waf_attack)),
               ("WAF 总请求",f"{waf_access:,}","info"),
               ("WAF CC 攻击",f"{waf_cc:,}",LV(waf_cc)),
               ("WAF Bot",f"{waf_bot:,}","info")]
if cwp_call_ok:
    bf_succ_lv="critical" if bf_succ_total else "info"
    ae_succ_lv="critical" if ae_succ_total else "info"
    ov_cards+=[("CWP 暴破事件组",f"{bf_total:,}",LV(bf_total)),
               ("CWP 网络攻击事件组",f"{ae_total:,}",LV(ae_total)),
               ("CWP 暴破成功",f"{bf_succ_total:,}",bf_succ_lv),
               ("CWP Web 攻击成功",f"{ae_succ_total:,}",ae_succ_lv)]
if ov_cards:
    blocks=[H.cards(ov_cards)]
    note_lines=[f"统计周期：{start} ~ {end} CST。"]
    if waf_ok:
        note_lines.append(f"WAF 峰值：QPS {peak_qps}，攻击峰值 {peak_attack}/min，CC 峰值 {peak_cc}/min。")
    blocks.append(H.para("".join(note_lines)))
    if cwp_call_ok:
        blocks.append(H.note(
            f"口径说明：CWP 「事件组」为按来源 IP+目标主机+用户名+协议聚合后的记录数（暴破 {bf_total:,} 组、网络攻击 {ae_total:,} 组）；"
            f"单组内的尝试次数会累加到下方 Top 攻击源 IP/Top 暴破账号 表中——本次首页样本中累计暴破尝试 {bf_count_sum:,} 次、网络攻击尝试 {ae_count_sum:,} 次，因此 Top 表里出现单 IP/单账号远高于事件组数的数值是预期口径，不是数据矛盾。"
        ))
    body+=H.section("攻击概览",*blocks)

if cwp_call_ok and (bf_succ_total or ae_succ_total):
    blk=[]
    if bf_succ_total:
        rows=[(x.get("SrcIp") or "-",x.get("MachineIp") or "-",x.get("UserName") or "-",x.get("Protocol") or "-",x.get("Count") or 0,cleanloc(x.get("Location")),x.get("ModifyTime") or x.get("CreateTime") or "-") for x in bf_succ_list[:20]]
        blk.append(H.para(H.color(f"暴破成功 {bf_succ_total:,} 条","critical"),f"（统计窗口内全量计数，展示前 {min(len(bf_succ_list),20)} 条样本）"))
        if rows: blk.append(H.table(["来源 IP","主机 IP","用户名","协议","次数","归属","时间"],rows))
    if ae_succ_total:
        rows=[(x.get("SrcIP") or "-",x.get("DstPort") or "-",x.get("VulName") or "-",x.get("Count") or 0,cleanloc(x.get("Location")),x.get("MergeTime") or "-") for x in ae_succ_list[:20]]
        blk.append(H.para(H.color(f"Web 漏洞攻击成功 {ae_succ_total:,} 条","critical"),f"（统计窗口内全量计数，展示前 {min(len(ae_succ_list),20)} 条样本）"))
        if rows: blk.append(H.table(["来源 IP","目标端口","漏洞","次数","归属","时间"],rows))
    body+=H.finding_crit("严重发现：检测到攻击成功事件",*blk)

if top_ip:
    show_cfw_col=cfw_call_ok
    show_cwp_cols=cwp_call_ok
    if show_cfw_col and show_cwp_cols:
        title=f"Top 攻击源 IP（合并 CFW + CWP，前 {len(top_ip)}）"
        head=["来源 IP","归属","CFW 拦截","CWP 暴破","CWP Web 攻击","合计"]
    elif show_cwp_cols:
        title=f"Top 攻击源 IP（CWP，前 {len(top_ip)}）"
        head=["来源 IP","归属","CWP 暴破","CWP Web 攻击","合计"]
    else:
        title=f"Top 攻击源 IP（CFW，前 {len(top_ip)}）"
        head=["来源 IP","归属","CFW 拦截","合计"]
    rows=[]
    for v in top_ip:
        lv=LV(v["sum"])
        row=[v["ip"],v.get("loc") or "-"]
        if show_cfw_col: row.append((v["cfw"],"c-"+lv if v["cfw"] else "info"))
        if show_cwp_cols:
            row.append((v["cwp_bf"],"c-critical") if v["cwp_bf"] else (0,"info"))
            row.append((v["cwp_ae"],"c-critical") if v["cwp_ae"] else (0,"info"))
        row.append((str(v["sum"]),lv))
        rows.append(row)
    note_bits=[]
    if cfw_call_ok: note_bits.append("CFW 数据为统计周期内拦截源 IP 维度排行")
    if cwp_call_ok: note_bits.append(f"CWP 数据来自首页 {min(len(bf_list),100)}/{bf_total} 暴破事件组、{min(len(ae_list),100)}/{ae_total} 网络攻击事件组的累计尝试次数")
    body+=H.section(title,H.table(head,rows),H.note("；".join(note_bits)+"。"))
elif waf_ok or cfw_call_ok or cwp_call_ok:
    body+=H.section("Top 攻击源 IP",H.para("当前周期未检测到攻击源 IP。"))

if waf_ok and at_list:
    total=sum(x["c"] for x in at_list) or 1
    rows=[[x["t"],f"{x['c']:,}",f"{x['c']*100/total:.1f}%"] for x in at_list[:15]]
    body+=H.section("WAF 攻击类型分布",H.table(["攻击类型","次数","占比"],rows))

if waf_ok and (web_top or cc_top):
    blk=[]
    if web_top:
        rows=[[x.get("Key") or "-",f"{int(x.get('Value') or 0):,}"] for x in web_top]
        blk.append(H.para(H.color("Web 攻击 TOP 域名","high")))
        blk.append(H.table(["域名","攻击次数"],rows))
    if cc_top:
        rows=[[x.get("Key") or "-",f"{int(x.get('Value') or 0):,}"] for x in cc_top]
        blk.append(H.para(H.color("CC 攻击 TOP 域名","high")))
        blk.append(H.table(["域名","CC 次数"],rows))
    body+=H.section("Top 受攻击域名（WAF）",*blk)

if cfw_call_ok and (cfw_pt_data or cfw_ad_data):
    blk=[]
    if cfw_pt_data:
        rows=[[x.get("Port") or "-",f"{int(x.get('Num') or 0):,}",cleanloc(x.get("Address"))] for x in cfw_pt_data]
        blk.append(H.para("Top 拦截端口"))
        blk.append(H.table(["端口","拦截次数","归属"],rows))
    if cfw_ad_data:
        rows=[[cleanloc(x.get("Address")),f"{int(x.get('Num') or 0):,}",x.get("Ip") or "-"] for x in cfw_ad_data]
        blk.append(H.para("Top 拦截地域"))
        blk.append(H.table(["地域","拦截次数","代表 IP"],rows))
    body+=H.section("CFW 拦截维度统计",*blk)

if cwp_call_ok and top_vul:
    rows=[[n,f"{c:,}"] for n,c in top_vul]
    _ae_note=f"基于全量 {ae_total} 条事件聚合。" if len(ae_list)>=ae_total else f"基于首页 {len(ae_list)} / {ae_total} 条事件聚合，仅供趋势参考，实际排名可能有偏差。"
    body+=H.section("Top 攻击利用漏洞（CWP）",H.table(["漏洞名称","攻击次数"],rows),H.note(_ae_note))

if cwp_call_ok and top_dport:
    rows=[[p,f"{c:,}"] for p,c in top_dport]
    _dp_note=f"基于全量 {ae_total} 条事件聚合。" if len(ae_list)>=ae_total else f"基于首页 {len(ae_list)} / {ae_total} 条事件聚合（采样合计 {dport_sum:,}），仅供趋势参考，实际排名可能有偏差。"
    body+=H.section("Top 受攻击端口（CWP）",H.table(["目标端口","攻击次数"],rows),H.note(_dp_note))

if cwp_call_ok and top_user:
    rows=[[u,f"{c:,}"] for u,c in top_user]
    _bf_note=f"基于全量 {bf_total} 条暴破事件聚合。" if len(bf_list)>=bf_total else f"基于首页 {len(bf_list)} / {bf_total} 条暴破事件聚合，仅供趋势参考，实际排名可能有偏差。"
    body+=H.section("Top 暴破账号（CWP）",H.table(["用户名","暴破尝试次数"],rows),H.note(_bf_note))

advice=[]
blk_target="/".join([t for t,ok in [("CFW",cfw_call_ok),("WAF",waf_ok)] if ok]) or "云服务器安全组 / 主机层 iptables"
ssh_target="/".join([t for t,ok in [("CFW",cfw_call_ok)] if ok]) or "云服务器安全组"
if cwp_call_ok and bf_succ_total: advice.append((f"暴破成功事件 {bf_succ_total:,} 条，立即重置相关主机口令并启用密钥登录、限制 SSH/RDP 来源 IP","critical"))
if cwp_call_ok and ae_succ_total: advice.append((f"Web 漏洞攻击成功 {ae_succ_total:,} 条，立即下线/修补受影响系统并核查 webshell","critical"))
bf_high_volume=cwp_call_ok and (bf_count_sum>=10000 or bf_total>=10000) and not bf_succ_total
if bf_high_volume:
    advice.append((f"CWP 暴力破解尝试量级极高（首页样本累计 {bf_count_sum:,} 次 / 共 {bf_total:,} 个事件组 / {H_HOURS}h），虽未发现成功记录，建议立即收敛 SSH/RDP 公网暴露面、强制密钥登录、在 {ssh_target} 上配置入向白名单","high"))
if cwp_call_ok and ae_total>=500 and ae_succ_total<ae_total:
    advice.append((f"CWP 网络攻击事件高量级（{ae_total:,} 个事件组/{H_HOURS}h），建议导出全量事件进一步排查可疑 RCE / webshell 落地","high"))
foreign_top=[v for v in top_ip if v.get("loc") and "中国" not in v["loc"] and v["sum"]>=500] if top_ip else []
if len(foreign_top)>=3:
    ips_short="、".join(v["ip"] for v in foreign_top[:5])
    advice.append((f"检测到 {len(foreign_top)} 个境外高频暴破/攻击源（如 {ips_short}），建议在 {ssh_target} 对相关 IP 段做入向限制，并核查 SSH/RDP 是否对外暴露","high"))
crit_ips_seen=set()
for v in top_ip[:5]:
    if v["sum"]<20: break
    if v["ip"] in crit_ips_seen: continue
    crit_ips_seen.add(v["ip"])
    advice.append((f"将高频攻击源 {v['ip']}（{v.get('loc') or '-'}, 累计 {v['sum']:,}）加入 {blk_target} 黑名单","high"))
    if len(crit_ips_seen)>=3: break
if waf_ok and waf_attack>=100: advice.append(("WAF 拦截已达较高量级，复核拦截策略与访问控制规则","high"))
if waf_ok and peak_cc>=1000: advice.append(("CC 攻击峰值显著，开启 CC 防护并验证业务可用性","high"))
if not advice: advice.append(("当前周期攻击量较低，保持现有防护策略并持续监控","info"))
if body:
    body+=H.section("处置建议",H.ul([(t,lv) for t,lv in advice]))

if not a.products:
    body=H.note("当前没有任何启用产品可供查询，请确认产品开通状态或调整产品过滤条件。")
elif not body:
    body=H.note("当前已启用产品在本周期内未返回任何攻击数据，且全部产品均不可用或未开通。")

if not unav and has(a,"WAF") and not waf_ok:
    sys.stderr.write("[attack_analysis] 警告: WAF 未识别为未开通，请检查产品启用判定逻辑\n")

period=f"{start} ~ {end} CST"
if __name__=="__main__":
    emit(a, H.wrap("攻击事件分析",body,period=period,sources=sources or None,unavailable=unav or None))
