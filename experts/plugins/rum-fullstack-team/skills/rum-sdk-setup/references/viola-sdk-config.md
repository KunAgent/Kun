# Aegis Viola SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/viola-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 Viola SDK 的核心配置、HTTP 模块监控、运行时能力边界与典型初始化方式。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-viola-sdk -->
- **npm**：`aegis-viola-sdk`
- **主要使用场景**：Viola 应用
- **推荐初始化时机**：尽可能在入口脚本最早初始化
- **运行时特点**：聚焦 Viola 全局错误上报，以及 HTTP 模块的测速 / retcode 监控

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-viola-sdk';
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
| `ext1` ~ `ext3` | `string` | - | 自定义维度 |

### 3. URL 配置

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | 测速地址 |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |

### 4. 上报控制与功能开关

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `reportApiSpeed` | `boolean` | `false` | 开启 HTTP 模块测速 |
| `beforeReportSpeed` | `Function` | - | 测速上报前钩子 |
| `extRequestOpts` | `object` | `{}` | 额外透传给 Viola HTTP 请求的参数 |

---

## 5. 自动能力

Viola SDK 可以提供：

- 通过 `viola.on('error', ...)` 做全局运行时错误上报
- 通过 `viola.proxyModule.http` 做 HTTP 速度与 retcode 监控
- 通过共享 Core API 做自定义日志 / 事件 / 耗时上报

## 6. 当前运行时能力边界

与 Web SDK 相比，当前 Viola 支持刻意保持得更窄：

- 不提供页面性能监控
- 不提供静态资源测速
- 当前可见运行时路径中没有离线日志支持

## 7. 实用接入模板

### 7.1 基础版（推荐起步配置）

```typescript
import Aegis from 'aegis-viola-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  uin: '',
  hostUrl: 'https://rumt-zh.com',
  reportApiSpeed: true,
  extRequestOpts: {},
});
```

---

## 8. 重要说明

- 请尽早初始化，以便在业务逻辑抛错前就安装 Viola 全局错误监听器
- 如果宿主应用需要特殊请求标记或 timeout 行为，请通过 `extRequestOpts` 透传
- `reportApiSpeed` 关注的是 Viola HTTP 模块流量，而不是浏览器式网络拦截
