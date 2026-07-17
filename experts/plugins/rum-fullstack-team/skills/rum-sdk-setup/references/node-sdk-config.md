# Aegis Node SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/node-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 Node SDK 的核心配置、服务发现策略、手动上报 API 与接入边界。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-node-sdk -->
- **npm**：`aegis-node-sdk`
- **主要使用场景**：Node.js 服务、SSR 服务端、Electron 主进程、服务端脚本
- **运行时特点**：偏手动上报，不会自动 hook 浏览器 API
- **默认服务发现策略**：`selector.type = 'polaris'`

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-node-sdk';
```

### CommonJS 导入

```javascript
const Aegis = require('aegis-node-sdk');
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
| `uin` | `string \| number` | `''` | 用户 / 租户 / 服务实例标识 |
| `version` | `string \| number` | SDK 版本 | 业务版本标记 |
| `env` | `string` | `'production'` | 环境标记 |
| `pageUrl` | `string` | `''` | 覆盖 `from` 字段，可用于按服务名、路由或子系统分组 |
| `ext1` ~ `ext3` | `string` | - | 自定义维度 |

### 3. URL 配置

未手动覆盖时，所有上报 URL 都会从 `hostUrl` 推导。

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志上报地址 |
| `whiteListUrl` | `string` | `hostUrl + '/collect/whitelist'` | 白名单地址 |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | 测速上报地址 |

### 4. 上报控制与生命周期钩子

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `beforeReport` | `Function` | - | 普通日志上报前钩子 |
| `beforeReportSpeed` | `Function` | - | 测速上报前钩子 |
| `beforeRequest` | `Function` | - | 任意上报请求发送前钩子 |
| `afterRequest` | `Function` | - | 上报请求完成后钩子 |
| `onWhitelist` | `Function` | - | 白名单解析完成后的回调 |
| `keepalive` | `boolean` | `false` | 是否启用 HTTP keep-alive 连接复用 |
| `batchReportInterval` | `number` | `1000` | `reportSpeedLog` 的批量上报间隔 |

### 5. Node 专有配置

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `selector` | `object` | `{ type: 'polaris' }` | 服务发现配置 |
| `selector.type` | `'polaris' \| 'host' \| 'ip'` | `'polaris'` | 服务发现模式 |
| `selector.logBaseUrl` | `string` | `tam_log_svr?ns=Production` | Polaris 普通日志服务名 |
| `selector.speedBaseUrl` | `string` | `tam_speed_svr?ns=Production` | Polaris 测速服务名 |
| `protocol` | `'http' \| 'https'` | 自动推导 | `host` 模式默认 `https`，其余模式默认 `http` |

---

## 6. 手动上报 API

### 自定义上报 API

`info`、`infoAll`、`error`、`report`、`reportEvent`、`reportTime`、`time/timeEnd`、`setConfig`、`destroy` 等方法为所有 Aegis SDK 通用，详见 `{SKILL_DIR}/references/custom_reporting_api.md`。

### Node 专有方法

```javascript
aegis.reportSpeedLog({
  url: 'https://example.com/api',
  isHttps: true,
  method: 'GET',
  duration: 180,
  ret: 0,
  status: 200,
});
```

## 7. `selector` 策略建议

- **`polaris`**：标准腾讯内部环境或服务发现环境的首选
- **`host`**：当上报目标是固定域名时使用，例如 Electron 桌面场景
- **`ip`**：固定 IP 路由场景使用

## 8. 实用接入模板

### 8.1 基础版（推荐起步配置）

```typescript
import Aegis from 'aegis-node-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  uin: 'server-node',
  selector: {
    type: 'polaris',
  },
});

export default aegis;
```

### 8.2 固定域名上报

```typescript
import Aegis from 'aegis-node-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  selector: {
    type: 'host',
  },
  protocol: 'https',
  keepalive: true,
});
```

---

## 9. 重要说明

- 请在**启动 HTTP 服务之前**完成初始化，这样启动日志和早期错误才不会遗漏
- 构造函数会强制设置 `repeat = 0`，因此 Node SDK **默认不会做重复日志去重**
- 如果缺少 `id`，请求会直接跳过
- 如果在 devcloud 内上报失败，建议尝试执行 `unset http_proxy` 与 `unset https_proxy`
- 从能力边界上看，Aegis Node SDK 更适合作为轻量级服务端上报桥，而不是完整的 APM 平台
