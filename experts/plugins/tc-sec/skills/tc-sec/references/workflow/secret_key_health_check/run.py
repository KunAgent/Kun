import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
from wf_run import args,has,any_of,emit,product_zh,is_unavailable,detect_enabled,apply_enabled
T=wf.T; PY=wf.PY

a=args(["KMS","SSM"],name="secret_key_health_check")
enabled=detect_enabled()
apply_enabled(a,enabled)

NMAX=a.detail_max or 20
NOW=int(wf.time("ts") or "0")
DAY=86400
def fmt(ts):
    if not ts or int(ts)<=0: return "-"
    return wf.time("fmt",str(int(ts)))

cmds=[]
if has(a,"KMS"):
    cmds.append([PY,T,"kms","ListAlgorithms","--output","json"])
    cmds.append([PY,T,"kms","GetRegions","--output","json"])
if has(a,"SSM"): cmds.append([PY,T,"ssm","GetServiceStatus","--output","json"])
p1=wf.batch(cmds,workers=3) if cmds else {}

_rgn_resp=p1.get("kms.GetRegions") or {}
KMS_REGIONS=(_rgn_resp.get("Regions") or []) if isinstance(_rgn_resp,dict) and "Error" not in _rgn_resp else ["ap-guangzhou","ap-beijing","ap-shanghai","ap-chengdu","ap-nanjing"]
def _list_keys_region(r):
    return r,wf.page("kms","ListKeys","Keys",limit=200,workers=3,extra=["--region",r])
kms_region_resp=wf.pmap(_list_keys_region,KMS_REGIONS,workers=8) if has(a,"KMS") and KMS_REGIONS else {}

keys_resp_combined={}
kms_region_totals={}
key_region_map={}
for rgn,resp in (kms_region_resp.items() if isinstance(kms_region_resp,dict) else []):
    if is_unavailable(resp): continue
    keys_resp_combined.setdefault("Keys",[])
    for k in (resp.get("Keys") or []):
        keys_resp_combined["Keys"].append(k)
        key_region_map[k.get("KeyId","")]=rgn
    kms_region_totals[rgn]=resp.get("TotalCount",0)
keys_resp=keys_resp_combined if keys_resp_combined else {}
if kms_region_totals:
    keys_resp["TotalCount"]=sum(kms_region_totals.values())

secrets_resp=wf.page("ssm","ListSecrets","SecretMetadatas",limit=100,workers=3) if has(a,"SSM") else {}

kms_avail=has(a,"KMS") and not is_unavailable(keys_resp)
ssm_avail=has(a,"SSM") and not is_unavailable(secrets_resp)
key_ids=[k.get("KeyId") for k in (keys_resp.get("Keys") or [])] if kms_avail else []
secret_list=(secrets_resp.get("SecretMetadatas") or []) if ssm_avail else []
secret_names=[s.get("SecretName") for s in secret_list]

def fk(kid):
    rgn=key_region_map.get(kid)
    rgn_args=["--region",rgn] if rgn else []
    d=wf.exec([PY,T,"kms","DescribeKey","--KeyId",kid]+rgn_args+["--output","json"])
    r=wf.exec([PY,T,"kms","GetKeyRotationStatus","--KeyId",kid]+rgn_args+["--output","json"])
    md=(d.get("KeyMetadata") if isinstance(d,dict) else None) or {}
    if isinstance(r,dict) and "Error" not in r and "KeyRotationEnabled" in r:
        md["KeyRotationEnabled"]=r["KeyRotationEnabled"]
    return kid,md
def fs(name):
    d=wf.exec([PY,T,"ssm","DescribeSecret","--SecretName",name,"--output","json"])
    return name,(d if isinstance(d,dict) else {})

key_details=wf.pmap(fk,key_ids[:NMAX],workers=5) if key_ids else {}
secret_details=wf.pmap(fs,secret_names[:NMAX],workers=5) if secret_names else {}

key_total=keys_resp.get("TotalCount",len(key_ids)) if kms_avail else 0
sec_total=secrets_resp.get("TotalCount",len(secret_list)) if ssm_avail else 0

