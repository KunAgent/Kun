# Aegis React Native SDK 配置参考（源码级完整版本）

> 本文档基于 `rn-sdk` 与 `core` 的所有源码整理而成。
> 它覆盖 **全部配置项**、插件行为以及接入模式。

## 包信息

<!-- COPY_REPLACE: 内部版本请将 npm 包名替换为 @tencent/aegis-rn-sdk -->
- **npm**：`aegis-rn-sdk`
- **Peer 依赖**：`react-native >= 0.59.0`
- **可选依赖**：`@react-native-async-storage/async-storage >= 1.0.0`（用于 aid 持久化）
- **全局变量名（UMD）**：`Aegis`

## 导入方式

### NPM / ES Module 导入

```javascript
import Aegis from 'aegis-rn-sdk';
```

### 命名导出（导航集成）

```javascript
import Aegis, {
  createReactNavigationIntegration,
  createReactNavigationListener,
  createNativeRouterListener,
  useAegisPageView,
} from 'aegis-rn-sdk';
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
| `uin` | `string \| number` | - | 用户唯一标识。正则限制：`/^[@=.0-9a-zA-Z_-]{1,60}$/` |
| `version` | `string \| number` | SDK 版本 | 应用版本。正则限制：`/^[0-9a-zA-Z.,:_-]{1,60}$/` |
| `env` | `string` | `'production'` | 环境值：`production`、`development`、`gray`、`pre`、`daily`、`local`、`test`、`others` |
| `aid` | `boolean \| string` | `true` | `true` 表示通过 `@react-native-async-storage/async-storage` 自动生成 aid（不可用时回退为空字符串）；传字符串则直接使用 |

### 3. URL 配置

未显式设置时，所有 URL 都会从 `hostUrl` 自动推导。

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `hostUrl` | `string` | `'https://rumt-zh.com'` | 上报基础域名 |
| `url` | `string` | `hostUrl + '/collect'` | 普通日志地址 |
| `pvUrl` | `string` | `hostUrl + '/collect/pv'` | PV 地址 |
| `whiteListUrl` | `string` | `hostUrl + '/collect/whitelist'` | 白名单地址。**传空字符串 `''` 可禁用白名单检查** |
| `eventUrl` | `string` | `hostUrl + '/collect/events'` | 自定义事件地址 |
| `speedUrl` | `string` | `hostUrl + '/speed'` | 测速地址 |
| `customTimeUrl` | `string` | `hostUrl + '/speed/custom'` | 自定义耗时地址 |
| `pageUrl` | `string` | `'-'` | 覆盖上报页面 URL（即 `from`）。RN 环境没有 `location`，因此默认值为 `'-'` |

### 4. 上报控制

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `delay` | `number` | `1000`（ms） | 上报节流 / 合并窗口。窗口内日志会批量合并 |
| `repeat` | `number \| object` | `5` | 每分钟重复上报限制。`0` 表示无限制；对象形式如 `{ speed: N }` |
| `random` | `number` | `1` | 采样率 `[0, 1]`。`1` 表示全量上报。会在当前会话首次请求时决定 |
| `speedSample` | `boolean` | `true` | 测速日志是否也应用重复限制 |

### 5. 自定义维度

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `ext1` ~ `ext3` | `string` | - | 自定义维度（超过 1024 字节会截断），可直接在控制台过滤 |
| `ext4` ~ `ext10` | `string` | - | 扩展维度。非字符串会自动转成字符串，需要控制台字段映射 |

### 6. 功能开关

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `onError` | `boolean` | `true` | 错误监控：全局 JS 错误、Promise rejection、AJAX 错误、retcode 错误 |
| `reportApiSpeed` | `boolean \| { urlHandler }` | `false` | API 测速（拦截 XHR / Fetch） |
| `spa` | `boolean` | `false` | 开启页面流转监控插件。**RN 不会自动识别路由变化**；你必须接入监听器或手动调用 `aegis.reportPageView(routeName)` |
| `aid` | `boolean` | `true` | 基于 AsyncStorage 的匿名设备 ID 生成与持久化 |
| `device` | `boolean` | `true` | 设备信息采集（当前仍是预留占位能力） |

---

## 7. API 配置（`api` 对象）

`api` 配置控制 API 测速与返回码识别逻辑。

```javascript
api: {
  // --- 详情采集 ---
  apiDetail: true,              // 上报请求参数与响应体

  // --- 返回码识别 ---
  retCodeHandler(data, url, xhr, payload) {
    // 自定义返回码提取逻辑。必须同步执行。
    // data: 响应体字符串
    // url: 请求 URL
    // xhr: XMLHttpRequest 对象（或 fetch 上下文）
    // 必须返回：{ isErr: boolean, code: string|number }
    try {
      const body = JSON.parse(data);
      return { isErr: body.code !== 0, code: body.code };
    } catch(e) {
      return { isErr: false, code: 0 };
    }
  },

  // 默认字段候选
  ret: ['ret', 'retcode', 'code', 'errcode'],

  // --- 请求 / 响应处理 ---
  reqParamHandler(data, { url }) {
    return data;
  },

  resBodyHandler(data, { url, ctx }) {
    return data;
  },

  // --- 资源类型分类 ---
  resourceTypeHandler(url) {
    if (url.includes('/api/')) return 'fetch';
    return '';
  },
}
```

### `reportApiSpeed` 扩展写法

```javascript
reportApiSpeed: {
  urlHandler(url, payload) {
    // 用于 RESTful URL 聚合
    return url.replace(/\/users\/\d+/, '/users/:id');
  }
}
```

---

## 8. 页面流转监控（`spa` 选项）

当设置 `spa: true` 时，会激活 `pageView` 插件。与 web-sdk 通过 `history.pushState` / `popstate` 自动感知路由变化不同，**RN 没有浏览器 History API**。
`spa: true` 本身不会自动产生 PV；路由变化必须通过以下任一方式显式上报：

### 集成方式对比

| 路由框架 | 推荐 API | 说明 |
|---|---|---|
| React Navigation（v5+） | `createReactNavigationIntegration` | 两阶段注册；通过 `addListener('state')` 订阅，最稳健 |
| React Navigation（旧版兼容） | `createReactNavigationListener` | 使用 `onReady` + `onStateChange` 回调，向后兼容 |
| Expo Router | `useAegisPageView` Hook | 基于 `usePathname()`，符合 Expo Router 习惯 |
| react-router-native v4 | `useAegisPageView` + `withRouter` | v4 没有 `useHistory`，通过 `withRouter` 注入 `location.pathname` |
| react-router-native v5 | `createNativeRouterListener` | 自动上报首屏 PV，并订阅 `history.listen` |
| react-router-native v6 | `useAegisPageView` Hook | 基于 `useLocation().pathname`，v6 已移除 `history` |
| 任意框架 | `aegis.reportPageView(routeName)` | 手动调用，灵活性最高 |
| 无导航库 | `aegis.reportPageView(routeName)` 或直接不配 `spa` | 简单单页应用可手动打点，或者直接跳过页面流转能力 |

### 没有导航库时如何处理

如果 RN 项目里没有 `@react-navigation/native`、`expo-router` 或 `react-router-native`，要看应用结构选择接入方式。

**单屏应用（没有页面切换）：**
不要设置 `spa: true`。让非 spa 路径处理基本启动 PV，把重点放在错误监控、API 测速与自定义事件上。

```typescript
const aegis = new Aegis({
  id: 'YOUR_ID',
  reportApiSpeed: true,
  // spa 默认是 false —— 不需要页面流转监控
});
```

**有逻辑页面但没有路由库（例如 tab state、modal、wizard）：**
可以设置 `spa: true`，并在每个逻辑页面边界手动调用 `reportPageView`：

```typescript
const aegis = new Aegis({
  id: 'YOUR_ID',
  reportApiSpeed: true,
  spa: true,
});

