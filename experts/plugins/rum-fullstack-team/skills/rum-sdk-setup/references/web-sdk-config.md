# Aegis Web SDK 配置参考（源码级完整版本）

> 本参考基于 `web-sdk` 与 `core` 的所有源码文件整理而成。
> 它覆盖 **全部配置项**，包括官方 README 中未明确列出的参数。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-web-sdk -->
- **npm**：`aegis-web-sdk`
- **CDN（UMD）**：`https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js`
- **CDN（IE8+）**：`https://tam.cdn-go.cn/aegis-sdk/latest/aegis.ie.min.js`
- **CDN（IIFE）**：`https://tam.cdn-go.cn/aegis-sdk/latest/aegis.global.min.js`
- **CDN（Fingerprint AID）**：`https://tam.cdn-go.cn/aegis-sdk/latest/aegis.f.min.js`
- **全局变量名（UMD/CDN）**：`Aegis`

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-web-sdk';
```

### CDN / Script 标签

```html
<script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js"></script>
<script>
const aegis = new Aegis({ id: 'YOUR_ID' });
</script>
```

---

## 完整配置参数

### 1. 必填参数

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `id` | `string` | RUM 控制台分配的项目上报 ID。**必填**。 |

### 2. 身份与元数据

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `uin` | `string \| number` | 自动从 cookie（`buin=` 或 `bilive_uin=`）推导 | 用户唯一标识。正则限制：`/^[@=.0-9a-zA-Z_-]{1,60}$/` |
| `version` | `string \| number` | `0` | 应用版本。正则限制：`/^[0-9a-zA-Z.,:_-]{1,60}$/` |
| `env` | `string` | `'production'` | 环境值：`production`、`development`、`gray`、`pre`、`daily`、`local`、`test`、`others`。非法值会回退为 `others` |
| `aid` | `boolean \| string` | `true` | `true` 表示自动生成并持久化到 localStorage(`AEGIS_ID`)；传字符串则直接使用。指纹版构建（`aegis.f.min.js`）会使用浏览器指纹而不是随机 UUID |

### 3. URL 配置

未显式设置时，所有 URL 都会从 `hostUrl` 自动推导。

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名。设置它会自动推导子 URL |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志上报地址 |
| `pvUrl` | `string` | `hostUrl + '/collect/pv'` | PV 上报地址 |
| `whiteListUrl` | `string` | `hostUrl + '/collect/whitelist'` | 白名单接口地址。**传空字符串 `''` 可禁用白名单检查** |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | 测速上报地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |
| `performanceUrl` | `string` | `hostUrl + '/speed/performance'` | 页面性能地址 |
| `webVitalsUrl` | `string` | `hostUrl + '/speed/webvitals'` | Web Vitals 地址 |
| `memoryUrl` | `string` | `hostUrl + '/memory'` | 内存监控地址 |
| `pageUrl` | `string` | `location.href` | 覆盖最终上报页面 URL（即 `from` 字段） |

### 4. 上报控制

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `delay` | `number` | `1000`（ms） | 上报节流 / 合并窗口。窗口内日志会被批量合并 |
| `repeat` | `number \| object` | `60` | 每分钟重复上报限制。`0` 表示无限制；对象形式如 `{ speed: N }` 表示按类型单独限制 |
| `random` | `number` | `1` | 采样率 `[0, 1]`。`1` 表示全量上报，`0` 表示完全不上报。采样决策会在当前会话首次请求时确定 |
| `speedSample` | `boolean` | `true` | 测速日志是否也受重复限制影响 |
| `reportImmediately` | `boolean` | `true` | 是否立即上报。`false` 时会缓存请求，直到调用 `ready()` |

### 5. 自定义维度

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `ext1` ~ `ext3` | `string` | - | 自定义维度（超过 1024 字节会截断），可直接在控制台过滤 |
| `ext4` ~ `ext10` | `string` | - | 扩展维度。非字符串会自动转成字符串，需要控制台字段映射后使用 |

### 6. 功能开关

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `onError` | `boolean` | `true` | 错误监控：`window.onerror`、`unhandledrejection`、资源错误 |
| `spa` | `boolean` | `false` | SPA 模式：hack `history.pushState` / `replaceState`，监听 `popstate` / `hashchange`，在路由变化时自动发 PV，并基于 `pathname + hash` 做去重 |
| `reportApiSpeed` | `boolean \| { urlHandler }` | `false` | API 测速（拦截 XHR / Fetch） |
| `reportAssetSpeed` | `boolean \| object` | `false` | 静态资源测速（基于 `PerformanceObserver`） |
| `reportBridgeSpeed` | `boolean` | `false` | JSBridge 测速 |
| `pagePerformance` | `boolean \| WebPageConfig` | `true` | 页面性能指标（首屏、DNS、TCP 等） |
| `webVitals` | `boolean \| { manualReport?: boolean }` | `true` | Web Vitals：FCP、LCP、FID、CLS、INP、TTI |
| `websocketHack` | `boolean` | `false` | WebSocket 错误监控 |
| `consoleLog` | `boolean` | `false` | 捕获 `console.log/error/warn/info/debug/trace`。非白名单用户只会上报 `error` / `warn` |
| `clickElementLog` | `boolean` | `false` | 点击元素追踪，记录 XPath、文本、位置 |
| `blankScreen` | `boolean \| BlankScreenConfig` | `false` | 白屏检测 |
| `lagMonitor` | `boolean \| LagMonitorConfig` | `false` | 卡顿 / 假死监控（Chrome 116+） |
| `memoryMonitor` | `boolean \| MemoryMonitorConfig` | `false` | 内存使用与 OOM 监控（Chrome 7+） |
| `reportRetry` | `boolean \| WebReportRetryConfig` | `false` | 失败上报重试，并支持 localStorage 持久化 |

### 7. 日志开关

这些开关控制是否采集某些日志类型（部分能力需要白名单）。

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `apiLog` | `boolean` | `false` | 普通 API 请求日志（需要白名单） |
| `slowApiLog` | `boolean` | `false` | 慢 API 日志（阈值由 `api.apiSlowThreshold` 或 `api.isSlowApi` 控制） |
| `pageLoadLog` | `boolean` | `false` | 页面加载日志 |
| `slowPageLoadLog` | `boolean` | `false` | 慢页面日志（阈值由 `pagePerformance.slowPageThreshold` 或 `pagePerformance.isSlowPage` 控制） |
| `assetLog` | `boolean` | `false` | 普通资源请求日志（需要白名单） |
| `slowAssetLog` | `boolean` | `false` | 慢资源日志（阈值由 `api.assetSlowThreshold` 或 `api.isSlowAsset` 控制） |

---

## 8. API 配置（`api` 对象）

`api` 配置决定 API 测速、请求 / 响应详情采集、分布式追踪与慢请求判定逻辑。

```javascript
api: {
  // --- 详情采集 ---
  apiDetail: true,              // 上报请求参数与响应体
  reportRequest: false,         // 不依赖白名单直接全量上报请求（近似白名单行为）

  // --- 返回码识别 ---
  retCodeHandler(data, url, xhr, payload) {
    // 自定义返回码提取逻辑。必须同步执行。
    // data: 响应体字符串
    // url: 请求 URL
    // xhr: XMLHttpRequest 对象（或 fetch 上下文）
    // payload: { method, requestHeader, requestParams }
    // 必须返回：{ isErr: boolean, code: string|number }
    try {
      const body = JSON.parse(data);
      return { isErr: body.code !== 0, code: body.code };
    } catch(e) {
      return { isErr: false, code: 0 };
    }
  },

  // 另一种方式：按这些字段名自动识别 code（默认值）
  ret: ['ret', 'retcode', 'code', 'errcode'],

  // --- 请求 / 响应处理 ---
  reqParamHandler(data, { url }) {
    // 上报前处理请求参数（例如脱敏）
    return data;
  },

  resBodyHandler(data, { url, ctx }) {
    // 上报前处理响应体
    return data;
  },

  // --- Header 采集 ---
  reqHeaders: ['Content-Type', 'Authorization'],
  resHeaders: ['Content-Type', 'X-Request-Id'],

  // --- 资源类型分类 ---
  resourceTypeHandler(url) {
    // 覆盖 URL 应被识别为 'static' 还是 'fetch'
    if (url.includes('/api/')) return 'fetch';
    return ''; // 空字符串表示继续走默认判定
  },

  // --- 分布式追踪 ---
  injectTraceHeader: 'traceparent',
  injectTraceUrls: [
    /^https:\/\/api\.example\.com/,
    'https://backend.example.com'
  ],
  injectTraceIgnoreUrls: [],
  traceFlag: 1,

  // --- 性能时序增强 ---
  usePerformanceTiming: true,

  // --- 慢请求判定（优先级从高到低） ---
  isSlowApi(apiData) {
    // apiData 含 duration、url、status、method、type 等字段
    // 返回 true 表示这是慢请求
    // 如果这里抛异常，该日志会被静默丢弃
    return apiData.duration > 2000;
  },

  apiSlowThreshold: 1000,

  // --- 慢静态资源判定 ---
  isSlowAsset(assetLog) {
    // assetLog 为 StaticAssetsLog
    // 如果这里抛异常，该日志会被静默丢弃
    return assetLog.duration > 3000;
  },
  assetSlowThreshold: 1000,

  // --- XHR / Fetch 拦截控制 ---
  ignoreHackReg: /\.flv(\?|$)/i,
}
```

### `reportApiSpeed` 扩展写法

```javascript
reportApiSpeed: {
  urlHandler(url, payload) {
    // RESTful URL 聚合函数
    // url: 原始请求 URL
    // payload: { method, requestHeader, requestParams }
    // 返回用于控制台聚合展示的 URL
    return url.replace(/\/users\/\d+/, '/users/:id');
  }
}
```

---

## 9. 页面性能配置（`pagePerformance` 对象）

```javascript
pagePerformance: {
  // 自定义性能上报使用的页面 URL
  urlHandler() {
    return location.pathname;
  },

  // 将首屏关键元素信息保存到 aegis.firstScreenInfo
  firstScreenInfo: true,

  // --- 慢页面判定（优先级从高到低） ---
  isSlowPage(performanceLog, webVitalsData) {
    // performanceLog: { firstScreenTiming, dnsLookup, tcp, ssl, ttfb, ... }
    // webVitalsData: { LCP, FID, CLS, FCP }
    return performanceLog.firstScreenTiming > 3000;
  },

  slowPageThreshold: 1000,
}
```

**源码级补充说明：**
- 超过 `15000ms` 的性能值（`MAX_PERF_NUM`）会被视为脏数据并截断
- 首屏计算支持使用 `AEGIS-FIRST-SCREEN-TIMING` 标记关键元素
- 也支持用 `AEGIS-IGNORE-FIRST-SCREEN-TIMING` 排除元素
- 首屏计算最多重试 3 次，每次间隔 3 秒
- 页面隐藏时会强制上报，并在必要时以 FCP 兜底
- `extraPerformanceData: { engineInit, bundleLoad }` 适合游戏引擎（如 Cocos），每项上限 10000ms

---

## 10. 白屏配置（`blankScreen` 对象）

```javascript
blankScreen: {
  // --- 检测阈值 ---
  emptyElementsPercent: 70,
  sameElementsPercent: 70,
  disableSameElementsCheck: true,

  // --- 容器匹配（新 API，推荐） ---
  containerMatchers: {
    tagName: ['body', 'html'],
    id: ['app', 'root'],
    className: [],
  },
  ignoreMatchers: {
    tagName: [],
    id: [],
    className: [],
  },

  // --- 采样配置 ---
  detectStartPosition: { x: 0, y: 0 },
  everySideSampleNumber: 9,
  samePointDepth: 5,

  // --- 时序 ---
  debounceDuration: 2000,
  reDetectInterval: 2000,

  // --- DOM 变化处理 ---
  ignoreElesWhenDomChange: [],
}
```

**源码级补充说明：**
- 采样使用 `document.elementsFromPoint()`
- 触发源包括：MutationObserver、JS error 事件、页面卸载
- 采用二次确认机制：首次命中后缓存，等待 `reDetectInterval` 再复核
- 全屏 `canvas` / `img` / `svg` / `iframe` 不视作白屏（由 `ignoreLargeAreaEle` 排除）
- 检测尽量走 `requestIdleCallback`，避免阻塞主线程
- 最多等待 `10000ms` 让 `document.body` 出现，超时则放弃

---

## 11. 卡顿监控配置（`lagMonitor` 对象）

```javascript
lagMonitor: {
  enabled: true,
  threshold: 2000,
  noResponseThreshold: 5000,
  sampleRate: 1,
}
```

**源码级补充说明：**
- 基于 `PerformanceObserver` + `long-animation-frame`（Chrome 116+ / Edge 116+）
- 会记录第一条脚本归因里的 `invoker` 与 `sourceURL`
- `duration >= noResponseThreshold` 时上报 `LogType.NORESPONSE_LOG`，否则上报 `LogType.LAG_MONITOR`
- 内存中最多保留 100 条记录，挂载在 `window.__longTasks`
- 插件内部提供 `getLagRecords()` 与 `clearLagRecords()` 方法，可通过 `Aegis.installedPlugins.find(p => p.name === 'lagMonitor')?.option` 获取插件 option 对象后调用，例如：`lagPlugin.getLagRecords()`

---

## 12. 内存监控配置（`memoryMonitor` 对象）

```javascript
memoryMonitor: {
  enabled: true,
  enableMemoryReport: true,
  enableOOMReport: true,
  oomThreshold: 100,
  memoryReportInterval: 60000,
  oomCheckInterval: 10000,
  monitorPages: [],
  sampleRate: 1,
}
```

**源码级补充说明：**
- 基于 `performance.memory`（仅 Chrome 7+ / Edge 79+）
- OOM 事件之间有 5 分钟（300000ms）冷却时间
- 最多保留 50 条内存记录
- 插件内部提供 `getMemoryRecords()`、`getCurrentMemoryStatus()`、`clearMemoryRecords()` 方法，可通过 `Aegis.installedPlugins.find(p => p.name === 'memoryMonitor')?.option` 获取插件 option 对象后调用
- 在 `beforeunload` / `pagehide` 时自动清理定时器

---

## 13. 上报重试配置（`reportRetry` 对象）

```javascript
reportRetry: {
  maxRetryCount: 10,

  retryInterval: (retriedCount) => (2 << retriedCount) * 1000,
  // 或：retryInterval: 5000,

  whenRetryEndStillFail: 'discard',
  // 'discard'：全部失败后直接丢弃
  // 'nextTimeReport'：持久化到 localStorage，等下次页面加载再试

  maxStorageCount: 50,
}
```

**源码级补充说明：**
- 存储 key：`aegis-web-retry-report-requests`
- 重试调度使用 `requestIdleCallback`，尽量非阻塞
- `SDK_ERROR` 类型不会参与重试
- 重试过程中，Core 的 `failRequestCount` 不会累加，避免过早熔断
- 页面加载时会自动从 localStorage 里取出历史失败请求重新尝试

---

## 14. 设备信息与网络配置

```javascript
{
  getNetworkType(callback) {
    // callback 接收 NetworkTypeNum 枚举：
    // wifi=1, net2g=2, net3g=3, net4g=4, net5g=5, net6g=6, unknown=100
    callback(1);
  },

  getNetworkStatus(callback) {
    // callback 接收 NetworkStatus 枚举：
    // normal=0, weak=1, disconnected=2, unknown=100
    callback(0);
  },
}
```

**源码级补充说明：**
- 网络类型每 10 秒刷新一次
- 默认判定优先级：微信 UA 的 `NetType/` 字段 > `navigator.connection.effectiveType`
- 平台值映射：Android=1、iOS=2、Windows=3、MacOS=4、Linux=5、Other=100
- 写入 bean 的字段包括：`platform`、`netType`、`vp`（视口）、`sr`（屏幕分辨率）、`netStatus`

---

## 15. 点击元素配置

```javascript
{
  clickElementLog: true,
  ignoreElements: {
    ignoreIds: ['password-input', 'secret-field'],
    ignoreClasses: ['no-track', 'sensitive'],
  },
}
```

**源码级补充说明：**
- 基于 `document` 的事件委托（捕获阶段）
- 上报内容包括：操作类型、标签名、文本（截断到 127 字符）、XPath、页面 URL、点击位置
- 忽略判断会向上遍历最多 10 层祖先节点

---

## 16. Bridge 速度配置

```javascript
{
  reportBridgeSpeed: true,
  h5Bridge: window.h5Bridge,
  h5BridgeFunc: ['getLocation', 'pay'],
}
```

**源码级补充说明：**
- 会包装指定 bridge 对象上的方法
- 调用格式为：`h5Bridge[funcName](namespace, method, param, callback)`
- 上报 URL 形如 `${namespace}-${method}`，类型为 `'bridge'`

---

## 17. WebVitals 扩展配置

```javascript
{
  webVitals: {
    manualReport: true,
  },
}
```

**源码级补充说明：**
- 采集指标包括：FCP、LCP、FID、CLS、INP、TTI（未采到前默认都是 -1）
- `manualReport: true` 时采用“两阶段机制”：第一次调用保存自定义数据，第二次调用或页面隐藏时才真正上传
- 非手动模式下，页面隐藏时会自动上报
- 自定义数据可以覆盖 SDK 自动采集出的指标
- TTI 的计算是从 FCP 开始寻找 5 秒静默窗口（无长任务 + 网络请求数 ≤ 2）

---

## 18. 生命周期钩子

```javascript
{
  // --- 日志钩子 ---
  logCreated(log) {
    // 日志对象创建时触发（发生在 normalLogPipeline 中）
    // 返回 false 可直接过滤该日志
    return log;
  },

  beforeReport(log) {
    // 每条普通日志上报前触发（拿到的是日志副本）
    // 返回 false 可取消该日志上报
    return log;
  },

  onReport(log) {
    // 日志成功上报后触发
  },

  // --- 测速钩子 ---
  beforeReportSpeed(log) {
    // 每条测速日志上报前触发
    // 返回 false 可取消这条测速日志
    return log;
  },

  // --- 请求钩子 ---
  beforeRequest(data) {
    // 任意请求发送前触发
    // data: { logs: [...], logType: SendType }
    // 返回 false 可取消整个请求
    // 也可以返回修改后的对象
    return data;
  },

  modifyRequest(options) {
    // 发送前最后一次修改 SendOption
    // options: { url, method, data, type, ... }
    return options;
  },

  afterRequest(result) {
    // 请求完成后触发
    // result: { isErr: boolean, result: any, logType: string, logs: [...] }
    // 返回 false 可阻断后续管道逻辑
  },

  // --- 白名单钩子 ---
  onWhitelist(isWhiteList) {
    // 白名单检查完成后触发
  },

  // --- URL 钩子 ---
  urlHandler() {
    // 覆盖最终上报页面 URL（即 from）
    return location.pathname;
  },

  // --- 销毁钩子 ---
  destroy() {
    // aegis 实例销毁时触发
  },

  // --- Web SDK 特有 ---
  onBeforeRequest(options, aegis) {
    // XHR 真正发出前最后一次改请求（未文档化）
    // 在 web-sdk 的 request() 内部调用
  },
}
```

---

## 19. 实例方法

### 自定义上报 API

`info`、`infoAll`、`error`、`report`、`reportEvent`、`reportTime`、`time/timeEnd`、`setConfig`、`destroy` 等方法为所有 Aegis SDK 通用，详见 `{SKILL_DIR}/references/custom_reporting_api.md`。

### Web 专有方法

```javascript
const aegis = new Aegis({ ... });