state_map={"Enabled":"启用","Disabled":"禁用","PendingDelete":"待删除","PendingImport":"待导入","Archived":"已归档"}
usage_map={"ENCRYPT_DECRYPT":"对称加解密","ASYMMETRIC_DECRYPT_RSA_2048":"非对称RSA-2048","ASYMMETRIC_DECRYPT_SM2":"非对称SM2","ASYMMETRIC_SIGN_VERIFY_SM2":"签名验签SM2","ASYMMETRIC_SIGN_VERIFY_RSA_2048":"签名验签RSA-2048","ASYMMETRIC_SIGN_VERIFY_ECC":"签名验签ECC"}
sec_type_map={0:"自定义",1:"云产品",2:"SSH密钥对",3:"API密钥对",4:"Redis"}
owner_map={"user":"用户密钥","tencent":"云产品托管","cmek":"用户密钥","ssm":"凭据托管","cloudaudit":"日志托管"}
origin_map={"TENCENT_KMS":"腾讯云生成","EXTERNAL":"外部导入"}
paymodel_map={"WhiteList_SSM":"白名单（SSM）","WhiteList":"白名单","PayAsYouGo":"按量计费","Monthly":"包年包月","Yearly":"包年","PrePaid":"预付费","PostPaid":"后付费"}
def kid_disp(kid):
    if not kid: return "-"
    return kid if len(kid)<=44 else kid[:8]+"…"+kid[-12:]

ks_by_state={}
ks_no_rot=[]
ks_overdue=[]
ks_warn_rotate=[]
ks_external=[]
ks_no_desc=[]
ks_pending_delete=[]
ks_pending_import=[]
ks_disabled=[]

for kid in key_ids[:NMAX]:
    md=key_details.get(kid) or {}
    if not md or "Error" in md: continue
    st=md.get("KeyState","")
    ks_by_state[st]=ks_by_state.get(st,0)+1
    alias=md.get("Alias","") or "(无别名)"
    usage=md.get("KeyUsage","")
    rot_on=bool(md.get("KeyRotationEnabled",False))
    origin=md.get("Origin","")
    desc=(md.get("Description","") or "").strip()
    next_rt=md.get("NextRotateTime",0) or 0
    last_rt=md.get("LastRotateTime",0) or 0
    rdays=md.get("RotateDays",0) or 0
    deletion=md.get("DeletionDate",0) or 0
    short=kid_disp(kid)
    if st=="Enabled" and not rot_on:
        ks_no_rot.append([alias,short,usage_map.get(usage,usage),owner_map.get(md.get("Owner",""),md.get("Owner","-") or "-")])
    if st=="Enabled" and rot_on and last_rt>0 and rdays>0:
        ds=(NOW-last_rt)//DAY
        if ds>rdays:
            ks_overdue.append([alias,short,rdays,ds,fmt(last_rt)])
    if st=="Enabled" and rot_on and next_rt>0:
        gap=(next_rt-NOW)//DAY
        if 0<=gap<=30:
            ks_warn_rotate.append([alias,short,fmt(next_rt),gap])
    if origin=="EXTERNAL":
        valid_to=md.get("ValidTo",0) or 0
        if valid_to>0:
            vt_disp=fmt(valid_to)
        elif st=="PendingImport":
            vt_disp="未导入材料"
        else:
            vt_disp="永不过期"
        ks_external.append([alias,short,state_map.get(st,st),vt_disp])
    if not desc and md.get("Owner")=="user":
        ks_no_desc.append([alias,short,usage_map.get(usage,usage)])
    if st=="PendingDelete":
        ks_pending_delete.append([alias,short,fmt(deletion)])
    if st=="PendingImport":
        ks_pending_import.append([alias,short,fmt(md.get("CreateTime",0))])
    if st=="Disabled":
        ks_disabled.append([alias,short,usage_map.get(usage,usage),fmt(md.get("CreateTime",0))])

ss_by_state={}
ss_by_type={}
ss_no_rot_cloud=[]
ss_overdue=[]
ss_warn=[]
ss_disabled_list=[]
ss_pending_delete=[]
ss_no_kms=[]
ss_long_idle=[]

