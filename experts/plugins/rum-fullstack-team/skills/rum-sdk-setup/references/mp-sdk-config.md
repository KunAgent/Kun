# Aegis 小程序 SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/mp-sdk/src` 与相关 `packages/core/src` 源码整理而成。
> 它覆盖小程序 SDK 的配置项、运行时行为、平台差异与接入模式。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-mp-sdk -->
- **npm**：`aegis-mp-sdk`
- **支持运行时**：微信（`wx`）、QQ（`qq`）、支付宝（`my`）、抖音 / TikTok（`tt`）小程序
- **推荐上报域名（国内）**：`https://rumt-zh.com`
- **推荐上报域名（国际）**：`https://rumt-sg.com`

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-mp-sdk';
```

### ES Module 兼容性（TypeScript）

如果 TS 项目里 default import 失败，可以任选一种方式：

**方案 1**：开启 `esModuleInterop`
```json
{
  "compilerOptions": {
    "esModuleInterop": true
  }
}
```

**方案 2**：使用命名空间导入
```typescript
import * as Aegis from 'aegis-mp-sdk';
```

**方案 3**：使用 CommonJS `require`
```javascript
const Aegis = require('aegis-mp-sdk');
```

---

## 完整配置参数

### 1. 必填参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | RUM 控制台分配的项目上报 ID。**必填**。 |

### 2. 身份与元数据

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `uin` | `string \| number` | - | 用户标识。适合用于白名单匹配与用户级问题定位 |
| `version` | `string \| number` | `0` | 业务版本标记（SDK 运行时也可能单独暴露 SDK 版本） |
| `env` | `string` | `'production'` | 环境值：`production` / `development` / `gray` / `pre` / `daily` / `local` / `test` / `others` |
| `aid` | `boolean \| string` | `true` | 匿名设备 ID。`true` 表示自动生成并持久化到小程序存储（`AEGIS_ID`）；传字符串则直接使用 |
| `ext1` ~ `ext3` | `string` | - | 可直接用于控制台过滤的自定义维度 |
| `ext4` ~ `ext10` | `string` | - | 扩展维度（需要控制台字段映射） |

### 3. URL 配置

未手动覆盖时，所有上报 URL 都会从 `hostUrl` 推导。

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志地址 |
| `pvUrl` | `string` | `hostUrl + '/collect/pv'` | PV 地址 |
| `whiteListUrl` | `string` | `hostUrl + '/collect/whitelist'` | 白名单地址。传 `''` 可禁用白名单请求 |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | API / 资源测速地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |
| `performanceUrl` | `string` | `hostUrl + '/speed/performance'` | 页面性能地址 |
| `setDataReportUrl` | `string` | `hostUrl + '/speed/miniProgramData'` | `setData` / `loadPackage` 数据地址 |
| `memoryUrl` | `string` | `hostUrl + '/memory'` | 内存监控地址 |
| `pageUrl` | `string` | 当前小程序页面路径 | 覆盖 `from` 页面维度 |

### 4. 上报控制

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `delay` | `number` | `1000` | 普通日志的合并 / 节流窗口（ms） |
| `repeat` | `number \| object` | `60` | 重复日志上报限制（`0` 表示无限制） |
| `random` | `number` | `1` | `[0,1]` 范围的采样率 |
| `speedSample` | `boolean` | `true` | 测速日志是否应用重复限制策略 |
| `reportImmediately` | `boolean` | `true` | 为 `false` 时，数据会缓存到 `aegis.ready()` 再发送 |
| `enableHttp2` | `boolean` | `false` | 是否在支持的平台上为上报请求打开 HTTP/2 选项 |
| `platform` | `'wx' \| 'my' \| 'tt' \| 'qq'` | 自动识别 | 强制指定平台，而不是运行时自动识别 |

### 5. 功能开关

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `onError` | `boolean` | `true` | JS / Promise / 网络 / 云调用 / 页面不存在 / 懒加载错误监控 |
| `reportApiSpeed` | `boolean` | `false` | API 测速监控 |
| `reportAssetSpeed` | `boolean` | `false` | 通过 Performance observer 采集静态资源测速 |
| `reportLoadPackageSpeed` | `boolean` | `true` | 分包下载速度监控 |
| `pagePerformance` | `boolean` | `true` | 页面性能指标 |
| `spa` | `boolean` | `false` | 页面切换时自动上报路由 PV |
| `device` | `boolean` | `true` | 设备 / 网络维度采集 |
| `websocketHack` | `boolean` | `false` | WebSocket 错误拦截 |
| `crashMonitor` | `boolean \| CrashMonitorConfig` | `false` | 崩溃 / 异常退出推断 |
| `lagMonitor` | `boolean \| LagMonitorConfig` | `false` | 主线程卡顿监控 |
| `memoryMonitor` | `boolean \| MemoryMonitorConfig` | `false` | OOM 告警监控 |
| `blankScreen` | `boolean \| BlankScreenConfig` | `false` | 多信号白屏检测 |

---

## 6. API 配置（`api` 对象）

小程序端 `api` 继承 core 的 API 字段，并支持小程序 trace 扩展：

```javascript
api: {
  // 详情采集
  apiDetail: true,
  enableResDetail: false,
  reportRequest: false,

  // 返回码识别
  retCodeHandler(data, url, xhr, payload) {
    try {
      const body = typeof data === 'string' ? JSON.parse(data) : data;
      return { isErr: body.code !== 0, code: body.code };
    } catch (e) {
      return { isErr: false, code: 0 };
    }
  },
  ret: ['ret', 'retcode', 'code', 'errcode'],

  // 脱敏处理
  reqParamHandler(data, { url }) { return data; },
  resBodyHandler(data, { url, ctx }) { return data; },

  // Header 采集
  reqHeaders: ['content-type', 'x-request-id'],
  resHeaders: ['content-type', 'x-request-id'],

  // 资源类型覆盖
  resourceTypeHandler(url) {
    if (url.includes('/api/')) return 'fetch';
    return '';
  },

  // 分布式追踪
  injectTraceHeader: 'traceparent',
  injectTraceUrls: [/^https:\/\/api\.example\.com/],
  injectTraceIgnoreUrls: [/\/health$/],
  traceFlag: 1,
}
```

### `reportApiSpeed` 扩展写法

```javascript
reportApiSpeed: {
  urlHandler(url, payload) {
    return url.replace(/\/users\/\d+/, '/users/:id');
  }
}
```

---

## 7. 小程序专有配置

### 7.1 `setDataReportConfig`

```typescript
setDataReportConfig?: {
  disabled?: boolean;      // 默认 false
  timeThreshold?: number;  // 默认 30ms
  withDataPaths?: boolean; // 默认 true
}
```

### 7.2 `crashMonitor`

```typescript
crashMonitor?: boolean | {
  enabled?: boolean; // 接口预留
}
```

实际行为：
- 使用 session 正常退出标记策略（`onAppHide` / `onAppEnterBackground`）
- 在下一次冷启动时检测上次是否异常退出
- 结合 `onMemoryWarning` 历史记录标记疑似 OOM

### 7.3 `lagMonitor`

```typescript
lagMonitor?: boolean | {
  threshold?: number;          // 默认 2000ms
  noResponseThreshold?: number; // 默认 5000ms
  cooldown?: number;           // 默认 5000ms
  checkInterval?: number;      // 实现支持，默认 100ms
}
```

### 7.4 `memoryMonitor`

```typescript
memoryMonitor?: boolean | {
  cooldown?: number; // 默认 300000ms（5 分钟）
}
```

### 7.5 `blankScreen`

```typescript
blankScreen?: boolean | {
  timeout?: number;                // 默认 5000
  postReadyDelay?: number;         // 默认 1000
  reDetectInterval?: number;       // 默认 2000
  contentSelectors?: string[];     // 默认 []
  selectorsMap?: Record<string, string[]>; // 默认 null
  minVisibleNodes?: number;        // 默认 1
  cooldown?: number;               // 默认 30000
  ignorePages?: string[];          // 默认 []
  debug?: boolean;                 // 默认 false
}
```

**重要：** 白屏插件不会自动启动节点检测逻辑，除非你显式配置了 `contentSelectors` 或 `selectorsMap`。

### 7.6 如何生成 `selectorsMap`（推荐）

使用 `aegis-mp-selector-scanner` 扫描小程序页面，并自动生成按页面维度组织的选择器。

1. **安装扫描器**

```bash
npm i -D aegis-mp-selector-scanner
```

2. **仅扫描（推荐先做，不修改源码）**

```bash
npx aegis-scan scan ./miniprogram --format js
```

它会读取 `app.json`（包括分包），扫描页面模板（默认支持 `.wxml/.axml/.ttml`），并输出 `aegis-selectors.js`。

如果需要，也可以显式指定模板后缀：

```bash
npx aegis-scan scan ./miniprogram --template-exts .wxml,.axml,.ttml --format js
```

3. **在 SDK 配置中引用生成结果**

```javascript
// 按项目模块规范二选一：
// ESM:
// import selectorsMap from './aegis-selectors';
// CommonJS:
const selectorsMap = require('./aegis-selectors');

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  blankScreen: {
    selectorsMap,
  },
});
```

4. **当页面缺少可用 id / class 选择器时**

可以使用 inject 模式，在构建 / 上传前临时注入标记类：

> 这一套 `inject / restore / wrap` 流程适用于直接维护 `.wxml/.axml/.ttml` 模板的项目；**不适用于 Taro 的 `scan-taro` 源码扫描模式**。Taro 项目请看下方 `7.7`。

```bash
# 本地手动流程
npx aegis-scan inject ./miniprogram
# ... 构建 / 上传小程序 ...
npx aegis-scan restore ./miniprogram
```

或者在 CI/CD 中使用 wrap 模式（即使失败也会自动恢复）：

```bash
npx aegis-scan wrap ./miniprogram "npx miniprogram-ci upload"
```

5. **输出结构与回退规则**

```json
{
  "pages/index/index": ["#root-id", ".container"],
  "pages/logs/logs": []
}
```

- `selectorsMap[当前页面路径]` 的优先级高于 `contentSelectors`
- 如果命中的页面值是 `[]`，SDK 会跳过该页白屏检测（不会回退到 `contentSelectors`）
- 如果 `selectorsMap` 里没有命中当前页面，则回退到 `contentSelectors`（因此这个全局兜底应尽量少且临时，避免跨页误报）

### 7.7 跨端框架（Taro 等）

Taro 项目应使用 `scan-taro` **先扫描源码，再构建**，而不是扫描构建产物。根据最新插件实现，`scan-taro` 的工作方式是：

- 读取 `src/app.config.ts`（也可通过 `--taro-app-config` 指定）提取页面路由
- 按路由去 `src/pages/**/*.{tsx,ts,jsx,js}` 查找页面源码（也可通过 `--source-root` 指定源码根目录）
- 从页面根节点里提取选择器：**优先 `id`，其次第一个 `className`**
- 只读扫描，不会修改源码文件
- **不支持** `inject / wrap / restore`

1. **在源码中保留一个占位文件**（推荐，用于稳定 import / require 路径）

```javascript
module.exports = {};
```

例如可先在 `src/aegis-selectors.js` 放一个空对象占位，随后由扫描命令覆盖。

2. **在构建前扫描 Taro 源码**

```bash
npx aegis-scan scan-taro ./project --format js --output src/aegis-selectors.js
```

如果你更希望生成 JSON（例如配合 TypeScript 的 `resolveJsonModule`），也可以：

```bash
npx aegis-scan scan-taro ./project --format json --output src/aegis-selectors.json
```

3. **在源码里引用扫描结果**

```javascript
import Aegis from 'aegis-mp-sdk';
const selectorsMap = require('./aegis-selectors');

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  blankScreen: {
    selectorsMap,
    // 仅在确有必要时，才保留一个很小的全局兜底
    contentSelectors: ['.page-container'],
  },
});
```

4. **然后再执行 Taro 构建**

```bash
npx taro build --type weapp
```

5. **如果部分页面没有可用选择器，不要对 Taro 使用 inject / wrap**

`scan-taro` 只会从页面源码的根节点提取选择器，因此更推荐直接在页面根容器（通常是页面 `return (...)` 的最外层 `<View>` 或 `<ScrollView>`）上补稳定的 `id` 或 `className`，然后重新执行 `scan-taro`。

例如：

```tsx
export default function HomePage() {
  return <View id="home-page-root">...</View>;
}
```

### 7.8 Taro 路径匹配检查清单（重要）

`selectorsMap` 的 key 必须与小程序运行时 `route` 完全匹配（例如 `pages/home/index`）：

- 不要带文件后缀（`.tsx/.ts/.jsx/.js/.wxml/.axml/.ttml`）
- 最好不要带前导 `/`（插件虽兼容，但不建议依赖）
- 页面路径应与 `src/app.config.ts` / `src/app.config.js` 中声明的 `pages` / `subPackages` 保持一致
- 多目标构建时，只要各端页面路由定义一致，一般**不需要**按 `dist` 目录分别重新生成；只有源码侧路由定义不同，才需要针对对应源码配置重新执行 `scan-taro`
- 如果某个页面根节点既没有 `id`，也没有稳定的 `className`，该页面在生成结果里会是 `[]`，运行时会跳过白屏检测

如果 route 不匹配，插件会退回使用 `contentSelectors`。

---

## 8. 生命周期钩子

| 钩子 | 说明 |
|---|---|
| `logCreated(log)` | 日志对象创建时调用；返回 `false` 可丢弃 |
| `beforeReport(log)` | 普通日志上报前调用 |
| `beforeReportSpeed(log)` | 测速上报前调用 |
| `beforeRequest(data)` | 任意请求发送前调用（`{ logs, logType }`） |
| `modifyRequest(options)` | 最终请求参数修改钩子 |
| `afterRequest(result)` | 请求完成后调用 |
| `onWhitelist(isWhiteList)` | 白名单结果回调 |
| `onReport(log)` | 成功上报后回调 |
| `urlHandler()` | 自定义 `from` 维度生成逻辑 |
| `onBeforeRequest(options, aegis)` | 小程序端特有的发送前钩子 |
| `destroy()` | 实例销毁回调 |

---

## 9. 实例方法

### 自定义上报 API

`info`、`infoAll`、`error`、`report`、`reportEvent`、`reportTime`、`time/timeEnd`、`setConfig`、`destroy` 等方法为所有 Aegis SDK 通用，详见 `{SKILL_DIR}/references/custom_reporting_api.md`。

### 小程序专有方法

```javascript
const aegis = new Aegis({ id: 'YOUR_ID' });

