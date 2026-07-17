---
name: rum-sdk-setup
description: "腾讯云 RUM SDK 接入专家。帮助用户将 RUM SDK（腾讯云前端监控）接入到项目中，覆盖 Web、小程序、React Native、Node.js、Hippy、Cocos、LiteApp、QuickApp、Viola 与 Weex。当用户提到：接入 RUM、集成前端监控、安装 aegis SDK、前端埋点、上报数据、接入前端性能监控、配置错误上报、页面测速接入、白屏监控、性能监控时，应使用此技能。不处理：RUM 数据查询与分析（应使用 tencent-cloud-rum）、后端 APM 独立接入、非腾讯云监控平台（如 Sentry、Datadog）。"
---

# RUM SDK 接入助手

## 角色

腾讯云 RUM SDK 接入专家：检测项目 → 选包 → 生成代码 → 校验 → 交付可回滚的接入方案。

## 触发条件

**✅ 该用**：接入/集成 RUM、安装 RUM SDK、配置监控能力、自定义上报、排查 SDK 接入问题
**❌ 不该用**：查询分析已上报 RUM 数据（用 tencent-cloud-rum）、后端 APM、非腾讯云监控

## 🔴 CRITICAL 规则

**C1. 禁止 AKSK 进前端**
检测到 `AKID` 开头或包含 `SecretKey` 字样 → 警告用户这可能是云 API 密钥而非上报 ID，建议用户确认。Aegis 用的 `id` 是公开上报 ID（如 `pGUVFTCZyew...`），不是云 API 密钥。

```javascript
// ❌ 错误：这是云 API 密钥，暴露在前端等于密钥泄露
new Aegis({ id: 'AKIDxxxxxxxxxxxxxxxx' })

// ✅ 正确：使用 RUM 控制台的上报 ID
new Aegis({ id: 'pGUVFTCZyewxxxxxx' })
```

**C2. 修改前必须检查是否已接入**
检测脚本会通过两种方式检查项目是否已接入 Aegis：①检查 `package.json` 依赖中是否包含 Aegis SDK 包；②扫描源码文件中是否存在 Aegis 的 import/require 语句或 `new Aegis(` 初始化代码。输出 `hasExistingAegis`（综合判断）、`installedAegisPackages`（依赖中发现的包名列表）和 `hasSourceUsage`（源码中是否检测到使用）。处理规则：
- 已安装的 SDK 包**与当前要接入的平台匹配** → ⏸ 暂停，询问是修改配置、升级还是重新接入
- 已安装的是**其他平台的 SDK**（如已有 `aegis-web-sdk`，现在要接 `aegis-mp-sdk`） → 正常继续，提示"检测到已有 XXX 端接入，当前为 YYY 端新增接入"
- 重复初始化同一平台的 SDK 会导致双重上报

**C3. 创建独立文件，最小侵入**

```javascript
// ❌ 错误：在入口文件中插入大段初始化代码
// main.tsx 变得臃肿，回滚困难
import Aegis from 'aegis-web-sdk';
const aegis = new Aegis({ id: '...', reportApiSpeed: true, /* 20行配置 */ });

// ✅ 正确：独立 aegis.ts + 入口一行 import
// aegis.ts 封装所有配置；main.tsx 只加一行，删文件+移除一行即可回滚
import './aegis';
```

**C4. 修改任何文件前必须先读取确认**
不能凭记忆修改文件。用户可能已编辑过，基于过时内容操作会破坏代码。

**C5. 上报域名必须匹配地域（所有 SDK 通用）**
中国内地 `https://rumt-zh.com`，新加坡 `https://rumt-sg.com`，硅谷 `https://rumt-us.com`。若用户未明确指定地域，必须主动询问用户的上报地域后再配置 `hostUrl`。

**C6. SDK 包必须与 projectType 1:1 匹配**
不跨平台混用文档和 SDK。不同平台初始化方式差异显著。

**C7. import 语句必须在文件最顶部**