// --- 配置 ---
aegis.extendBean('customKey', 'customValue');

// --- Web Vitals（手动模式） ---
aegis.reportWebVitals();
aegis.reportWebVitals({ LCP: 1200 });

// --- 延迟上报 ---
aegis.ready();
```

### 静态属性与方法

```javascript
Aegis.version;
Aegis.instances;
Aegis.logType;
Aegis.environment;
Aegis.installedPlugins;

Aegis.use(plugin);
Aegis.unuse(plugin);
```

---

## 20. 熔断 / 自保护机制

SDK 内置了以下保护逻辑：

| 机制 | 阈值 | 行为 |
|-----------|-----------|----------|
| 请求失败熔断 | 连续 60 次失败（`MAX_FAIL_REQUEST_NUM`） | 自动 `destroy()` |
| 403 Forbidden | 收到 `'403 forbidden'` 响应 | 立即 `destroy()` |
| 重复错误限制 | `config.repeat` 次 / 分钟（默认 60） | 丢弃多余日志 |
| 重复测速限制 | `config.repeat` 次 / URL | 丢弃多余测速日志 |
| 随机采样 | `config.random` `[0,1]` | 每个会话只决策一次 |
| 白名单缓冲 | 最多积压 200 条日志 | 丢弃最旧记录 |
| Promise 错误长度限制 | 150 字符（`MAX_PROMISE_ERROR_MSG_LENGTH`） | 截断 |

---

## 21. 日志类型对照表

| 类型 | 值 | 说明 |
|------|-------|-------------|
| `INFO_ALL` | `-1` | 全量 info（发送前会转成 INFO） |
| `API_RESPONSE` | `1` | API 返回日志（白名单可见） |
| `INFO` | `2` | 普通信息日志（白名单可见） |
| `ERROR` | `4` | 错误 |
| `PROMISE_ERROR` | `8` | 未处理 Promise 错误 |
| `AJAX_ERROR` | `16` | Ajax 错误 |
| `SCRIPT_ERROR` | `32` | 脚本加载错误 |
| `IMAGE_ERROR` | `64` | 图片加载错误 |
| `CSS_ERROR` | `128` | CSS 加载错误 |
| `CONSOLE_ERROR` | `256` | Console error |
| `MEDIA_ERROR` | `512` | 音视频错误 |
| `RET_ERROR` | `1024` | 返回码错误 |
| `PAGE_LOAD` | `1025` | 页面加载事件 |
| `SLOW_PAGE_LOAD` | `1026` | 慢页面 |
| `SLOW_NET_REQUEST` | `1027` | 慢网络请求 |
| `ASSERT_REQUEST` | `1028` | 资源请求 |
| `SLOW_ASSET_REQUEST` | `1029` | 慢资源 |
| `CLICK_EVENT` | `1030` | 点击事件 |
| `CONSOLE_LOG` | `1031` | Console 日志 |
| `BLANK_SCREEN` | `1032` | 白屏 |
| `MEMORY_OOM` | `1033` | 内存 OOM |
| `LAG_MONITOR` | `1034` | 卡顿 |
| `NORESPONSE_LOG` | `1035` | 无响应 / 严重卡顿 |
| `REPORT` | `2048` | 自定义上报（触发告警但不扣分） |
| `PV` | `4096` | 页面浏览 |
| `EVENT` | `8192` | 自定义事件 |
| `SPEED_EVENT` | `8193` | 自定义测速事件 |
| `WEBSOCKET_ERROR` | `32768` | WebSocket 错误 |
| `BRIDGE_ERROR` | `65536` | Bridge 错误 |

---

## 框架接入模板

### React（Create React App / Vite）

**`src/utils/aegis.ts`：**
```typescript
import Aegis from 'aegis-web-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  reportAssetSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

