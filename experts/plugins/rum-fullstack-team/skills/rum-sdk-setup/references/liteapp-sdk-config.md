# Aegis LiteApp SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/liteapp-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 LiteApp SDK 的核心配置、`useStore` 架构、双运行时接入方式与能力边界。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-liteapp-sdk -->
- **npm**：`aegis-liteapp-sdk`
- **主要使用场景**：带或不带集中式 Store 层的 LiteApp 应用
- **特殊集成模式**：面向 Store 架构的 `UseStore(...)` 辅助函数
- **运行时特点**：页面运行时彼此隔离；开启 `useStore` 后，Store 运行时可作为上报中心

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis, { UseStore } from 'aegis-liteapp-sdk';
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
| `whiteListUrl` | `string` | `hostUrl + '/collect/whitelist'` | 白名单地址 |

### 4. 上报控制与功能开关

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `reportApiSpeed` | `boolean` | `false` | 开启 API 测速 |
| `beforeReportSpeed` | `Function` | - | 测速上报前钩子 |
| `useStore` | `boolean` | `false` | 声明应用是否使用 Store 集成模式 |

---

## 5. Store 模式集成（多页应用推荐）

### 5.1 Aegis 工厂

```typescript
import Aegis from 'aegis-liteapp-sdk';

export const createAegis = () => new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  useStore: true,
});
```

### 5.2 页面运行时

```typescript
import { createAegis } from './common';
createAegis();
```

### 5.3 Store 运行时

```typescript
import { UseStore } from 'aegis-liteapp-sdk';
import { createAegis } from './common';

setStore(UseStore({
  store,
  aegisFactory() {
    return createAegis();
  },
}));
```

## 6. 非 Store 模式集成

```typescript
new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  useStore: false,
});
```

## 7. 自动能力

LiteApp SDK 可以提供：

- 通过 `lite.addEventListener('error', ...)` 做运行时错误监控
- API 测速监控
- 设备与网络维度采集
- 通过 Lite storage 持久化 AID
- 当开启 `useStore` 时，将页面运行时日志转发到 Store 运行时

---

## 8. 重要说明

- 当 `useStore: true` 时，页面运行时与 Store 运行时都可能初始化 Aegis，但职责不同
- 开启 Store 模式后，优先使用页面运行时向 Store 运行时转发日志，而不是在页面线程本地独立上报 PV
- 对于多页面 LiteApp，Store 模式通常更容易维护，也更方便分析
