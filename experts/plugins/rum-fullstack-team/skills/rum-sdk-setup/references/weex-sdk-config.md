# Aegis Weex SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/weex-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 Weex SDK 的核心配置、Vue 错误处理、双网络路径适配与运行时能力边界。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-weex-sdk -->
- **npm**：`aegis-weex-sdk`
- **主要使用场景**：基于 Vue 运行时或 Weex stream 网络的 Weex 应用
- **推荐初始化时机**：尽量在 bootstrap / 入口模块最早初始化
- **运行时特点**：同时适配标准风格 `fetch` 与原生 `stream.fetch`

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-weex-sdk';
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
| `uin` | `string \| number` | - | 用户标识 |
| `referrer` | `string` | `''` | 覆盖 referer 维度 |
| `ext1` ~ `ext3` | `string` | - | 自定义维度 |

### 3. URL 配置

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | 测速地址 |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |

### 4. 上报控制与运行时回调

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `reportApiSpeed` | `boolean` | `false` | 开启 API 与资源测速 |
| `beforeReportSpeed` | `Function` | - | 测速上报前钩子 |
| `reqCallback` | `Function` | - | 请求完成后的回调 |

---

## 5. 自动能力

Weex SDK 可以提供：

- 通过 `Vue.config.errorHandler` 做 JS 错误监控
- 同时监控标准 `fetch` 与 Weex `stream.fetch` 的 API 速度
- retcode 监控以及手动 `retcode(...)` 上报
- 面向 Weex 运行时的平台 / referer / 页面维度注入

## 6. 运行时网络适配器

SDK 内部对外暴露并包装了两条请求路径：

- `fetch`
- `weexFetch`

fetch 代理层会把 Weex stream 响应统一成类 Response 对象，支持：

- `clone()`
- `text()`
- `json()`

## 7. 实用接入模板

### 7.1 基础版（推荐起步配置）

```typescript
import Aegis from 'aegis-weex-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  referrer: '',
});
```

---

## 8. 重要说明

- 请在 Vue 业务代码初始化前完成接入，确保 `Vue.config.errorHandler` 能及时被 patch
- Weex 测速既能覆盖 API 流量，也能覆盖静态资源流量
- 对于自定义请求流程，可使用 `retcode(...)` 做显式手动测速 / 错误上报