function onTabChange(tabName: string) {
  aegis.reportPageView(tabName); // 'Home'、'Settings'、'Profile'
}

function onStepChange(step: number) {
  aegis.reportPageView(`Step${step}`);
}

function onOpenModal(modalName: string) {
  aegis.reportPageView(modalName);
}
```

### PV 上报行为

- 通过 `SendType.PV` 上报到 `config.pvUrl`
- 会携带 `originFrom` 参数（即当前路由名）
- 会同步更新 `bean.from`，使后续错误 / 测速日志都带上对应页面标识
- **去重规则**：相同路由名不会连续重复上报
- RN 的 `spa` 插件本身不会隐式补发首屏 PV；首屏 / 路由 PV 是否产生，取决于是否触发了 `reportPageView`

### `reportPageView` 方法

```typescript
aegis.reportPageView(routeName: string): void
```

- `routeName`：当前页面路由名或路径，例如 `'Home'`、`'/profile/123'`
- 内部会通过 `extendBean('from', encodedRouteName)` 更新 `bean.from`
- 会发射 `reportPageView` 生命周期事件，由 `pageView` 插件真正触发上报
- 路由名会截断到 `MAX_FROM_LENGTH`（2048 字符）

---

## 9. 导航集成工具

### 9.1 `createReactNavigationIntegration`（React Navigation v5+ 推荐）

采用两阶段注册模式，设计上参考了 Sentry 的 react-native SDK。

```typescript
import { createNavigationContainerRef } from '@react-navigation/native';
import Aegis, { createReactNavigationIntegration } from 'aegis-rn-sdk';

