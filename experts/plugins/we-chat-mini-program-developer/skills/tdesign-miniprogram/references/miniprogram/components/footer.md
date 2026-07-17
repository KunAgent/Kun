# Footer 页脚

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-footer": "tdesign-miniprogram/footer/footer"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/J6v8BMmr8B5h)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 类型

基础页脚

**WXML** (`html`):
```html
<!-- 基础页脚 只有版权信息 -->
<t-footer text="{{text}}"></t-footer>

```

**JS** (`javascript`):
```javascript
Component({
data: {
text: 'Copyright © 2021-2031 TD.All Rights Reserved.',
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-footer": "tdesign-miniprogram/footer/footer"
}
}

```

基础加链接页脚

**WXML** (`html`):
```html
<!-- theme 为 text，含有底部链接 -->
<view class="footer-example">
<t-footer text="{{text}}" links="{{links[0]}}" />
</view>

<view class="footer-example">
<t-footer text="{{text}}" links="{{links[1]}}" />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
text: 'Copyright © 2021-2031 TD.All Rights Reserved.',
links: [
[
{
name: '底部链接',
url: '/pages/index',
openType: 'navigate',
},
],
[
{
name: '底部链接',
url: '/pages/index',
openType: 'navigate',
},
{
name: '底部链接',
url: '',
openType: 'navigateBack',
},
],
],
},
});

```

**CSS** (`css`):
```css
.footer-example {
padding: 8rpx 0;
}

.footer-example:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-footer": "tdesign-miniprogram/footer/footer"
}
}

```

品牌页脚

**WXML** (`html`):
```html
<!-- theme 为 logo -->
<view class="footer-example">
<t-footer logo="{{logo}}" />
</view>

<view class="footer-example">
<t-footer
logo="{{{url: theme === 'dark'?'https://tdesign.gtimg.com/mobile/demos/footer-logo-dark.png':'https://tdesign.gtimg.com/mobile/demos/logo1.png'} }}"
/>
</view>

```

**JS** (`javascript`):
```javascript
import themeChangeBehavior from 'tdesign-miniprogram/mixins/theme-change';

Component({
behaviors: [themeChangeBehavior],
data: {
logo: {
icon: 'https://tdesign.gtimg.com/mobile/demos/logo2.png',
title: '品牌名称',
},
},
});

```

**CSS** (`css`):
```css
.footer-example {
padding: 8rpx 0;
}

.footer-example:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-footer": "tdesign-miniprogram/footer/footer"
}
}

```

## API

### FooterProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| copyright | String | '' | 已废弃。版权信息，type 为`text`生效 | N |
| links | Array | [] | `1.0.0`。链接列表。name 表示链接名称， url 表示链接 page 路径，目前只支持小程序内部跳转，openType 表示跳转方式。TS 类型：`Array<LinkObj>``interface LinkObj { name: string; url?: string; openType?: 'navigate' \| 'redirect' \| 'relaunch' \| 'switchTab' \| 'navigateBack' }`。详细类型定义 | N |
| logo | Object | - | 图标配置。`logo.icon`表示图标链接地址，`logo.title`表示标题文本，`logo.url`表示链接。TS 类型：`FooterLogo``interface FooterLogo { icon: string; title?: string; url?: string }`。详细类型定义 | N |
| text | String | '' | `1.0.0`。版权信息 | N |
| text-link-list | Array | [] | 已废弃。链接列表，type 为`text`生效。name 表示链接名称， url 表示链接 page 路径，目前只支持小程序内部跳转，openType 表示跳转方式。TS 类型：`Array<LinkObj>``interface LinkObj { name: string; url?: string; openType?: 'navigate' \| 'redirect' \| 'relaunch' \| 'switchTab' \| 'navigateBack' }`。详细类型定义 | N |
| theme | String | 'text' | 已废弃。页脚展示类型。可选项：text/logo | N |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-footer-link-color | @brand-color | - |
| --td-footer-link-dividing-line-color | @text-color-placeholder | - |
| --td-footer-link-dividing-line-padding | @spacer-1 | - |
| --td-footer-link-font | @font-body-medium | - |
| --td-footer-logo-icon-height | 48rpx | - |
| --td-footer-logo-icon-margin-right | @spacer | - |
| --td-footer-logo-icon-width | 48rpx | - |
| --td-footer-logo-title-font | @font-title-medium | - |
| --td-footer-logo-title-url-width | 256rpx | - |
| --td-footer-text-color | @text-color-placeholder | - |
| --td-footer-text-font | @font-body-small | - |
| --td-footer-text-margin-top | 8rpx | - |