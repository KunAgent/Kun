# project.config.json 配置

## 概述

`project.config.json` 是微信开发者工具的项目配置文件，其中包含影响 Skyline 调试和开发的设置项。

## 配置文件优先级

| 文件 | 说明 | 优先级 |
|------|------|--------|
| `project.config.json` | 公共配置，提交版本管理 | 低 |
| `project.private.config.json` | 个人配置，加入 `.gitignore` | 高 |

`project.private.config.json` 中的相同设置优先级高于 `project.config.json`。

## Skyline 相关设置

### setting.skylineRenderEnable

| 字段 | 类型 | 允许私有设置 | 说明 |
|------|------|-------------|------|
| skylineRenderEnable | Boolean | 是 | 是否开启 Skyline 渲染调试 |

在开发者工具中启用 Skyline 渲染调试：

```json
{
  "setting": {
    "skylineRenderEnable": true
  }
}
```

> ⚠️ 此设置仅影响开发者工具的调试行为，不影响线上表现。线上渲染器由 `app.json` 的 `renderer` 字段决定。

### 其他相关设置

以下设置虽非 Skyline 专属，但在 Skyline 项目中常用：

| 字段 | 类型 | 说明 |
|------|------|------|
| `es6` | Boolean | 是否启用 ES6 转 ES5 |
| `postcss` | Boolean | 上传代码时样式是否自动补全 |
| `minified` | Boolean | 上传代码时是否自动压缩脚本 |
| `compileHotReLoad` | Boolean | 是否开启文件保存后自动热重载 |
| `bigPackageSizeSupport` | Boolean | 主包/分包体积上限调整为 4M |

## 完整示例

```json
{
  "appid": "wx1234567890",
  "compileType": "miniprogram",
  "setting": {
    "skylineRenderEnable": true,
    "es6": true,
    "postcss": true,
    "minified": true,
    "compileHotReLoad": true
  },
  "libVersion": "3.3.0"
}
```

## libVersion

基础库版本设置。Skyline 项目建议设置为 2.30.4 以上版本：

| Skyline 特性 | 最低基础库 |
|-------------|-----------|
| renderer + componentFramework | 2.30.4 |
| rendererOptions | 2.31.1 |
| 页面级 rendererOptions 覆盖 | 3.1.0 |
| convertRpxToVw | 3.3.0 |