const aegis = new Aegis({ id: 'YOUR_ID', spa: true });
const navigationRef = createNavigationContainerRef();
const navIntegration = createReactNavigationIntegration(aegis);

<NavigationContainer
  ref={navigationRef}
  onReady={() => {
    navIntegration.registerNavigationContainer(navigationRef);
  }}
>
  {/* screens */}
</NavigationContainer>
```

**API：**

| 方法 | 说明 |
|--------|-------------|
| `registerNavigationContainer(containerOrRef)` | 注册 NavigationContainer。既支持 ref 对象 `{ current }`，也支持直接传 container 实例。内部通过 `addListener('state', cb)` 订阅；支持重复注册（如 Android Activity 重建） |
| `reportManual(routeName)` | 自动识别不适用时的手动 PV 上报兜底 |

**源码级补充说明：**
- 内部直接调用 `container.addListener('state', onStateChange)`，不依赖外部传 `onStateChange` prop
- 同时兼容 ref 对象和直接实例
- 重新注册时会先移除旧监听，再安装新监听
- 注册成功后会立即读取当前路由并发一条首屏 PV
- 内部会通过 `prevRouteName` 做去重

### 9.2 `createReactNavigationListener`（旧版兼容）

```typescript
import { createNavigationContainerRef } from '@react-navigation/native';
import Aegis, { createReactNavigationListener } from 'aegis-rn-sdk';

const aegis = new Aegis({ id: 'YOUR_ID', spa: true });
const navigationRef = createNavigationContainerRef();
const listener = createReactNavigationListener(aegis, navigationRef);

<NavigationContainer
  ref={navigationRef}
  onReady={listener.onReady}
  onStateChange={listener.onStateChange}
>
  {/* screens */}
</NavigationContainer>
```

**说明：** 该 API 已不推荐继续新增使用，优先使用 `createReactNavigationIntegration`。

### 9.3 `useAegisPageView`（Expo Router / 通用 Hook）

```typescript
import { usePathname } from 'expo-router';
import Aegis, { useAegisPageView } from 'aegis-rn-sdk';

const aegis = new Aegis({ id: 'YOUR_ID', spa: true });

export default function RootLayout() {
  const pathname = usePathname();
  useAegisPageView(aegis, pathname);
  return <Slot />;
}

function NavigationListener() {
  const pathname = usePathname();
  useAegisPageView(aegis, pathname, {
    ignore: [/modal/, /^\/sheet/],
  });
  return null;
}
```

**API：**

```typescript
useAegisPageView(
  aegis: Aegis,
  pathname: string,
  options?: { ignore?: Array<string | RegExp> }
): void
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `aegis` | `Aegis` | Aegis 实例 |
| `pathname` | `string` | 当前路由路径，一般来自 `usePathname()` |
| `options.ignore` | `Array<string \| RegExp>` | 需要忽略 PV 的路径规则，支持字符串精确匹配和正则 |

