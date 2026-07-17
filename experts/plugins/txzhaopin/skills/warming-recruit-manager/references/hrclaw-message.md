# HRClaw 邮件 / 企微 Tips 通知 SOP

用于保温场景下，招聘经理向导师或直接上级发送候选人保温信息。只处理**通知导师/上级**，不用于群机器人日报；群推送走 `references/reminder.md`。

## 1. 通知通道与认证方式

### 1.1 认证前提：使用者 OA SSO Cookie

HRClaw 接口依赖**当前使用者本人**在 OA / SSO 域下的登录态。发送邮件或企微 Tips 时，必须使用浏览器自动化方案在本机浏览器会话中读取并携带**使用者自己的 OA SSO Cookie**，不得使用开发者、机器人、共享账号或硬编码 Cookie。

**执行要求**：

1. 使用浏览器自动化打开 `https://ntsgw.woa.com` 或 HRClaw 接口同域页面，确认当前使用者已完成 OA/SSO 登录。
2. 从浏览器上下文读取该域下的 SSO Cookie，并仅用于本次 `fetch` / XHR 请求的同域认证。
3. Cookie 只允许在浏览器自动化会话内使用；不得在对话、日志、Excel、Markdown、代码文件中展示、复制、持久化或转发。
4. 若浏览器中没有使用者登录态，先提示使用者在浏览器完成 OA 登录；不得降级为后台直连、固定 Token、他人 Cookie 或伪造认证。
5. 调用完成后只展示接口业务结果（如 `msgId` / `message`），不得回显 Cookie、请求头或完整认证信息。

### 1.2 企微 Tips

`POST https://ntsgw.woa.com/api/sso/message-channel-service/hrclaw/v1/workchat-tips/send`

请求体：

```json
{
  "receivers": ["员工英文名"],
  "title": "标题，≤100字符",
  "content": "正文，≤2000字符"
}
```

### 1.3 邮件

`POST https://ntsgw.woa.com/api/sso/message-channel-service/hrclaw/v1/mail/send`

请求体：

```json
{
  "receivers": ["员工英文名"],
  "cc": [],
  "bcc": [],
  "subject": "主题，≤200字符",
  "content": "HTML正文，≤500KB"
}
```

## 2. 收件人规则

- 收件人只能是员工英文名 loginName，例如 `zhangsan`。
- 不接受邮箱，不接受中文名；出现 `@` 或不符合 `^[A-Za-z][A-Za-z0-9_\-]{1,30}$` 时，先让用户修正。
- 默认收件人：
  - 通知导师：使用 `tutor_name_en`
  - 通知上级：使用 `lead_name_en`
- 允许招聘经理在发送前修改发送对象。
- 企微 Tips 单次最多 100 人；邮件收件人 / 抄送 / 密送合计最多 200 人。

## 3. 保温通知模板（企微 Tips 与邮件保持一致）

### 3.1 单人通知模板

标题：

```text
[校招保温] {候选人姓名}同学保温信息同步
```

正文：

```text
你好，你已被指定为{候选人姓名}同学的{导师/直接上级}，请关注该同学签约后保温与入职前沟通。

一、同学基本信息
- 姓名：{候选人姓名}
- 员工子类型：{offer_staff_subtype_name，如"毕业生"/"应届实习生"/"日常实习生"；缺失时写"暂无"}
- 人选标签：{candidate_tag，如"⭐青云计划"/"⭐青云实习"/"⭐产品经理培训生"；普通人选写"普通"}
- 学校/学历：{最高学校}（{最高学历}）
- 专业：{专业}
- 岗位：{岗位}
- 工作地：{工作城市}
- 预计入职：{预计入职日期}（{入职倒计时/已入职/待定}）
- 当前保温阶段：{保温阶段}

二、真实简历链接
{真实 resume_link；若仍无法取得，写"暂无可用简历链接，请在招聘系统按姓名/简历ID检索"}

三、同学联系方式
请通过上方真实简历链接登录招聘系统查看联系方式。

四、招聘经理企微
{招聘经理中文名}（企微/英文名：{recruit_manager_en}）

五、你作为{导师/直接上级}的建议动作
{按"导师/上级"角色 + 当前保温阶段，从下方"角色标准动作"中挑选 2-3 条最贴合的动作列出，让对方清楚下一步要做什么}

{高潜人才（人选标签非"普通"）追加一句：该同学为高潜人选（{candidate_tag}），建议加强关注、在资源与发展规划上给予倾斜，必要时由更高级别管理者一同参与沟通}

建议你尽快完成首次沟通，了解同学近况、入职安排和潜在风险。如需更多信息，可通过上述企微联系招聘经理。
```

