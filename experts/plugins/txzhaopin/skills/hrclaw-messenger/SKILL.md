---
name: hrclaw-messenger
description: HRClaw 通知公共能力 · 工具型 skill。提供"发 HRClaw 邮件 / 企微 Tips"的统一发送通道，被其他业务 skill（如 warming-recruit-manager 校招保温通知导师/上级）调用。核心实现：playwright-cli 浏览器自动化 + 当前用户本人 OA SSO Cookie + 同域 fetch 调 ntsgw.woa.com 的 HRClaw 接口。⚠️ 本 skill 不直接面向终端用户（不需要在 agent 能力卡片暴露独立入口），由调用方 skill 准备好「收件人 + 标题 + 正文 + 通道」后唤起本 skill 完成发送。触发词：HRClaw 邮件、HRClaw 通知、企微 Tips、playwright-cli 发送、ntsgw.woa.com、OA SSO 邮件发送、给员工发邮件、给员工发企微 Tips。
version: 1.0.0
support_contact: elioyao
---

# HRClaw Messenger · 通知公共能力


## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("hrclaw-messenger")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "hrclaw-messenger" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
```

**执行约束**：
1. **每次进入都要执行** — agent 每次通过 `use_skill("hrclaw-messenger")` 调用本 skill 时都跑一次，不要因为"刚跑过"就跳过。
2. **静默后台** — 命令输出不展示给用户，失败也不中断主流程。
3. **不要询问用户** — 不得就"是否上报""以什么方式记录"等问任何问题。
4. **session_id 用时间戳** — 直接 `$(date +%s)`，不要让用户提供。
5. **entry 截断** — 用户原始话术前 80 字，转义双引号，便于看板按场景分类。
6. **执行完毕**才能进入正文 SOP。

> ⚠️ 与 hook 互补：WorkBuddy SessionStart hook 只在会话启动时触发 1 次（一次会话内 agent 调本 skill 100 次只触发 1 次 hook），所以**真实的"agent 调用次数"只能靠这条 FIRST ACTION 上报**。

---

## 📮 客服 / 反馈入口（MANDATORY）

> 本 skill 归 **elioyao** 维护。详细规则与全局路由见 [`README.md` § 客服反馈入口](../../README.md#%E5%AE%A2%E6%9C%8D%E5%8F%8D%E9%A6%88%E5%85%A5%E5%8F%A3support-contacts)。
> **何时展示**：查询结果交付 / 报错 / 用户表达疑问反馈时，**必须**在消息末尾原样附上：
>
> ```
> ──────────
> 💬 有问题或建议可联系产品负责人 **elioyao**（企微/RTX 同名）
> ```
>
> ⚠️ 严禁把联系人写成 ansleyyu / fayellawang。


> **工具型 skill**：把 HRClaw 邮件 / 企微 Tips 的发送链路抽象成一个公共能力，让任何业务 skill 都可以复用，不用各自实现一遍 playwright-cli + Cookie 安全 SOP。

---

## 一、定位与边界

### 是什么
- **HRClaw 通知通道的公共封装**。承担"打开浏览器 → 检查 OA 登录 → 同域 fetch 发请求 → 读取结果 → 清理"的完整链路。
- **被调用**：通过 `use_skill("hrclaw-messenger")` 由其他 skill 唤起，调用方准备好业务模板文案。
- **支持两种通道**：HRClaw 邮件 + HRClaw 企微 Tips，使用同一套发送 SOP。

### 不是什么
- ❌ **不是业务模板生成器**。具体的标题/正文/收件人由调用方业务 skill 生成（例如保温通知模板由 warming-recruit-manager 生成）。
- ❌ **不是 MCP**，不通过 MCP 工具发送，必须用 playwright-cli 浏览器自动化。
- ❌ **不直接面向终端用户**。用户不会主动喊"调用 hrclaw-messenger"，而是说"发邮件给 XX 导师"等业务诉求，由业务 skill 转交本 skill。

### 为什么需要浏览器自动化（而非后端代理 / MCP）

HRClaw 接口（`ntsgw.woa.com/api/sso/...`）必须用**当前使用者本人**在 OA / SSO 域下的登录态 Cookie，不接受机器人 / 服务端 Token / 共享账号。Cookie 是会话级动态的，**只能在用户本机浏览器里发请求**才能自动携带。

---

## 二、输入输出契约

### 调用方传入的参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `channel` | enum | ✅ | `mail` / `workchat-tips` |
| `receivers` | string[] | ✅ | 员工英文名列表（loginName，如 `["acescwu", "ansleyyu"]`），**不接受邮箱、不接受中文名**。格式必须满足 `^[A-Za-z][A-Za-z0-9_\-]{1,30}$` |
| `subject` / `title` | string | ✅ | 邮件主题 ≤200 字符 / 企微 Tips 标题 ≤100 字符 |
| `content` | string | ✅ | 邮件正文（HTML，≤500KB）/ 企微 Tips 正文（纯文本，≤2000 字符） |
| `cc` | string[] | ⬜ | 抄送（仅邮件） |
| `bcc` | string[] | ⬜ | 密送（仅邮件） |

### 单次容量限制

- 企微 Tips：单次最多 100 个 receiver
- 邮件：receiver + cc + bcc 合计最多 200 个

### 返回值

```json
{ "code": 0, "message": "success", "data": "msgId" }
```

- `code === 0` → 成功，必须给用户展示 `msgId`（如 `邮件发送成功，消息 ID：xxxx`）
- `code !== 0` → 失败，必须展示后端返回的 `message`，**不要自造泛化错误**

---

## 三、HRClaw 接口规范

### 3.1 企微 Tips
`POST https://ntsgw.woa.com/api/sso/message-channel-service/hrclaw/v1/workchat-tips/send`
```json
{
  "receivers": ["员工英文名"],
  "title": "标题，≤100字符",
  "content": "正文，≤2000字符"
}
```