export default aegis;
```

**`src/App.tsx`（或根组件）：**
```typescript
import './utils/aegis'; // 放在顶部，尽早初始化
```

**登录后动态设置 `uin`：**
```typescript
import aegis from './utils/aegis';

function onLoginSuccess(user) {
  aegis.setConfig({ uin: user.id });
}
```

### React（Next.js）

**`src/lib/aegis.ts`：**
```typescript
import Aegis from 'aegis-web-sdk';

let aegis: Aegis | null = null;

export function getAegis() {
  if (typeof window === 'undefined') return null;
  if (!aegis) {
    aegis = new Aegis({
      id: 'YOUR_AEGIS_ID',
      reportApiSpeed: true,
      reportAssetSpeed: true,
      spa: true,
      hostUrl: 'https://rumt-zh.com',
    });
  }
  return aegis;
}

export default aegis;
```

**`src/app/layout.tsx`（App Router）或 `pages/_app.tsx`（Pages Router）：**
```typescript
'use client';
import { useEffect } from 'react';
import { getAegis } from '@/lib/aegis';

export default function RootLayout({ children }) {
  useEffect(() => {
    getAegis();
  }, []);

  return <html><body>{children}</body></html>;
}
```

### Vue 3（Vite / Vue CLI）

**`src/plugins/aegis.ts`：**
```typescript
import Aegis from 'aegis-web-sdk';
import type { App } from 'vue';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  reportAssetSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