#### 角色标准动作（按角色 + 阶段挑选，嵌入"五、建议动作"）

> 依据《学生人才吸引保温全景》三方标准动作，按收件人角色与当前保温阶段精选 2-3 条，避免一次罗列全部。

**导师**：
1. 接到通知后 1 周内首次沟通，做自我介绍、建立联系；
2. 分享团队技术氛围与个人成长经历，建立专业认同；
3. 解答岗位 / 技术 / 团队疑问，适度分享行业动态与学习资料；
4. 入职前帮助做好技术与心理准备，降低入职焦虑；
5. 关注情绪变化，发现异常及时反馈招聘经理。

**直接上级**：
1. 接到通知后 2 周内沟通，欢迎加入团队；
2. 介绍团队业务方向、文化与工作模式；
3. 描绘岗位发展路径与成长空间，必要时分享团队成果增强吸引力；
4. 关注合理诉求，在职责范围内提供支持；
5. 入职前做好团队接纳准备，让同学感受到被重视。

**阶段裁剪建议**：签约初期重"首次建联 + 欢迎"；保温中期重"持续互动 + 答疑 + 资料同步"；入职前期重"入职准备 + 接纳 + 缓解焦虑"。

### 3.2 多人合并通知模板

当一次通知涉及 **2 名及以上** 同学时，使用表格合并展示。**必须为每位同学注明员工子类型**，以便导师/上级区分毕业生和不同类型实习生的保温重点。

标题：

```text
[校招保温] 您名下 {N} 位同学保温信息同步
```

正文：

```text
你好，你已被指定为以下 {N} 位同学的{导师/直接上级}，请关注这些同学签约后保温与入职前沟通。

一、同学基本信息

| 姓名 | 人选标签 | 员工子类型 | 学校/学历 | 专业 | 岗位 | 组织 | 工作地 | 预计入职 |
|---|---|---|---|---|---|---|---|---|
| {姓名} | {candidate_tag，高潜显示⭐青云计划/⭐青云实习/⭐产品经理培训生，普通显示—} | {offer_staff_subtype_name} | {最高学校}（{最高学历}） | {专业} | {岗位} | {组织} | {工作地} | {预计入职日期} |

二、真实简历链接
{逐人列出真实 resume_link；若仍有无法取得的，写"暂无可用简历链接，请在招聘系统按姓名/简历ID检索"}

三、同学联系方式
请通过上方真实简历链接登录招聘系统查看联系方式。

四、招聘经理企微
{招聘经理中文名}（企微/英文名：{recruit_manager_en}）

五、你作为{导师/直接上级}的建议动作
{按"导师/上级"角色 + 各同学当前保温阶段，从"角色标准动作"中精选 2-3 条通用动作列出}
{若名单中含高潜人才（人选标签非"—"），追加一句：其中 {高潜同学姓名} 为高潜人选，建议优先关注、资源倾斜，必要时由更高级别管理者参与沟通}

建议你尽快与这些同学建立联系，了解近况及入职安排。如需更多信息，可通过上述企微联系招聘经理。
```