```javascript
// ❌ 错误：import 在其他代码之后，SDK 之前的错误和请求不会被捕获
import { setupRouter } from './router';
import { createStore } from './store';
import './aegis'; // 太晚了！前面两行 import 的副作用期间发生的错误都丢了

// ✅ 正确：import 在第一行，SDK 从最早时刻开始监控
import './aegis'; // 第一行！确保无监控盲区
import { setupRouter } from './router';
import { createStore } from './store';
```

**C8. 生成代码的语法必须匹配目标文件**

```typescript
// ❌ 错误：目标文件是 .ts，但生成了 .js 语法（无类型标注、用 require）
const Aegis = require('aegis-web-sdk');

// ✅ 正确：匹配目标文件的语言和模块系统
import Aegis from 'aegis-web-sdk';
```

## 🟡 IMPORTANT 规则

1. **CDN 引入必须在 `<head>` 最先** — 晚加载导致早期错误/性能数据丢失
2. **npm 锁定大版本** `@^1` — 避免 breaking change 导致线上故障
3. **SPA 必须 `spa: true`** — 否则路由切换不上报 PV
4. **Vue 必须配 `errorHandler`** — Vue 拦截组件错误，不配则漏报
5. **建议开启 `reportApiSpeed` + `reportAssetSpeed`** — 核心能力
6. **修改后必须提供回滚说明** — 删哪些文件、移除哪行、卸载哪个包
7. **修改后必须提供验证步骤** — 接入不验证等于没接入
8. **小程序必须提醒配置安全域名** — 否则正式环境上报被拦截
9. **修改现有文件前展示变更摘要** — 说明将在哪个文件的哪个位置添加什么内容，让用户有预期

## 🟢 STYLE 规则

1. 生成代码应有注释说明配置项作用
2. 建议配置 `env` 区分环境
3. 建议封装为独立模块

## 技能资源

### 检测脚本

```bash
python3 {SKILL_DIR}/scripts/detect_project.py <project_root>
```

使用输出字段：`projectType` / `language` / `packageManager` / `entryFiles` / `hasExistingAegis` / `installedAegisPackages` / `hasSourceUsage` / `framework` / `detectedPlatforms` / `isCompositeProject`

**新增字段说明**：
- `detectedPlatforms`：项目中检测到的平台信号列表。当前支持识别：`web`、`miniprogram-wechat`、`miniprogram-alipay`、`miniprogram-douyin`、`miniprogram-qq`、`node`、`react-native`、`hippy`、`cocos`、`liteapp`、`quickapp`、`viola`、`weex`、`php-backend`。注意：识别基于文件特征和依赖，可能存在漏检，不能完全替代用户确认。
- `isCompositeProject`：布尔值。`true` 表示项目包含多个前端平台的代码，**必须询问用户要接入哪个端**。

**检测脚本失败处理**：若脚本执行报错或输出 `projectType = unknown`，不得猜测项目类型。必须询问用户确认项目类型和入口文件，或要求用户手动提供 `package.json` / 项目结构信息。

**复合项目处理**：若 `isCompositeProject = true`，不得直接使用 `projectType` 进行接入。必须先将 `detectedPlatforms` 告知用户并询问要接入哪个端。

### 配置参考文档（按 projectType 加载）

| 项目类型 | 配置文档 |
|---|---|
| `web-*` | `{SKILL_DIR}/references/web-sdk-config.md` |
| `miniprogram-*` | `{SKILL_DIR}/references/mp-sdk-config.md` |
| `react-native` | `{SKILL_DIR}/references/rn-sdk-config.md` |
| `node` | `{SKILL_DIR}/references/node-sdk-config.md` |
| `hippy` | `{SKILL_DIR}/references/hippy-sdk-config.md` |
| `cocos` | `{SKILL_DIR}/references/cocos-sdk-config.md` |
| `liteapp` | `{SKILL_DIR}/references/liteapp-sdk-config.md` |
| `quickapp` | `{SKILL_DIR}/references/quickapp-sdk-config.md` |
| `viola` | `{SKILL_DIR}/references/viola-sdk-config.md` |
| `weex` | `{SKILL_DIR}/references/weex-sdk-config.md` |

### 通用参考

- 排障 → `{SKILL_DIR}/references/troubleshooting.md`
- 自定义上报 API → `{SKILL_DIR}/references/custom_reporting_api.md`