**源码级补充说明：**
- 内部通过 `useRef` 记录上一次 pathname 做去重
- `useEffect` 依赖是 `[pathname]`，只在路径变化时执行
- ignore 规则中，字符串走严格相等，正则走 `.test()`

### 9.4 `createNativeRouterListener`（仅 react-router-native v5）

> **⚠️ 这个函数依赖 react-router-native v5 的 `history` 对象。**
> react-router-native v6 已移除 `useHistory` / `history`，v6 请改用 `useAegisPageView` + `useLocation()`。

**v5 用法：**

```typescript
import React, { useEffect } from 'react';
import { NativeRouter, useHistory } from 'react-router-native';
import Aegis, { createNativeRouterListener } from 'aegis-rn-sdk';

const aegis = new Aegis({ id: 'YOUR_ID', spa: true });

function AegisRouteTracker() {
  const history = useHistory();
  useEffect(() => {
    const unlisten = createNativeRouterListener(aegis, history);
    return unlisten;
  }, [history]);
  return null;
}
```

**API：**

```typescript
createNativeRouterListener(
  aegis: Aegis,
  history: {
    listen: (cb: (args: { location: { pathname: string } }) => void) => () => void;
    location?: { pathname: string };
  }
): () => void
```

**行为：**
1. 注册时先读取 `history.location?.pathname`，自动上报首屏 PV
2. 随后订阅 `history.listen`，继续跟踪后续路由变化

### 9.5 react-router-native v6（使用 `useAegisPageView`）

```typescript
import React from 'react';
import { NativeRouter, useLocation } from 'react-router-native';
import Aegis, { useAegisPageView } from 'aegis-rn-sdk';

const aegis = new Aegis({ id: 'YOUR_ID', spa: true });

function AegisRouteTracker() {
  const { pathname } = useLocation();
  useAegisPageView(aegis, pathname);
  return null;
}

export default function App() {
  return (
    <NativeRouter>
      <AegisRouteTracker />
      {/* routes */}
    </NativeRouter>
  );
}
```

`useAegisPageView` 会在初次 pathname 可用时自动处理首屏 PV，并负责后续去重。

### 9.6 react-router-native v4（`useAegisPageView` + `withRouter`）

```typescript
import React from 'react';
import { NativeRouter, withRouter } from 'react-router-native';
import Aegis, { useAegisPageView } from 'aegis-rn-sdk';

const aegis = new Aegis({ id: 'YOUR_ID', spa: true });

function AegisRouteTracker({ location }) {
  useAegisPageView(aegis, location.pathname);
  return null;
}

const AegisRouteTrackerWithRouter = withRouter(AegisRouteTracker);

export default function App() {
  return (
    <NativeRouter>
      <AegisRouteTrackerWithRouter />
      {/* routes */}
    </NativeRouter>
  );
}
```

如果是 class 组件（没有 Hooks），也可以这样：

```typescript
import { withRouter } from 'react-router-native';

class AegisRouteTracker extends React.Component {
  prevPathname = '';
  componentDidMount() { this.report(); }
  componentDidUpdate() { this.report(); }
  report() {
    const { pathname } = this.props.location;
    if (pathname && pathname !== this.prevPathname) {
      this.prevPathname = pathname;
      aegis.reportPageView(pathname);
    }
  }
  render() { return null; }
}

export default withRouter(AegisRouteTracker);
```

### 版本对照总结

| react-router 版本 | history 包版本 | 推荐 API | pathname 获取方式 |
|---|---|---|---|
| v4 | v4 | `useAegisPageView` + `withRouter` | `withRouter` 注入 `location.pathname` |
| v5 | v4 | `createNativeRouterListener` | `useHistory()` 返回 history 对象 |
| v6 | v5 | `useAegisPageView` | `useLocation().pathname` |

---

## 10. 生命周期钩子