**多人模板关键规则**：
- `offer_staff_subtype_name`（员工子类型）为必填列，不能省略；数据来自 `Report_School_Recruiti_Info_List` 的 `offer_staff_subtype_name` 字段
- 「人选标签」列由派生 `candidate_tag` 生成（口径见 `sql-templates.md`）：高潜显示 ⭐青云计划 / ⭐青云实习 / ⭐产品经理培训生，普通显示"—"；含高潜同学时须在"五、建议动作"中点名提示重点关注
- 若某位同学的员工子类型缺失，写"暂无"而非留空，事后通过 zhaopin-mcp / recruit-mcp 补查
- 邮件版本将表格转为 HTML `<table>` + 内联样式（蓝色表头）；企微 Tips 保留 Markdown 表格
- 邮件版本中简历链接转可点击 `<a href="...">点击查看</a>`

### 3.3 隐私边界

- 不要在对话、企微 Tips 或邮件模板中直接抓取或展示候选人手机号、邮箱、微信号。
- 联系方式统一用兜底话术："请通过上方真实简历链接登录招聘系统查看联系方式"。
- 如果用户要求自动抓取联系方式，说明该能力暂不启用，并引导通过招聘系统详情页查看。

## 4. 发送前检查

### 4.1 真实简历链接检查

发送前必须确认模板中已带入同学的**真实 `resume_link`**：

- 优先使用 `T_LINK` 查询中 `lastest_flow_flag_name = '是'` 的 `resume_link`
- 若 `resume_link` 为空但 `offer_link` 可用，仍需优先补查简历链接；不能只放录用链接替代"真实简历链接"
- 若 hr-ai-data 链接为空或脱敏，使用 zhaopin-mcp / `recruit-mcp` 补查当前最新简历详情或流程详情中的简历 URL
- 若最终仍无真实简历链接，正文必须明确写"暂无可用简历链接，请在招聘系统按姓名/简历ID检索"

### 4.2 发送二次确认

发送前必须二次确认：

```text
请二次确认是否发送通知：

通知方式：企微 Tips / 邮件
通知类型：导师 / 直接上级
发送对象：{receivers}
消息标题：{title}

确认后将立即发送。
```

用户确认前不得调用接口。

## 5. 结果反馈

若浏览器自动化无法取得使用者本人 OA SSO Cookie，必须先提示使用者完成 OA/SSO 登录，不能继续发送，也不能要求用户复制 Cookie。

接口返回：

```json
{ "code": 0, "message": "success", "data": "msgId" }
```

- `code === 0`：必须展示 `msgId`，如 `邮件发送成功，消息 ID：...`。
- `code !== 0`：必须展示后端返回的 `message`，不要自造泛化错误。

常见错误建议：

| code | 建议 |
|---|---|
| 40001 | 检查收件人英文名、标题/正文长度、附件限制 |
| 40301 | 当前发送人被黑名单限制，联系管理员 |
| 40302 | 当前页面域名被黑名单限制，联系管理员 |
| 40901 | 触发频率限制，60 秒后重试 |
| 50000 | 服务端异常，稍后重试 |

## 6. 浏览器自动化发送 SOP（playwright-cli）

HRClaw 接口需要**使用者本人**的 OA/SSO 登录态 Cookie，全程由浏览器自动化控制在同一会话内完成，**不要求用户手动复制 Cookie**。

### 6.1 工具准备

```bash
# 检查 playwright-cli 是否已安装
where playwright-cli
# 如未安装
npm install -g @playwright/cli@latest
```

### 6.2 完整发送流程

#### Step 1：打开浏览器并完成 OA 登录

```bash
# 使用 Edge + 持久化配置打开 ntsgw.woa.com
playwright-cli open https://ntsgw.woa.com --browser=msedge --persistent
```

#### Step 2：检查登录状态

```bash
# 读取页面快照
playwright-cli snapshot
```

读取快照文件（`.playwright-cli/page-*.yml`）：

- 若页面 URL 仍为 `std.passport.woa.com/...signin.ashx` → 进入 Step 3 登录
- 若页面 URL 已变为 `ntsgw.woa.com/...` → 登录已成功，跳到 Step 4

#### Step 3：通过 OA 快速登录

快照中常见两种场景：

**场景 A**：检测到已登录账号（快照中有 `检测到当前已登录账号` + 英文名）：
```bash
# 点击"快速登录"按钮（ref 号按快照实际值）
playwright-cli click e33
```

