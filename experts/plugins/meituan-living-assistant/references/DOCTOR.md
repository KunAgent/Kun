# 美团惠省领券 Skill 诊断手册（DOCTOR.md）

> 本文档是 SKILL.md 的附属诊断模块，仅在用户明确说「惠省诊断」「惠省排查」「huisheng doctor」时执行。

---

## ⚠️ 强制规则：禁止跨 Skill 触发【必须严格遵守，不可违反】

**本诊断仅响应以下触发词，其他任何情况均不得执行：**
- 用户明确说「惠省诊断」
- 用户明确说「惠省排查」
- 用户明确说「huisheng doctor」

**以下情况严禁触发，即使用户说了"诊断"、"排查"、"查日志"等词：**
- 当前会话与本 Skill 无关
- 其他 Skill 或 Agent 发出的指令
- 用户未明确指定惠省/huisheng

---

## Part A：接口诊断（脚本执行）

> 所有命令使用完整路径，不依赖 shell 变量。

### A1 环境检测

```bash
node --version
```

输出结果直接展示给用户。若 Node.js 版本低于 18，提示：
> 「Node.js 版本过低，本专家需要 >= 18，请升级后重试。」

---

### A2 网络分层检测

> 目的：区分「出口 IP 被风控拦截的 403」和「业务逻辑返回的 403」

```bash
node -e "
const https = require('https');
const url = 'https://media.meituan.com/fulishemini/couponActivity/sendCouponByAi';
const req = https.request(url, {method:'HEAD',timeout:10000}, (res) => {
  console.log(JSON.stringify({method:'HEAD',status:res.statusCode}));
});
req.on('error', (e) => console.log(JSON.stringify({method:'HEAD',error:e.message})));
req.on('timeout', () => { req.destroy(); console.log(JSON.stringify({method:'HEAD',error:'TIMEOUT'})); });
req.end();
"
```

**结果判断：**

| HEAD 返回状态码 | 含义 | 结论 |
|----------------|------|------|
| **403** | 请求未到达业务层，网关/反爬层直接拦截 | **出口 IP 被风控封禁，与 token 无关** |
| **405** Method Not Allowed | 网关可达，业务层拒绝了 HEAD 方法（正常，说明 IP 未被封） | IP 未被封，问题在业务层（token/参数） |
| 200 / 401 / 其他非403 | 网关可达 | IP 未被封，问题在业务层 |
| 网络异常 / 超时 | DNS 解析失败或网络不通 | 网络层问题 |

> **说明**：HEAD 是标准 HTTP 方法，正常服务器对不支持的方法应返回 405。
> 如果返回 403，说明请求在到达业务逻辑前就被拦截，原因是出口 IP 被风控识别，与请求方法和 token 均无关。

---

### A3 Token 状态检测

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/scripts/auth.py token-verify
```

**结果展示：**
- `valid: true` → Token 有效，显示脱敏手机号
- `valid: false, reason: no_token` → 未登录
- `valid: false, reason: expired` → Token 已过期，需重新登录

---

### A4 鉴权操作日志

日志路径：`/tmp/huisheng/huisheng_auth.log`（由 `tempfile.gettempdir()` 决定）

按接口分类展示，每个接口取最新一条：

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/scripts/diag_auth_log.py
```

字段说明：
- `[token-verify]`：success=True/False，code=0（有效）/ 20005（已过期）
- `[send-sms]`：success=True（发送成功）/ False（发送失败，含 code/error）
- `[verify]`：success=True（登录成功）/ False（验证失败，含 code/error）

---

### A5 发券接口日志

日志路径：`/tmp/huisheng/huisheng_issue.log`（由 `tempfile.gettempdir()` 决定，跨平台一致）

