---
name: secret-key-health-check
description: 检查 KMS 密钥和 SSM 凭据的健康状态，包括轮换情况、过期风险、使用审计
triggers:
  - "密钥检查"
  - "凭据审计"
  - "KMS检查"
  - "SSM检查"
  - "密钥轮换"
  - "凭据过期"
  - "key health check"
  - "secret audit"
products: [kms, ssm]
template: references/template/secret_key_audit.md
---

# 密钥凭据健康检查

## 适用场景

用户需要检查 KMS 密钥和 SSM 凭据的健康状态，包括密钥是否启用轮换、凭据是否即将过期、密钥使用是否异常等。适用于定期安全审计、合规检查、密钥生命周期管理等场景。

## 执行脚本 - Phase 1: 获取密钥和凭据列表

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

cmds=[
    [PY,T,"kms","ListKeys","--Offset","0","--Limit","100","--output","json"],
    [PY,T,"kms","ListAlgorithms","--output","json"],
    [PY,T,"ssm","ListSecrets","--Offset","0","--Limit","100","--output","json"],
]

wf.out(wf.batch(cmds,workers=3))
```

## 数据完整性保障 - 分页采集

```python
res["kms.ListKeys"]=wf.page("kms","ListKeys","Keys",workers=3)
res["ssm.ListSecrets"]=wf.page("ssm","ListSecrets","SecretMetadatas",workers=3)
```

## 执行脚本 - Phase 2: 密钥详情与轮换状态

根据 Phase 1 获取的密钥列表，逐个查询详情和轮换状态（DescribeKey 和 GetKeyRotationStatus 均需要 KeyId 必传参数），用 `wf.pmap` 并发：

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

key_ids=["<从Phase1 ListKeys结果中提取的KeyId列表>"]

def check_key(kid):
    detail=wf.exec([PY,T,"kms","DescribeKey","--KeyId",kid,"--output","json"])
    rotation=wf.exec([PY,T,"kms","GetKeyRotationStatus","--KeyId",kid,"--output","json"])
    return kid,{"detail":detail,"rotation":rotation}

wf.out(wf.pmap(check_key,key_ids))
```

## 执行脚本 - Phase 3: 凭据详情

根据 Phase 1 获取的凭据列表，逐个查询详情（DescribeSecret 需要 SecretName 必传参数）：

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

secret_names=["<从Phase1 ListSecrets结果中提取的SecretName列表>"]

def check_secret(name):
    return name,wf.exec([PY,T,"ssm","DescribeSecret","--SecretName",name,"--output","json"])

wf.out(wf.pmap(check_secret,secret_names))
```

## 健康检查分析维度

1. **轮换状态**：GetKeyRotationStatus 返回密钥是否启用自动轮换
2. **密钥状态**：DescribeKey 返回密钥启用/禁用/待删除状态
3. **凭据过期**：DescribeSecret 返回凭据的轮转配置和状态
4. **使用频率**：长期未使用的密钥/凭据（可能为僵尸资源）
5. **加密算法**：ListAlgorithms 返回支持的算法列表，对比密钥使用的算法

## 输出格式

使用 `references/template/secret_key_audit.md` 模板，重点填充：

- 密钥概览：总密钥数（以 ListKeys TotalCount 为准）、启用/禁用/待删除分布
- 轮换状态：已启用轮换 vs 未启用轮换的密钥列表
- 凭据概览：总凭据数（以 ListSecrets TotalCount 为准）、各状态分布
- 风险项：未轮换密钥、异常状态凭据、僵尸资源等
- 处置建议：启用轮换、清理过期凭据、删除僵尸密钥等

## 注意事项

- KMS DescribeKey 和 GetKeyRotationStatus 均需要 KeyId 必传参数，必须先通过 ListKeys 获取
- SSM DescribeSecret 和 DescribeRotationHistory 均需要 SecretName 必传参数，必须先通过 ListSecrets 获取
- 密钥数量多时注意并发控制（max_workers=5），避免触发 API 限频
- 密钥删除操作为高危操作，仅给出建议，不自动执行
- 统计数值以 ListKeys/ListSecrets 的 TotalCount 为准
- **KMS 按地域隔离**：run.py 默认先调 `GetRegions` 动态获取腾讯云 KMS 支持的全部地域，再并发查询所有地域并汇总，报告中分地域展示各地域密钥数及合计总数（`GetRegions` 失败时降级到 5 个常用地域）。用户明确指定地域时，agent 仅查该地域并标注范围。