export default {
  install(app: App) {
    // Vue 会拦截组件内错误，必须配置 errorHandler 转发给 Aegis，否则漏报
    app.config.errorHandler = (err, vm, info) => {
      aegis.error(err);
      console.error(err); // 保留控制台输出，不影响开发体验
    };
    app.config.globalProperties.$aegis = aegis;
    app.provide('aegis', aegis);
  }
};

export { aegis };
```

**`src/main.ts`：**
```typescript
import { createApp } from 'vue';
import App from './App.vue';
import aegisPlugin from './plugins/aegis';

const app = createApp(App);
app.use(aegisPlugin);
app.mount('#app');
```

### Vue 2

**`src/plugins/aegis.js`：**
```javascript
import Aegis from 'aegis-web-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  reportAssetSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

const AegisPlugin = {
  install(Vue) {
    // Vue 会拦截组件内错误，必须配置 errorHandler 转发给 Aegis，否则漏报
    Vue.config.errorHandler = (err, vm, info) => {
      aegis.error(err);
      console.error(err); // 保留控制台输出，不影响开发体验
    };
    Vue.prototype.$aegis = aegis;
  }
};

export default AegisPlugin;
export { aegis };
```

### Vue（Nuxt 3）

**`plugins/aegis.client.ts`：**
```typescript
import Aegis from 'aegis-web-sdk';