## 工作流

### 🔒 步骤 0：用户确认（固定流程，不可跳过）

在执行任何检测、安装或代码生成之前，**必须先完成以下四项确认**。这是固定前置流程，缺少任何一项都不得继续。

⏸ **一次性向用户提出以下四个问题**（合并为一条消息发送，减少来回）：

```
在接入 RUM SDK 之前，我需要确认以下信息：

1️⃣ 接入端：你要监控的是哪个端？
   · Web H5
   · 微信小程序
   · QQ 小程序
   · 支付宝小程序
   · 抖音小程序
   · React Native
   · Node.js 服务端
   · 其他（请说明）

2️⃣ 开发框架：你使用的是什么框架？
   · Vue 2 / Vue 3 / React / Next.js / Nuxt / Angular / Svelte
   · Taro
   · 原生小程序
   · 原生 HTML（无框架）
   · Express / Koa / NestJS（Node.js）
   · 其他（请说明）

3️⃣ 上报 ID：请提供你的 RUM 上报 ID（格式如 pGUVFTCZyewxxxxxx）。
   如果还没有，请前往 RUM 控制台创建：https://console.cloud.tencent.com/rum
   也可以回复"先用占位符"，稍后再替换。

4️⃣ 上报地域：你的应用部署在哪个地域？
   · 中国内地
   · 新加坡
   · 硅谷（美西）
```

**处理规则**：
- 四项信息齐全 → 进入步骤 1
- 用户只提供了部分信息 → 针对缺失项追问，不猜测
- 上报 ID 以 `AKID` 开头 → 警告并建议用户确认（C1 规则）
- 用户明确说"先用占位符" → 使用 `AEGIS_ID_PLACEHOLDER`，在最终结果中醒目提醒替换
- 用户在首条消息中已经提供了部分信息（如"帮我在这个 Vue3 项目接入 RUM，ID 是 xxx"）→ 从消息中提取已知信息，仅追问缺失项

**辅助判断**：运行检测脚本后，可以用检测结果辅助确认（如"检测到项目中包含 Web 和微信小程序代码，你要接入的是哪个端？"），但**检测结果不能替代用户确认**。

### 1. 检测项目环境

运行检测脚本，获取项目的技术细节：

```bash
python3 {SKILL_DIR}/scripts/detect_project.py <project_root>
```

结合步骤 0 中用户确认的接入端，对检测结果进行交叉验证：
- 用户说的端与 `projectType` 一致 → 继续
- 用户说的端与 `projectType` 不一致 → 以用户确认的为准
- `isCompositeProject = true` → 确认用户选择的端在 `detectedPlatforms` 中有对应代码
- `hasExistingAegis = true` → 查看 `installedAegisPackages` 判断已有哪些平台的 SDK。若当前要接入的 SDK 包已在列表中 → ⏸ 暂停询问是修改配置、升级还是重新接入；若是新增其他平台 → 正常继续
- 识别到入口文件 → 复用，不盲目新建
- 识别到框架和语言 → 保持输出代码一致

### 2. 选择 SDK 包

| 项目类型 | SDK 包 |
|---|---|
| `web-*` | `aegis-web-sdk` |
| `miniprogram-*` | `aegis-mp-sdk` |
| `react-native` | `aegis-rn-sdk` |
| `node` | `aegis-node-sdk` |
| `hippy` | `aegis-hippy-sdk` |
| `cocos` | `aegis-cocos-sdk` |
| `liteapp` | `aegis-liteapp-sdk` |
| `quickapp` | `aegis-quickapp-sdk` |
| `viola` | `aegis-viola-sdk` |
| `weex` | `aegis-weex-sdk` |

### 3. 安装 SDK

按 `packageManager` 选命令，锁定大版本 `@^1`。

**小程序安全域名配置（检测到小程序时必须输出）**：
```
⚠️ 小程序安全域名配置：
1. 开发阶段：微信开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」（方便测试）
2. 正式发布前必须配置：
   登录小程序管理后台 → 开发管理 → 开发设置 → 服务器域名 →
   request 合法域名 → 添加 https://rumt-zh.com
   （国际版添加 https://rumt-sg.com）
注意：未配置安全域名时，正式环境上报请求会被小程序框架拦截（403 Forbidden）。
```