```javascript
{
  // --- 日志钩子 ---
  logCreated(log) {
    // 普通日志对象创建时触发
    // 返回 false 可过滤该日志
    return log;
  },

  beforeReport(log) {
    // 普通日志上报前触发（拿到的是日志副本）
    // 返回 false 可取消该日志
    return log;
  },

  onReport(log) {
    // 日志成功上报后触发
  },

  // --- 测速钩子 ---
  beforeReportSpeed(log) {
    // 测速上报前触发
    // 返回 false 可取消该测速日志
    return log;
  },

  // --- 请求钩子 ---
  beforeRequest(data) {
    // 任意请求发送前触发
    // data: { logs: {...}, logType: "log" | "speed" | ... }
    // 返回 false 可取消整个请求
    return data;
  },

  modifyRequest(options) {
    // 发送前修改最终 SendOption
    return options;
  },

  afterRequest(result) {
    // 请求完成后触发
    // result: { isErr: boolean, result: any, logType: string, logs: [...] }
  },

  // --- 白名单钩子 ---
  onWhitelist(isWhiteList) {
    // 白名单检查完成后触发
  },

  // --- URL 钩子 ---
  urlHandler() {
    // 覆盖最终上报页面 URL（即 from）
    // RN 没有 location，所以这里可用于自定义页面标识
    return 'CustomPageName';
  },

  // --- 销毁钩子 ---
  destroy() {
    // aegis 实例销毁时触发
  },
}
```

---

## 11. 实例方法

### 自定义上报 API

`info`、`infoAll`、`error`、`report`、`reportEvent`、`reportTime`、`time/timeEnd`、`setConfig`、`destroy` 等方法为所有 Aegis SDK 通用，详见 `{SKILL_DIR}/references/custom_reporting_api.md`。

### RN 专有方法

```javascript
const aegis = new Aegis({ ... });

// --- 配置 ---
aegis.extendBean('customKey', 'customValue');

// --- RN 专有：错误上报别名 ---
aegis.reportError(new Error('oops'));

// --- 页面流转（RN 专有） ---
aegis.reportPageView('ScreenName');
```

### 静态属性与方法

```javascript
Aegis.version;
Aegis.sessionID; // RN 特有：'session-{timestamp}'
Aegis.instances;
Aegis.logType;
Aegis.environment;
Aegis.installedPlugins;

Aegis.use(plugin);
Aegis.unuse(plugin);
```

---

## 12. 熔断 / 自保护机制

RN SDK 继承了 core 的自保护逻辑：

| 机制 | 阈值 | 行为 |
|-----------|-----------|----------|
| 请求失败熔断 | 连续 60 次失败（`MAX_FAIL_REQUEST_NUM`） | 自动 `destroy()` |
| 403 Forbidden | 收到 `'403 forbidden'` 响应 | 立即 `destroy()` |
| 重复错误限制 | `config.repeat` 次 / 分钟（默认 5） | 丢弃多余日志 |
| 重复测速限制 | `config.repeat` 次 / URL | 丢弃多余测速日志 |
| 随机采样 | `config.random` `[0,1]` | 每个会话只决策一次 |
| 白名单缓冲 | 最多积压 200 条日志 | 丢弃最旧记录 |

---

## 13. 已安装插件（加载顺序）

RN SDK 按如下顺序注册插件：

| 顺序 | 插件 | 配置项 | 说明 |
|-------|--------|------------|-------------|
| 1 | `onError` | `onError`（默认 `true`） | 全局错误监控 |
| 2 | `aid` | `aid`（默认 `true`） | 匿名设备 ID |
| 3 | `cgiSpeed` | `reportApiSpeed` | API 测速 |
| 4 | `device` | `device`（默认 `true`） | 设备信息（当前是占位能力） |
| 5 | `pageView` | `spa`（默认 `false`） | 页面流转 PV 上报 |

---

## 框架接入模板

### 基础初始化（任意 RN 项目）

**`src/utils/aegis.ts`：**
```typescript
import Aegis from 'aegis-rn-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  uin: '',
  reportApiSpeed: true,
  hostUrl: 'https://rumt-zh.com',
});

export default aegis;
```

**`App.tsx`（根组件）：**
```typescript
import './utils/aegis'; // 顶部导入，尽早初始化
```

### React Navigation v5+（推荐）

**`src/utils/aegis.ts`：**
```typescript
import Aegis, { createReactNavigationIntegration } from 'aegis-rn-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

export const navIntegration = createReactNavigationIntegration(aegis);
export default aegis;
```