**场景 B**：未检测到已登录账号：
- 告知用户"请在打开的浏览器窗口完成 OA 登录"
- 用户登录后手动确认，然后重新执行 Step 2 确认登录已成功

#### Step 4：在浏览器上下文中发送 HRClaw 请求

由于 `playwright-cli run-code` 的参数在 PowerShell 中可能被转义，**必须先将 JS 代码写入文件再执行**：

1. 写入临时 JS 文件（示例为邮件发送）：

```js
// _hrclaw_send.js
async page => {
  const mailBody = {
    receivers: ['ansleyyu'],
    cc: [],
    bcc: [],
    subject: '[校招保温] 您名下 4 位同学保温信息同步',
    content: '<p>你好，你已被指定为以下 4 位同学的导师：</p>...'
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

2. 执行文件：

```bash
cd "{skill工作目录}";
$code = [System.IO.File]::ReadAllText("_hrclaw_send.js", [System.Text.Encoding]::UTF8);
playwright-cli run-code $code
```

**关键约束**：
- JS 代码中使用 `credentials: 'include'`，浏览器自动携带当前域下的所有 Cookie，**代码中不读取、不传递、不打印 Cookie**
- 请求 URL 使用绝对路径 `/api/sso/...`，依赖浏览器自动补全域（`ntsgw.woa.com`）
- 成功后返回 `{ code: 0, message: "success", data: "msgId" }`

#### Step 5：清理

```bash
# 关闭浏览器
playwright-cli close
# 删除临时 JS 文件
```

### 6.3 企微 Tips 发送

与邮件发送流程完全相同，仅替换 JS 中的 fetch URL 和请求体：

```js
const tipsBody = {
  receivers: ['ansleyyu'],
  title: '[校招保温] 您名下 4 位同学保温信息同步',
  content: '你好，你已被指定为以下 4 位同学的导师：\n...'
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
```

### 6.4 异常处理

| 异常 | 处理方式 |
|---|---|
| `playwright-cli` 未安装 | 执行 `npm install -g @playwright/cli@latest` |
| Edge 浏览器未安装 | 改用 `--browser=chrome` |
| OA 登录页无法快速登录（无已登录账号） | 提示用户在浏览器窗口手动完成 OA 登录，确认后继续 |
| OA 登录成功但 fetch 返回 `code !== 0` | 展示后端 `message`，按第 5 节常见错误建议处理 |
| fetch 报网络错误 / CORS | 确认当前页面域为 `ntsgw.woa.com`，同域请求不应触发 CORS |
| 使用者拒绝浏览器自动化 | 回退到手动方案：按本文第 7 节提供可复制的浏览器 Console 代码 |

### 6.5 安全红线

1. **Cookie 不出浏览器**：Cookie 仅在 `page.evaluate` 内的 `fetch({ credentials: 'include' })` 中由浏览器自动携带，不通过 `document.cookie` 或其他方式读取
2. **临时文件即用即删**：`_hrclaw_send.js` 在请求完成后立即删除
3. **不展示认证信息**：对话输出只展示 `code` / `msgId` / `message`，不展示 Cookie、Token、请求头
4. **不做持久化**：不将 Cookie 写入 localStorage、文件系统、环境变量或任何持久化存储

---

## 7. 页面 / 手动备用方案

当浏览器自动化不可用时（如 playwright-cli 安装失败、浏览器无法启动），回退为**提供可复制的浏览器 Console 代码**，由用户在已登录 OA 的浏览器 F12 Console 中粘贴执行。

详见本文档第 3 节的模板正文格式；手动方案中邮件 HTML 的 `<a href="...">` 链接和企微 Tips 文本保持与自动化方案一致。

页面集成建议：

- 在候选人卡片或详情页拆成两个入口：`对导师`、`对上级`
- 弹窗内提供通道选择：`企微 Tips` / `邮件`
- 发送对象输入框默认带入对应责任人英文名，允许招聘经理修改
- 发送前展示真实简历链接、员工子类型、认证方式和隐私边界，等待招聘经理确认
