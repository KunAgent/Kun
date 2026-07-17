# Aegis Cocos SDK 配置参考（源码级完整版本）

> 本文档基于 `packages/cocos-sdk` 与相关 `packages/core` 源码整理而成。
> 它覆盖 Cocos SDK 的核心配置、运行时专有能力、场景 PV、FPS / drawcall 与首屏上报方式。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-cocos-sdk -->
- **npm**：`aegis-cocos-sdk`
- **主要使用场景**：Cocos Web / Native 游戏及交互场景
- **推荐初始化时机**：尽可能在游戏启动阶段最早初始化
- **运行时特点**：支持 Cocos 资源 hook、场景 PV、FPS / drawcall 上报，以及手动首屏上报

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-cocos-sdk';
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
| `uin` | `string \| number` | 可用时从 cookie 推导 | 用户标识 |
| `ext1` ~ `ext3` | `string` | - | 自定义维度 |

### 3. URL 配置

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `performanceUrl` | `string` | `hostUrl + '/speed/performance'` | 性能上报地址 |

### 4. 功能开关

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `reportApiSpeed` | `boolean \| { urlHandler }` | `false` | API 测速 |
| `reportAssetSpeed` | `boolean` | `false` | 资源测速 |
| `pagePerformance` | `boolean` | `true` | 开启 Cocos 性能相关上报 |
| `spa` | `boolean` | `false` | 开启场景切换 PV 监控 |
| `fpsReportInterval` | `boolean \| number` | `true` | FPS / drawcall 上报间隔（秒），`true` 使用默认 60 秒，传 `false` 可关闭 |

---

## 5. 自动能力

Cocos SDK 可以提供：

- 全局 JS 错误监控（`window.onerror` 或原生 `window.__errorHandler` 分支）
- 未处理 Promise rejection 监控
- XHR / fetch 错误监控与 retcode 检测
- 通过包装 Cocos loader API 采集资源测速
- 基于 Cocos 场景生命周期的场景 PV 上报
- 通过渲染回调采集 FPS 和 drawcall

## 6. Cocos 运行时专有说明

### 6.1 资源测速

当开启 `reportAssetSpeed` 后，SDK 会包装这些 Cocos 加载 API：

- `cc.loader.load`
- `cc.loader.loadRes`
- `cc.assetManager.loadRemote`

### 6.2 场景 PV 监控

当开启 `spa: true` 后，SDK 会在 `cc.Director.EVENT_AFTER_SCENE_LAUNCH` 上报 PV。

### 6.3 FPS / Drawcall 监控

`fpsReportInterval` 默认为 `true`（使用 60 秒间隔），SDK 会按配置间隔上报：

- `fps`
- `drawcall`

### 6.4 首屏上报

Cocos 的首屏时间通常建议在 loading UI 消失后手动上报：

```typescript
aegis.reportFirstScreenTime();
// 或
aegis.reportFirstScreenTime(1000);
```

## 7. 实用接入模板

### 7.1 基础版（推荐起步配置）

```typescript
import Aegis from 'aegis-cocos-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  uin: '',
  hostUrl: 'https://rumt-zh.com',
  reportApiSpeed: true,
  reportAssetSpeed: true,
  spa: true,
  fpsReportInterval: 60,
});

export default aegis;
```

### 7.2 手动首屏上报

```typescript
// 在真正的 loading 结束边界调用

aegis.reportFirstScreenTime();
```

---

## 8. 重要说明

- 请在早期场景加载或资源加载发生前完成初始化
- 如果开启 `spa`，`from` 会随着当前场景名更新
- 在 Cocos 的 loading 场景里，首屏时间通常手动上报会更准确
- 资源测速的准确性取决于项目是否真的走了 SDK 已包装的那些 Cocos loader API
