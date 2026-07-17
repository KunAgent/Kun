# Aegis QuickApp SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/quickapp-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 QuickApp SDK 的核心配置、手动错误转发方式、`aegisFetch` 监控路径与运行时维度采集。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-quickapp-sdk -->
- **npm**：`aegis-quickapp-sdk`
- **主要使用场景**：QuickApp 应用
- **推荐初始化时机**：尽量在 `app.ux` 中最早初始化
- **运行时特点**：API 测速通过 `aegisFetch` 提供；全局 JS 错误通常需要业务手动转发

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-quickapp-sdk';
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

### 4. 上报控制与运行时回调

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `reportApiSpeed` | `boolean` | `false` | 开启 API 测速 |
| `beforeReportSpeed` | `Function` | - | 测速上报前钩子 |
| `getNetworkType` | `Function` | 内置 QuickApp network API | 可选的自定义网络类型回调 |

---

## 5. 手动错误转发模式

QuickApp SDK 不会在 `index.ts` 中注册专门的全局错误插件。
推荐方式是在 `app.ux` 中手动转发错误：

```javascript
export default {
  onError(err) {
    aegis.error(err);
  },
};
```

## 6. API 测速模式

当开启 API 测速后，应该使用 `aegis.aegisFetch(...)`，而不是直接使用原始 QuickApp fetch 模块：

```javascript
aegis.aegisFetch({
  url,
  data,
  success: () => {},
})
  .then(handleSuccess)
  .catch(handleError);
```

## 7. 设备与网络维度

QuickApp SDK 会采集：

- `platform`
- `network type`
- 视口（`vp`）
- 屏幕分辨率（`sr`）

这些维度通过 `@system.network`、`@system.device` 等 QuickApp 原生模块获取。

## 8. 实用接入模板

### 8.1 基础版（推荐起步配置）

```javascript
import Aegis from 'aegis-quickapp-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  uin: '',
  reportApiSpeed: true,
  hostUrl: 'https://rumt-zh.com',
});
```

### 8.2 入口错误转发 + API 测速

```javascript
export default {
  onError(err) {
    aegis.error(err);
  },
  onShow() {
    aegis.aegisFetch({ url: 'https://example.com/api' });
  },
};
```

---

## 9. 重要说明

- 尽量在 `app.ux` 中尽早初始化；如果多个页面需要复用实例，可以考虑暴露全局实例
- `aegisFetch` 会把 QuickApp fetch 包装成 Promise 兼容流程
- API 测速不是通过透明 patch 所有运行时请求得到的；如果希望被监控，请明确让请求走 `aegisFetch`