export default defineNuxtPlugin(() => {
  const aegis = new Aegis({
    id: 'YOUR_AEGIS_ID',
    reportApiSpeed: true,
    reportAssetSpeed: true,
    spa: true,
    hostUrl: 'https://rumt-zh.com',
  });

  return { provide: { aegis } };
});
```

### Angular

**`src/app/services/aegis.service.ts`：**
```typescript
import { Injectable } from '@angular/core';
import Aegis from 'aegis-web-sdk';

@Injectable({ providedIn: 'root' })
export class AegisService {
  private aegis: Aegis;

  constructor() {
    this.aegis = new Aegis({
      id: 'YOUR_AEGIS_ID',
      reportApiSpeed: true,
      reportAssetSpeed: true,
      spa: true,
      hostUrl: 'https://rumt-zh.com',
    });
  }

  getInstance() { return this.aegis; }
  setUin(uin: string) { this.aegis.setConfig({ uin }); }
  // 自定义上报 API（reportEvent、reportTime 等）参见 custom_reporting_api.md
}
```

### 原生 HTML

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js"></script>
  <script>
    const aegis = new Aegis({
      id: 'YOUR_AEGIS_ID',
      reportApiSpeed: true,
      reportAssetSpeed: true,
      hostUrl: 'https://rumt-zh.com',
    });
  </script>
</head>
<body></body>
</html>
```