// --- 配置 ---
aegis.extendBean('bizKey', 'bizValue');

// --- 延迟上报 ---
aegis.ready();

// --- 小程序专有 ---
// uploadLogs / reportPv 当前已废弃，请勿使用
```

---

## 10. 平台差异（`wx` / `my` / `tt` / `qq`）

- **平台检测**：默认根据运行时全局对象自动识别，也可通过 `platform` 强制指定
- **支付宝（`my`）**：
  - `onError` 回调签名不同（`message, error`）
  - cloud API 走 `createCloudContext` 路径
- **抖音（`tt`）**：
  - performance entry 结构与 wx / my / qq 不同
  - 因运行时兼容性问题，不走 `onAppRoute`，而是退回 Page hook 策略
  - aid 存储优先走同步 API
- **QQ（`qq`）**：整体与 wx 的 request / performance API 最接近

---

## 11. 安全域配置（生产环境）

在小程序正式环境中，需要把上报域名加入 **request** 安全域名列表：

- 国内：`https://rumt-zh.com`
- 新加坡：`https://rumt-sg.com`
- 硅谷：`https://rumt-us.com`

典型步骤：
1. 打开小程序管理后台
2. 进入开发设置（服务器域名）
3. 将域名加入 request allowlist

---

## 12. 实用接入模板

