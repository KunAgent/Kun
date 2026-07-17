# Aegis Hippy SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/hippy-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 Hippy SDK 的核心配置、运行时专有参数、`api` 对象与典型接入模式。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-hippy-sdk -->
- **npm**：`aegis-hippy-sdk`
- **主要使用场景**：Hippy 应用，以及嵌入 Hippy 页面的 Hybrid 容器
- **推荐初始化时机**：尽可能在 `entryPage` 入口模块最早初始化
- **运行时特点**：重点覆盖 `fetch`、bridge 速度、设备 / 网络维度与 Hippy 性能时序

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-hippy-sdk';
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
| `uin` | `string \| number` | `''` | 用户标识 |
| `version` | `string \| number` | SDK 版本 | 业务版本 |
| `env` | `string` | `'production'` | 环境标记 |
| `pageUrl` | `string` | `'-'` | 覆盖 `from` |
| `referrer` | `string` | `''` | 覆盖 `referer` |
| `userAgent` | `string` | `''` | 覆盖 `userAgent` |
| `viewPort` | `string` | `''` | 覆盖视口维度 |
| `ext1` ~ `ext3` | `string` | - | 自定义维度 |

### 3. URL 配置

未手动覆盖时，所有上报 URL 都会从 `hostUrl` 推导。

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志地址 |
| `pvUrl` | `string` | `hostUrl + '/collect/pv'` | PV 地址 |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | API / bridge / 资源测速地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |
| `performanceUrlForHippy` | `string` | `hostUrl + '/speed/hippyPerformance'` | Hippy 性能上报地址 |

### 4. 上报控制与功能开关

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `reportApiSpeed` | `boolean` | `false` | 开启 `fetch` 测速监控 |
| `reportBridgeSpeed` | `boolean` | `false` | 开启 bridge 调用测速 |
| `reportImmediately` | `boolean` | `true` | 为 `false` 时，直到调用 `aegis.ready()` 才真正上报 |
| `beforeReportSpeed` | `Function` | - | 测速上报前钩子 |

### 5. Hippy 专有参数

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hippyBridge` | `object` | `global.Hippy.bridge` | 显式传入业务实际使用的 bridge 对象 |
| `useSDKReportNetwork` | `boolean` | `false` | 使用 SDK 的网络采集，而不是宿主提供的实现 |
| `getNetworkType` | `Function` | - | 自定义网络类型回调 |
| `getNetworkStatus` | `Function` | - | 自定义网络状态回调 |
| `reqCallback` | `Function` | - | SDK 上报请求完成后的通知回调，参数为 `(res, options)`。纯通知型，不能拦截或修改上报结果。适用于宿主 App 侧监控 SDK 网络请求状态（Hippy 环境没有 DevTools Network 面板） |

---

## 6. API 配置（`api` 对象）

| 参数 | 类型 | 说明 |
|---|---|---|
| `api.apiDetail` | `boolean` | 在失败时上报请求参数和响应体 |
| `api.retCodeHandler(data, url, xhr)` | `Function` | 自定义 retcode / isErr 判断逻辑 |
| `api.reqParamHandler(data, url)` | `Function` | 请求参数脱敏 / 裁剪 |
| `api.resBodyHandler(data, url)` | `Function` | 响应体脱敏 / 裁剪 |
| `api.ret` | `string[] \| string` | retcode 字段候选名 |
| `api.errCode` / `api.code` | `string[] \| string` | 成功 / 失败码规则 |
| `api.resourceTypeHandler(url)` | `Function` | 覆盖 `fetch` / `static` 分类逻辑 |

## 7. 自动能力

实例化后，Hippy SDK 可以提供：

- 通过 Hippy 全局错误事件做运行时错误监控
- `fetch` 测速与 retcode 监控
- 开启后对 `callNativeWithPromise` 做 bridge 速度监控
- 在 `global.performance` 可用时上报页面性能
- 在 Resource Timing 可用时上报静态资源测速
- 设备、视口、平台、网络等维度采集

## 8. 常见集成模式

### 8.1 基础版（推荐起步配置）

```typescript
import Aegis from 'aegis-hippy-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  uin: '',
  hostUrl: 'https://rumt-zh.com',
  reportApiSpeed: true,
  reportBridgeSpeed: false,
});

export default aegis;
```

### 8.2 开启 Bridge 速度监控

```typescript
const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  reportBridgeSpeed: true,
  hippyBridge: global.Hippy?.bridge,
});
```

### 8.3 等登录上下文准备好后再上报

```typescript
const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportImmediately: false,
});

aegis.setConfig({ uin: 'user-123' });
aegis.ready();
```

### 8.4 手动上报 Hippy 性能

```typescript
aegis.reportPerformanceData({
  engineInit: 100,
  bundleLoad: 200,
  firstScreenTiming: 600,
  firstScreenRequest: 350,
  loadEnd: 900,
});
```

### 8.5 手动上报 Retcode

```typescript
aegis.retcode({
  url: 'myHippyApi',
  ret: 0,
  duration: 120,
  status: 200,
});
```

---

## 9. 重要说明

- 请尽量在 `entryPage` 中尽早初始化
- `pagePerformance` / 资源时序依赖 Hippy 运行时能力，尤其是 Hippy 3 的支持情况
- bridge 速度监控只会包装 `callNativeWithPromise`
- `network` 与 `websocket` bridge 模块会被 bridge 速度插件刻意跳过
- 如果业务对默认 bridge 做过包装，请通过 `hippyBridge` 传入真实 bridge 对象