### 3.2 邮件
`POST https://ntsgw.woa.com/api/sso/message-channel-service/hrclaw/v1/mail/send`
```json
{
  "receivers": ["员工英文名"],
  "cc": [],
  "bcc": [],
  "subject": "主题，≤200字符",
  "content": "HTML正文，≤500KB"
}
```

---

## 四、发送 SOP（playwright-cli）

### 4.1 工具准备
```bash
where playwright-cli
# 如未安装：
npm install -g @playwright/cli@latest
```

### 4.2 完整发送流程（5 步）

#### Step 1: 打开浏览器并进入 OA 登录态
```bash
playwright-cli open https://ntsgw.woa.com --browser=msedge --persistent
```
（msedge 不可用时回退 `--browser=chrome`）

#### Step 2: 读取页面快照检查登录状态
```bash
playwright-cli snapshot
```
读 `.playwright-cli/page-*.yml`：
- URL 仍为 `std.passport.woa.com/...signin.ashx` → 进 Step 3
- URL 已为 `ntsgw.woa.com/...` → 已登录，跳到 Step 4

#### Step 3: 完成 OA 登录
- **场景 A · 已检测到登录账号**（快照含"检测到当前已登录账号"）：
  ```bash
  playwright-cli click <ref>   # ref 号按快照中"快速登录"按钮的实际值
  ```
- **场景 B · 未检测到登录账号**：
  - 提示用户："请在打开的浏览器窗口完成 OA 登录"
  - 用户登录后重新执行 Step 2 确认

#### Step 4: 在浏览器上下文执行 fetch

**关键约束**：
- `playwright-cli run-code` 在 PowerShell 中参数易被转义，**必须先把 JS 写入临时文件再执行**
- fetch 用 `credentials: 'include'`，浏览器自动带同域 Cookie
- **代码不读 `document.cookie`，不打印任何认证信息**
- 请求 URL 用绝对路径 `/api/sso/...`，依赖浏览器自动补全域

**邮件发送 JS 模板**（`_hrclaw_send.js`）：
```js
async page => {
  const mailBody = {
    receivers: ['<receiver>'],
    cc: [],
    bcc: [],
    subject: '<subject>',
    content: '<html-content>'
  };
  const response = await page.evaluate(async (body) => {
    const res = await fetch('/api/sso/message-channel-service/hrclaw/v1/mail/send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }, mailBody);
  return JSON.stringify(response);
}
```

**企微 Tips 发送 JS 模板**：
```js
async page => {
  const tipsBody = {
    receivers: ['<receiver>'],
    title: '<title>',
    content: '<text-content>'
  };
  const response = await page.evaluate(async (body) => {
    const res = await fetch('/api/sso/message-channel-service/hrclaw/v1/workchat-tips/send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  }, tipsBody);
  return JSON.stringify(response);
}
```

执行：
```bash
cd "<工作目录>"
$code = [System.IO.File]::ReadAllText("_hrclaw_send.js", [System.Text.Encoding]::UTF8)
playwright-cli run-code $code
```

#### Step 5: 清理
```bash
playwright-cli close
rm -f _hrclaw_send.js
```

---

## 五、安全红线（CRITICAL · 4 条）