### 12.1 基础版（推荐起步配置）

```javascript
import Aegis from 'aegis-mp-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  hostUrl: 'https://rumt-zh.com',
  reportApiSpeed: true,
  reportAssetSpeed: true,
  spa: true,
});

App({
  aegis,
  onLaunch() {},
});
```

### 12.2 进阶版（含 trace + setData + 白屏）

```javascript
import Aegis from 'aegis-mp-sdk';
const selectorsMap = require('./aegis-selectors');

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  reportAssetSpeed: true,
  pagePerformance: true,
  reportLoadPackageSpeed: true,
  spa: true,
  api: {
    apiDetail: true,
    injectTraceHeader: 'traceparent',
    injectTraceUrls: [/^https:\/\/api\.example\.com/],
    retCodeHandler(data) {
      try {
        const body = typeof data === 'string' ? JSON.parse(data) : data;
        return { isErr: body.code !== 0, code: body.code };
      } catch (e) {
        return { isErr: false, code: 0 };
      }
    },
  },
  setDataReportConfig: {
    timeThreshold: 30,
    withDataPaths: true,
  },
  blankScreen: {
    selectorsMap,
    timeout: 5000,
  },
  crashMonitor: true,
  lagMonitor: true,
  memoryMonitor: true,
});
```

---