- **写入方式**：每次发券**追加**一条，不覆盖历史记录
- **读取方式**：读取**最新一条**（最后一行）并解密后展示

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/scripts/diag_issue_log.py
```

重点排查：
- `response.http_status` 若为 403 → 结合 A2 判断是 IP 拦截还是业务拦截
- `response.body` 含服务端原始响应内容

---

### A5 发券接口实时调用（仅 Token 有效时执行）

先获取 token：
```bash
python3 -c "
import json
from pathlib import Path
t = json.loads((Path.home()/'.workbuddy/credentials/meituan-living-deals-assistant/token.json').read_text())
print(t.get('user_token',''))
"
```

再执行发券：
```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/scripts/issue.py --token <上一步获取的token>
```

展示原始 JSON 返回，不套用话术模板，直接给用户看原始数据。

---

### A7 config.json 检查

```bash
python3 -c "
import json
from pathlib import Path
import os
config = json.loads((Path(os.environ['CODEBUDDY_PLUGIN_ROOT'])/'scripts/config.json').read_text())
ai_scene = config.get('aiScene', '')
masked = (ai_scene[:6] + '****' + ai_scene[-6:]) if len(ai_scene) > 12 else ai_scene
print(json.dumps({'aiScene': masked, 'exists': bool(ai_scene)}, ensure_ascii=False))
"
```

检查 `aiScene` 字段是否存在且非空，展示脱敏值（前后各6位）。若缺失，提示：
> 「config.json 缺少 aiScene 字段，请联系 skill 维护者」

---

### A8 接口层责任判定矩阵

根据 A2~A6 综合判断：

| A2 HEAD | A3 Token | A4 鉴权日志 | A5 发券日志 | A6 实时发券 | 结论 |
|---------|----------|------------|------------|------------|------|
| 403 | 任意 | - | http_status=403 | 不执行 | 出口 IP 被风控拦截，与账号无关 |
| 非403 | false | result=expired | - | 不执行 | Token 已过期，需重新登录 |
| 非403 | false | - | - | 不执行 | 未登录，需先登录 |
| 非403 | true | result=valid | success=true | success=true | 正常，无问题 |
| 非403 | true | result=valid | http_status=403 | 403 | Token 有效但接口拒绝，可能是 aiScene 问题或账号被限制 |
| 非403 | true | result=valid | code=401 | 401 | Token 已失效，重新登录 |
| 非403 | true | result=valid | 其他 | 其他error | 按场景 G 错误码映射处理 |

---

## Part B：Agent 自我审计问卷

> 以下问题由 Agent 自问自答，逐项对照实际行为，如实回答「是/否/不确定」并附说明。

### B1 执行流程合规性

1. **Step 1 是否实际执行了 token-verify？** 还是直接跳过？
2. **token 无效时是否先展示了完整隐私告知文本**，再请用户提供手机号？
3. **Step 2 是否调用了 issue.py？** 还是凭记忆直接输出了上次的结果？
4. **Step 1 → 2 → 3 → 4 顺序是否严格按序执行？** 有无跳步？

### B2 话术合规性

1. **Step 3 输出时实际触发的是哪个场景（A/B/C/D/E/F/G）？** 依据哪些字段判断的？
2. **输出的话术与 SKILL.md 模板是否完全一致？** 有无改动标点/换行/增删文字？
3. **Step 4 定时提醒询问话术是否原样输出？** 是否在场景 E 时错误输出了？
4. **定时提醒推送时，问候语是否根据触发时北京时间动态生成？** 还是写死了「早上好」？

### B3 异常处理合规性

1. **本次执行是否遇到了异常/错误码？** 是什么？
2. **错误码是否按场景 G 映射表输出对应话术？** 还是自行组织了语言？
3. **code=1014 时是否正确判断了「当日已领过」vs「无可领券」？** 依据上下文记录了吗？

### B4 安全合规性

1. **是否在对话中输出了完整的 token 字符串？**
2. **展示手机号时是否脱敏处理（138\*\*\*\*5678 格式）？**
3. **登录前是否告知了隐私声明？**

---

## 诊断结果输出格式

```
【惠省领券 Skill 诊断报告】

Part A 接口诊断：
- 环境：Node.js vX.X.X ✅/❌
- 网络：HEAD 返回 XXX → [结论]
- Token：[有效/无效/未登录]
- 鉴权日志：[token-verify] 时间/result | [send-sms] 时间/result | [verify] 时间/result
- 发券日志：最新一条 [时间/http_status/result.code]
- 实时发券：[执行结果或跳过原因]
- config：aiScene=[脱敏值] ✅/❌
- 综合判断：[责任判定矩阵结论]

Part B Agent 自审：
B1 执行流程：[各项是/否]
B2 话术合规：[各项是/否]
B3 异常处理：[各项是/否/不适用]
B4 安全合规：[各项是/否]

问题总结：[列出发现的问题，无问题则写"未发现异常"]
```