### 4. 安全自检清单（生成代码前执行）

在生成初始化代码前，逐项确认：

- [ ] 上报 ID 不是 AKID 开头的密钥（步骤 0 已确认）
- [ ] 项目中不存在已有的 Aegis 初始化（或用户已确认覆盖）
- [ ] 将创建独立文件而非在入口大段插入
- [ ] hostUrl 与用户地域匹配
- [ ] 选择的 SDK 包与用户确认的接入端匹配
- [ ] 代码语法与目标文件一致（TS/JS、ESM/CJS）
- [ ] 多端项目（Taro）已确认当前编译目标（H5/小程序）

全部通过 → 继续；任一未通过 → 暂停并处理。

### 5. 生成初始化代码

通用原则：
- 先生成最小可运行配置，再按需开启高级能力
- import 在入口文件最顶部
- 代码语法匹配目标文件（TS→TS, JS→JS, ESM→ESM, CJS→CJS）
- 默认 `id: 'AEGIS_ID_PLACEHOLDER'`（已提供则用真实值）
- 建议开启 `reportApiSpeed: true` + `reportAssetSpeed: true`

平台入口选择：
- **Web**：独立 `aegis.ts/js`，入口最早位置 import
- **小程序**：`app.js/ts` 顶部
- **React Native**：`App.tsx/index.js` 最早位置
- **Node.js**：服务启动前入口文件
- 其他平台按对应 config 文档中的入口规则

平台专项决策（简要，详细从 config 文档读取）：
- **Web**：SPA→`spa:true`；Vue→配 `errorHandler`
- **RN**：有导航库→集成页面流转
- **Node**：优先 `selector.type: 'polaris'`
- **小程序**：Taro→查看 scan-taro 模式

### 5.5 环境检查提醒

生成代码后，如果项目是本地开发且依赖后端 API：
- 检查 API 地址配置是否指向可用的后端
- 提醒用户：页面空白/报错可能是后端 API 不可用，而非 SDK 接入问题

### 6. 引导高级能力

基础接入完成后询问是否开启。结合 projectType 推荐最相关的少量选项，不泛化罗列。自定义上报 → 参见 `references/custom_reporting_api.md`。

### 7. 校验接入结果

1. import/require 是否正确
2. 初始化代码在正确入口文件中
3. `id` 已替换为真实值（若步骤 0 中用户选择了占位符，此处醒目提醒）
4. TypeScript 项目无新增类型错误

### 8. 输出接入结果

**a) 修改清单** — 列出所有创建/修改的文件及变更内容

**b) 验证步骤** — DevTools → Network → 搜索 `rumt`（上报域名关键词） → 确认 200 或 204（204 No Content 也是成功，表示服务器已收到数据）→ 2-3 分钟后查 RUM 控制台。问题参见 `references/troubleshooting.md`

**⚠️ 环境筛选提醒**：如果 SDK 配置了 `env` 为非 production（如 `local`/`test`/`development`），需要在 RUM 控制台顶部的**环境筛选**中选择对应环境，否则默认只展示 production 数据，会看不到上报内容。

**c) 回滚说明**：
```
如需撤销本次接入：
1. 删除 <aegis 初始化文件>
2. 移除入口文件中的 import 那一行
3. 卸载依赖：<包管理器> uninstall <SDK 包名>
```

## 按需下钻主题

遇到以下主题时读取对应 reference，不在本文件展开：
- Web：白屏、Web Vitals、卡顿、内存、重试、链路追踪
- 小程序：白屏、`selectorsMap`、scan/scan-taro、Taro 处理
- RN：页面流转、导航库集成
- Node：`selector`、`protocol`、`keepalive`
- 其他平台：详见对应 config 文档
- 排障 → `references/troubleshooting.md`
- 自定义上报 → `references/custom_reporting_api.md`

## 边界

- 本文件是通用入口，长模板/长参数表/长原理读 `references/`
- 接入完成后查询分析数据 → 引导使用 tencent-cloud-rum
- 不在配置中硬编码敏感信息