**`App.tsx`：**
```typescript
import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { navIntegration } from './utils/aegis';

const navigationRef = createNavigationContainerRef();

export default function App() {
  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        navIntegration.registerNavigationContainer(navigationRef);
      }}
    >
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

### Expo Router

**`src/utils/aegis.ts`：**
```typescript
import Aegis from 'aegis-rn-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

export default aegis;
```

**`app/_layout.tsx`：**
```typescript
import { Slot, usePathname } from 'expo-router';
import { useAegisPageView } from 'aegis-rn-sdk';
import aegis from '../src/utils/aegis';

export default function RootLayout() {
  const pathname = usePathname();
  useAegisPageView(aegis, pathname);
  return <Slot />;
}
```

### react-router-native

#### v6（推荐）

**`App.tsx`：**
```typescript
import React from 'react';
import { NativeRouter, useLocation } from 'react-router-native';
import Aegis, { useAegisPageView } from 'aegis-rn-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

function AegisRouteTracker() {
  const { pathname } = useLocation();
  useAegisPageView(aegis, pathname);
  return null;
}

export default function App() {
  return (
    <NativeRouter>
      <AegisRouteTracker />
      {/* Your routes */}
    </NativeRouter>
  );
}
```

#### v5（旧版）

**`App.tsx`：**
```typescript
import React, { useEffect } from 'react';
import { NativeRouter, useHistory } from 'react-router-native';
import Aegis, { createNativeRouterListener } from 'aegis-rn-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

function AegisRouteTracker() {
  const history = useHistory();
  useEffect(() => {
    const unlisten = createNativeRouterListener(aegis, history);
    return unlisten;
  }, [history]);
  return null;
}

export default function App() {
  return (
    <NativeRouter>
      <AegisRouteTracker />
      {/* Your routes */}
    </NativeRouter>
  );
}
```

#### v4（没有 Hooks）

**`App.tsx`：**
```typescript
import React from 'react';
import { NativeRouter, withRouter } from 'react-router-native';
import Aegis, { useAegisPageView } from 'aegis-rn-sdk';

const aegis = new Aegis({
  id: 'YOUR_AEGIS_ID',
  reportApiSpeed: true,
  spa: true,
  hostUrl: 'https://rumt-zh.com',
});

function AegisRouteTracker({ location }) {
  useAegisPageView(aegis, location.pathname);
  return null;
}

const AegisRouteTrackerWithRouter = withRouter(AegisRouteTracker);

export default function App() {
  return (
    <NativeRouter>
      <AegisRouteTrackerWithRouter />
      {/* Your routes */}
    </NativeRouter>
  );
}
```

### 登录后动态设置 `uin`

```typescript
import aegis from './utils/aegis';

function onLoginSuccess(user: { id: string }) {
  aegis.setConfig({ uin: user.id });
}
```

---

## RN SDK 与 Web SDK 能力对比

| 能力 | Web SDK | RN SDK | 说明 |
|---------|---------|--------|-------|
| JS 错误监控 | 自动（`window.onerror`） | 自动（`ErrorUtils.setGlobalHandler`） | API 不同，但目标一致 |
| Promise rejection | 自动（`unhandledrejection`） | 自动（Hermes tracker / polyfill） | 优先 Hermes，旧环境回退 polyfill |
| AJAX / Fetch 错误 | 自动（XHR / Fetch hack） | 自动（XHR / Fetch hack） | 实现思路一致 |
| API 测速 | `reportApiSpeed` | `reportApiSpeed` | 逻辑一致 |
| retcode 识别 | `api.retCodeHandler` | `api.retCodeHandler` | 逻辑一致 |
| SPA / 页面流转 | 自动（History hack） | 手动（`reportPageView`） | RN 需要显式接入路由变化 |
| Aid 持久化 | localStorage | AsyncStorage | AsyncStorage 不存在时回退为空字符串 |
| 自身上报请求 | 被 hack 后通过 `sendByAegis` 跳过监控 | 缓存原始 `fetch` 引用完全绕过 hack | 这是 RN 的关键差异 |
| 会话跟踪 | - | `Aegis.sessionID` | RN 特有会话 ID |