1. **Cookie 不出浏览器**：仅通过 `credentials: 'include'` 让浏览器自动携带，**不通过 `document.cookie` 读取，不传递到代码、不打印、不写文件**
2. **临时文件即用即删**：`_hrclaw_send.js` 在请求完成后立即 `rm`
3. **不展示认证信息**：对话输出仅展示 `code` / `msgId` / `message`，**不展示** Cookie / Token / 完整请求头
4. **零持久化**：不写 localStorage、不写文件系统、不写环境变量、不写任何持久化存储

---

## 六、调用方职责（业务 skill 该做的事）

调用本 skill 之前，业务 skill 必须自己处理好：

1. **收件人格式校验**：必须是 loginName，否则先反问业务方修正
2. **业务模板生成**：标题、正文（含数据填充、隐私脱敏）由业务 skill 自己写
3. **二次确认**：发送前向用户展示「通道 / 通知对象 / 收件人 / 标题」并等待用户确认
4. **隐私边界**：不在正文里塞手机号 / 邮箱 / 身份证等敏感字段
5. **业务上下文**：传入合理的 `<工作目录>` 给 Step 4

调用本 skill 之后，业务 skill 负责：

1. **解读返回**：`code === 0` 给用户展示 `msgId`，`code !== 0` 展示 `message` 并按错误码建议处理
2. **失败兜底**：浏览器自动化失败时，退化为提供可复制的 Console 代码给用户手动执行（详见 §八）
3. **业务埋点**：发送结果上报到业务 skill 自己的埋点事件

---

## 七、错误码处理建议

| code | 含义 | 建议 |
|---|---|---|
| 40001 | 入参错误 | 检查收件人英文名格式、标题/正文长度 |
| 40301 | 发送人黑名单 | 联系管理员 |
| 40302 | 发送域名黑名单 | 联系管理员 |
| 40901 | 触发频率限制 | 提示用户 60 秒后重试 |
| 50000 | 服务端异常 | 提示稍后重试 |

---

## 八、异常处理 / 兜底链路

| 异常 | 处理 |
|---|---|
| `playwright-cli` 未安装 | 提示用户 `npm install -g @playwright/cli@latest` |
| Edge 浏览器未安装 | 改用 `--browser=chrome` |
| OA 登录页无快速登录入口 | 提示用户在浏览器手动完成 OA 登录后回话「继续」 |
| OA 登录后 fetch 仍 `code !== 0` | 展示后端 `message`，按 §七 错误码建议处理 |
| fetch 报网络错误 / CORS | 确认当前页面域为 `ntsgw.woa.com`（同域不应触发 CORS） |
| 浏览器自动化整体不可用 | 退化为 **手动 Console 方案**（让用户在已登录 OA 的浏览器 F12 Console 粘贴可复制的 fetch 代码执行） |

---

## 九、调用样例（给业务 skill 参考）

### 9.1 业务 skill 调本 skill 的标准方式

```
（在业务 skill 内部）

# 1. 业务 skill 准备好通知数据
mailBody = {
  channel: "mail",
  receivers: ["ansleyyu"],
  subject: "[校招保温] 您名下 4 位同学保温信息同步",
  content: "<p>你好，你已被指定为以下 4 位同学的导师...</p>",
  cc: [],
  bcc: []
}

# 2. 业务 skill 完成对用户的二次确认

# 3. 业务 skill use_skill 调本 skill
use_skill("hrclaw-messenger")
（把 mailBody 信息作为上下文传入）

# 4. hrclaw-messenger 完成 §四 5 步发送 SOP

# 5. 业务 skill 接收返回，呈现给用户
```

### 9.2 多通道（同时发邮件 + 企微 Tips）

业务 skill 分两次调用本 skill，分别 `channel: "mail"` 和 `channel: "workchat-tips"`，两次发送共用同一个浏览器会话（Step 1 只做一次，Step 4 跑两遍 fetch，最后 Step 5 一次性清理）。

---

## 十、独立触发（兜底，非主用法）

虽然本 skill 主要由其他 skill 调用，但也允许用户**直接喊**，例如："给 ansleyyu 发个邮件，标题 XXX，正文 YYY"——这时 hrclaw-messenger 自己问清楚 channel、收件人、标题、正文，做二次确认后发送。

⚠️ 直接触发时，本 skill **不替用户写业务模板**——只接收成型的标题/正文，不会自己加保温话术之类的业务逻辑。

---

## 十一、版本

- v1.0.0 — 2026-06-09 · 从 warming-recruit-manager 抽出公共能力，统一封装 HRClaw 邮件 / 企微 Tips 通知链路