## 13. 小程序相关日志类型

| 类型 | 值 | 含义 |
|---|---|---|
| `PAGE_NOT_FOUND_ERROR` | `16384` | 页面不存在错误 |
| `LAZY_LOAD_ERROR` | `131072` | 异步组件懒加载失败 |
| `BLANK_SCREEN` | `1032` | 白屏检测 |
| `MEMORY_OOM` | `1033` | 内存告警 / 疑似 OOM |
| `LAG_MONITOR` | `1034` | 卡顿事件 |
| `NORESPONSE_LOG` | `1035` | 严重无响应卡顿 |

---

## 14. 排障提示

- 如果没有数据：
  - 检查 `id`
  - 检查上报域名是否加入安全域名
  - 检查 `hostUrl` 区域（`rumt-zh` vs `rumt-sg`）
- 如果白屏监控一直没有上报：
  - 确认 `blankScreen` 已开启
  - 确认显式配置了 `contentSelectors` 或 `selectorsMap`
- 如果 trace header 没有注入：
  - 检查 `api.injectTraceHeader`
  - 检查 URL include / exclude 规则
- 如果 PV 看起来缺失：
  - 检查 `spa: true`
  - 检查页面切换路径是否真的发生了变化

---

## 15. 相关文档

- 自定义上报 API（所有 SDK 通用）：`{SKILL_DIR}/references/custom_reporting_api.md`
- Web 配置：`{SKILL_DIR}/references/web-sdk-config.md`
- RN 配置：`{SKILL_DIR}/references/rn-sdk-config.md`