for s in secret_list:
    name=s.get("SecretName","")
    st=s.get("Status","")
    stype=s.get("SecretType",0)
    rot_on=s.get("RotationStatus",0) in (1,True)
    next_r=s.get("NextRotationTime",0) or 0
    create=s.get("CreateTime",0) or 0
    delete_t=s.get("DeleteTime",0) or 0
    kms_id=s.get("KmsKeyId","") or ""
    freq=s.get("RotationFrequency",0) or 0
    pname=s.get("ProductName","") or "-"
    ss_by_state[st]=ss_by_state.get(st,0)+1
    ss_by_type[stype]=ss_by_type.get(stype,0)+1
    if st=="Enabled" and not rot_on and stype==1:
        ss_no_rot_cloud.append([name,sec_type_map.get(stype,str(stype)),pname,fmt(create)])
    if st=="Enabled" and rot_on and next_r>0:
        if next_r<NOW:
            ss_overdue.append([name,sec_type_map.get(stype,str(stype)),fmt(next_r),(NOW-next_r)//DAY,freq])
        else:
            gap=(next_r-NOW)//DAY
            if 0<=gap<=7:
                ss_warn.append([name,sec_type_map.get(stype,str(stype)),fmt(next_r),gap,freq])
    if st=="Disabled":
        ss_disabled_list.append([name,sec_type_map.get(stype,str(stype)),pname,fmt(create)])
    if st=="PendingDelete":
        ss_pending_delete.append([name,sec_type_map.get(stype,str(stype)),fmt(delete_t)])
    if st=="Enabled" and not kms_id:
        ss_no_kms.append([name,sec_type_map.get(stype,str(stype)),(s.get("Description","") or "-")[:40]])
    if st=="Enabled" and not rot_on and create>0 and (NOW-create)//DAY>=180:
        ss_long_idle.append([name,sec_type_map.get(stype,str(stype)),(NOW-create)//DAY,fmt(create)])

ks_overdue.sort(key=lambda r:-r[3])
ks_warn_rotate.sort(key=lambda r:r[3])
ss_overdue.sort(key=lambda r:-r[3])
ss_warn.sort(key=lambda r:r[3])
ss_long_idle.sort(key=lambda r:-r[2])

risk_score=len(ks_overdue)*15+len(ks_no_rot)*5+len(ks_warn_rotate)*3+len(ks_pending_delete)*8+len(ks_pending_import)*5+len(ks_no_desc)*2
risk_score+=len(ss_overdue)*15+len(ss_no_rot_cloud)*5+len(ss_warn)*3+len(ss_long_idle)*2+len(ss_no_kms)*4+len(ss_pending_delete)*8
if risk_score>=80: risk_lvl=("严重","critical")
elif risk_score>=40: risk_lvl=("高","high")
elif risk_score>=15: risk_lvl=("中","medium")
else: risk_lvl=("低","low")

unav=[product_zh(p) for p in sorted(getattr(a,"skipped_products",set()))]
if has(a,"KMS") and is_unavailable(keys_resp):
    if product_zh("KMS") not in unav: unav.append(product_zh("KMS"))
if has(a,"SSM") and is_unavailable(secrets_resp):
    if product_zh("SSM") not in unav: unav.append(product_zh("SSM"))
sources=[product_zh(p) for p in ("KMS","SSM") if has(a,p) and product_zh(p) not in unav]

ssm_has_data=has(a,"SSM") and ssm_avail and sec_total>0
kms_truncated=has(a,"KMS") and kms_avail and len(key_ids)<key_total

body=[]
overview_cards=[]
if has(a,"KMS") and kms_avail: overview_cards.append(("KMS 密钥总数（全地域合计）",str(key_total)))
if has(a,"SSM") and ssm_avail and sec_total>0: overview_cards.append(("SSM 凭据总数",str(sec_total)))
if has(a,"KMS") and kms_avail: overview_cards.append(("详情抽样",f"{len(key_details)}/{key_total}"))
if ssm_has_data: overview_cards.append(("SSM 详情抽样",f"{len(secret_details)}/{sec_total}"))
overview_cards.append(("综合风险评分",str(risk_score),"c-"+risk_lvl[1]))
overview_cards.append(("风险等级",risk_lvl[0],"c-"+risk_lvl[1]))
if overview_cards:
    rgn_note=""
    if has(a,"KMS") and kms_avail and kms_region_totals:
        rgn_note=" KMS 各地域密钥数："+", ".join(f"{r}={kms_region_totals.get(r,0)}" for r in KMS_REGIONS if kms_region_totals.get(r,0)>0)+"。"
    body.append(H.section("健康总览",H.cards(overview_cards),H.note(f"本次详情展开上限 {NMAX} 条；统计总数为 KMS/SSM 后台返回的全量计数，抽样指对每条资源详情字段（轮换状态、用途、来源等）的展开深度。{rgn_note}KMS 已覆盖地域：{', '.join(KMS_REGIONS)}。")))

st_rows_k=[[state_map.get(k,k),v] for k,v in sorted(ks_by_state.items(),key=lambda x:-x[1])]
st_rows_s=[[state_map.get(k,k),v] for k,v in sorted(ss_by_state.items(),key=lambda x:-x[1])]
ty_rows_s=[[sec_type_map.get(k,str(k)),v] for k,v in sorted(ss_by_type.items(),key=lambda x:-x[1])]
dist_parts=[]
kms_count_label="数量(基于抽样)" if kms_truncated else "数量"
if has(a,"KMS") and kms_avail and st_rows_k: dist_parts.append(H.table(["KMS 密钥状态",kms_count_label],st_rows_k))
if ssm_has_data and st_rows_s: dist_parts.append(H.table(["SSM 凭据状态","数量"],st_rows_s))
if ssm_has_data and ty_rows_s: dist_parts.append(H.table(["SSM 凭据类型","数量"],ty_rows_s))
if dist_parts:
    body.append(H.section("分布统计",*dist_parts))

findings=[]
if has(a,"KMS") and ks_overdue:
    findings.append(H.finding_crit(f"严重：{len(ks_overdue)} 个 KMS 密钥实际未轮换天数已超出设定轮换周期",H.table(["别名","KeyId","轮换周期(天)","距上次轮换(天)","上次轮换时间"],[[r[0],r[1],r[2],(str(r[3]),"critical"),r[4]] for r in ks_overdue[:15]])))
if has(a,"SSM") and ss_overdue:
    findings.append(H.finding_crit(f"严重：{len(ss_overdue)} 个 SSM 凭据已开启轮转但 NextRotationTime 已过",H.table(["凭据名","类型","下次轮换时间","已超期(天)","轮换频率(天)"],[[r[0],r[1],r[2],(str(r[3]),"critical"),r[4]] for r in ss_overdue[:15]])))
if has(a,"KMS") and ks_no_rot:
    findings.append(H.finding(f"风险：{len(ks_no_rot)} 个启用状态密钥未开启自动轮换（含对称与签名验签等所有用途）",H.table(["别名","KeyId","用途","归属类型"],[[r[0],r[1],r[2],r[3]] for r in ks_no_rot[:20]]),H.note("未开启轮换会导致密钥长期不变，泄露后影响范围扩大；建议在 KMS 控制台开启自动轮换：https://console.cloud.tencent.com/kms2")))
if has(a,"SSM") and ss_no_rot_cloud:
    findings.append(H.finding(f"风险：{len(ss_no_rot_cloud)} 个启用云产品凭据未开启轮转（仅云产品类型支持自动轮转）",H.table(["凭据名","类型","云产品","创建时间"],ss_no_rot_cloud[:20])))
if has(a,"KMS") and ks_warn_rotate:
    findings.append(H.finding(f"预警：{len(ks_warn_rotate)} 个密钥将在 30 天内到达下次轮换时间",H.table(["别名","KeyId","下次轮换时间","剩余(天)"],[[r[0],r[1],r[2],(str(r[3]),"medium")] for r in ks_warn_rotate[:15]])))
if has(a,"SSM") and ss_warn:
    findings.append(H.finding(f"预警：{len(ss_warn)} 个凭据将在 7 天内到达下次轮换时间",H.table(["凭据名","类型","下次轮换时间","剩余(天)","频率(天)"],[[r[0],r[1],r[2],(str(r[3]),"medium"),r[4]] for r in ss_warn[:15]])))
if has(a,"KMS") and ks_pending_delete:
    findings.append(H.finding(f"关注：{len(ks_pending_delete)} 个 KMS 密钥处于待删除状态（删除窗口期内可恢复，逾期不可逆）",H.table(["别名","KeyId","计划删除时间"],[[r[0],r[1],(r[2],"high")] for r in ks_pending_delete[:10]])))
if has(a,"KMS") and ks_pending_import:
    findings.append(H.finding(f"关注：{len(ks_pending_import)} 个 KMS 密钥处于待导入状态（外部材料未导入，密钥暂不可用）",H.table(["别名","KeyId","创建时间"],[[r[0],r[1],(r[2],"medium")] for r in ks_pending_import[:10]]),H.note("待导入状态通常意味着外部导入流程未完成，长期挂起会占用配额；请尽快导入材料或删除。")))
if has(a,"SSM") and ss_pending_delete:
    findings.append(H.finding(f"关注：{len(ss_pending_delete)} 个 SSM 凭据处于待删除状态",H.table(["凭据名","类型","计划删除时间"],[[r[0],r[1],(r[2],"high")] for r in ss_pending_delete[:10]])))
if has(a,"SSM") and ss_long_idle:
    findings.append(H.finding(f"僵尸资源：{len(ss_long_idle)} 个启用凭据创建已超 180 天且未开启轮转",H.table(["凭据名","类型","创建天数","创建时间"],[[r[0],r[1],(str(r[2]),"medium"),r[3]] for r in ss_long_idle[:15]])))
if has(a,"KMS") and ks_external:
    findings.append(H.finding(f"外部导入密钥：{len(ks_external)} 个（需关注材料到期时间）",H.table(["别名","KeyId","状态","到期时间"],ks_external[:15])))
if has(a,"SSM") and ss_no_kms:
    findings.append(H.finding(f"配置缺陷：{len(ss_no_kms)} 个启用凭据未关联主密钥",H.table(["凭据名","类型","描述"],ss_no_kms[:10])))
if has(a,"KMS") and ks_no_desc:
    findings.append(H.finding(f"治理：{len(ks_no_desc)} 个用户密钥未填写描述，影响审计溯源",H.table(["别名","KeyId","用途"],ks_no_desc[:15])))
if has(a,"KMS") and ks_disabled:
    findings.append(H.finding(f"备查：{len(ks_disabled)} 个已禁用密钥",H.table(["别名","KeyId","用途","创建时间"],ks_disabled[:10])))
if has(a,"SSM") and ss_disabled_list:
    findings.append(H.finding(f"备查：{len(ss_disabled_list)} 个已禁用凭据",H.table(["凭据名","类型","云产品","创建时间"],ss_disabled_list[:10])))

body.append(H.section("关键风险与发现",*findings) if findings else H.section("关键风险与发现",H.note("当前抽样范围内未发现 KMS/SSM 健康风险，密钥与凭据生命周期管理规范。")))

if has(a,"KMS") and kms_avail and key_ids:
    rows=[]
    for kid in key_ids[:30]:
        md=key_details.get(kid) or {}
        if not md or "Error" in md: continue
        st=md.get("KeyState","")
        rot_flag=bool(md.get("KeyRotationEnabled"))
        rd_disp=str(md.get("RotateDays",0) or 0) if rot_flag else "-"
        owner_v=owner_map.get(md.get("Owner",""),md.get("Owner","-") or "-")
        origin_v=origin_map.get(md.get("Origin",""),md.get("Origin","-") or "-")
        rows.append([md.get("Alias","") or "(无别名)",kid_disp(kid),usage_map.get(md.get("KeyUsage",""),md.get("KeyUsage","")),(state_map.get(st,st),"info" if st=="Enabled" else ("high" if st=="PendingDelete" else "medium")),owner_v,origin_v,("是","info") if rot_flag else ("否","high"),rd_disp])
    body.append(H.section(f"KMS 密钥明细（已抽样 {len(rows)}/{key_total}）",H.table(["别名","KeyId","用途","状态","归属类型","来源","已开启轮换","轮换周期(天)"],rows) if rows else H.note("无可用密钥明细"),H.note("『轮换周期』列：未开启轮换显示『-』（默认 365 不代表实际生效）。")))

if ssm_has_data:
    rows=[]
    for s in secret_list[:30]:
        st=s.get("Status","")
        rows.append([s.get("SecretName",""),sec_type_map.get(s.get("SecretType",0),str(s.get("SecretType",0))),s.get("ProductName","") or "-",(state_map.get(st,st),"info" if st=="Enabled" else ("high" if st=="PendingDelete" else "medium")),("是","info") if s.get("RotationStatus") in (1,True) else ("否","high"),str(s.get("RotationFrequency",0) or 0),fmt(s.get("NextRotationTime",0)),s.get("KmsKeyType","") or "-"])
    body.append(H.section(f"SSM 凭据明细（前 {len(rows)}/{sec_total}）",H.table(["凭据名","类型","云产品","状态","已开启轮转","频率(天)","下次轮换","主密钥类型"],rows)))

if has(a,"KMS"):
    al=p1.get("kms.ListAlgorithms")
    if not is_unavailable(al):
        sym=", ".join(x.get("Algorithm","") for x in (al.get("SymmetricAlgorithms") or [])) or "-"
        asym=", ".join(x.get("Algorithm","") for x in (al.get("AsymmetricAlgorithms") or [])) or "-"
        sig=", ".join(x.get("Algorithm","") for x in (al.get("AsymmetricSignVerifyAlgorithms") or [])) or "-"
        body.append(H.section("当前地域支持算法",H.cards([("对称",sym),("非对称加解密",asym),("非对称签名验签",sig)])))

if has(a,"SSM"):
    ssm_st=p1.get("ssm.GetServiceStatus")
    if not is_unavailable(ssm_st):
        pm=ssm_st.get("PayModel") or ""
        pm_disp=paymodel_map.get(pm,pm or "-")
        body.append(H.section("SSM 服务状态",H.cards([("服务开通","是" if ssm_st.get("ServiceEnabled") else "否"),("付费模式",pm_disp),("到期时间",(ssm_st.get("ExpireTime") or "-")),("AccessKey 托管","是" if ssm_st.get("AccessKeyEscrowEnabled") else "否")])))

advice=[]
if (has(a,"KMS") and ks_overdue) or (has(a,"SSM") and ss_overdue):
    advice.append("立即在控制台核查超期密钥/凭据的轮换配置，必要时手动触发轮换")
if has(a,"KMS") and ks_no_rot:
    advice.append("为启用状态密钥统一开启自动轮换（含签名验签类）：https://console.cloud.tencent.com/kms2")
if has(a,"SSM") and ss_no_rot_cloud:
    advice.append("为云产品凭据开启自动轮转：https://console.cloud.tencent.com/ssm")
if has(a,"KMS") and ks_external:
    advice.append("外部导入（BYOK）密钥需建立材料到期时间监控，到期前完成更新")
if has(a,"KMS") and ks_pending_import:
    advice.append("复核处于待导入状态的密钥：尽快导入外部材料完成流程，或删除以释放配额")
if has(a,"KMS") and ks_no_desc:
    advice.append("为用户密钥补全描述信息，便于审计溯源与责任归属")
if has(a,"SSM") and ss_long_idle:
    advice.append("评估长期闲置凭据是否仍在使用，无业务对接的应纳入清理流程")
if (has(a,"KMS") and ks_pending_delete) or (has(a,"SSM") and ss_pending_delete):
    advice.append("处于待删除状态的资源在窗口期内可撤回，逾期不可逆，建议复核业务影响")
if has(a,"SSM") and ss_no_kms:
    advice.append("启用凭据未关联主密钥的请显式绑定，便于权限与审计")
if not advice:
    advice.append("当前状态良好，建议保持季度审计节奏并持续监控轮换状态异常")
body.append(H.section("处置建议",H.ol(advice)))

body_html=H.html("".join(str(b) for b in body)) if body else ""
if not a.products:
    body_html=H.note("当前筛选条件下没有任何启用产品可查询。请调整产品筛选范围。")
elif not body_html:
    body_html=H.note("当前筛选条件下没有任何启用产品可查询。请调整产品筛选范围。")

if __name__=="__main__":
    emit(a, H.wrap("密钥凭据健康检查",body_html,sources=sources or None,unavailable=unav or None))
