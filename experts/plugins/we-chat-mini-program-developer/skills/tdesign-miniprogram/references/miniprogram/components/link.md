# Link 链接

## 示例

该组件于 0.32.0 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link",
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/hsyYRMm78r59)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

基础文字链接

**WXML** (`html`):
```html
<view class="link-example">
<t-link size="small" theme="primary" content="跳转链接" hover />
<t-link size="small" content="跳转链接" hover />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

下划线文字链接

**WXML** (`html`):
```html
<view class="link-example">
<t-link size="small" theme="primary" content="跳转链接" underline hover />
<t-link size="small" content="跳转链接" underline hover />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

前置图标文字链接

**WXML** (`html`):
```html
<view class="link-example">
<t-link size="small" theme="primary" content="跳转链接" prefixIcon="link" hover />
<t-link size="small" content="跳转链接" prefixIcon="link" hover />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

后置图标文字链接

**WXML** (`html`):
```html
<view class="link-example">
<t-link size="small" theme="primary" content="跳转链接" suffixIcon="jump" hover />
<t-link size="small" content="跳转链接" suffixIcon="jump" hover />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

### 组件状态

不同主题

**WXML** (`html`):
```html
<view class="link-example">
<t-link size="small" theme="primary" content="跳转链接" suffixIcon="jump" hover />
<t-link size="small" content="跳转链接" suffixIcon="jump" hover />
<t-link size="small" theme="danger" content="跳转链接" suffixIcon="jump" hover />
</view>
<view class="link-example">
<t-link size="small" theme="warning" content="跳转链接" suffixIcon="jump" hover />
<t-link size="small" theme="success" content="跳转链接" suffixIcon="jump" hover />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

.link-example:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

禁用状态

**WXML** (`html`):
```html
<view class="link-example">
<t-link
navigatorProps="{{navigatorProps}}"
size="small"
theme="primary"
content="跳转链接"
suffixIcon="jump"
disabled
hover
/>
<t-link size="small" content="跳转链接" suffixIcon="jump" disabled />
<t-link size="small" theme="danger" content="跳转链接" suffixIcon="jump" disabled />
</view>
<view class="link-example">
<t-link size="small" theme="warning" content="跳转链接" suffixIcon="jump" disabled />
<t-link size="small" theme="success" content="跳转链接" suffixIcon="jump" disabled />
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
navigatorProps: {
url: '/pages/home/home',
},
},
});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

.link-example:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

### 组件样式

链接尺寸

**WXML** (`html`):
```html
<view class="link-example">
<t-link size="small" theme="primary" content="S号链接" suffixIcon="jump" hover />
<t-link theme="primary" content="M号链接" suffixIcon="jump" hover />
<t-link size="large" theme="primary" content="L号链接" suffixIcon="jump" hover />
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.link-example {
display: flex;
align-items: center;
justify-content: space-evenly;
height: 96rpx;
background-color: var(--bg-color-demo);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-link": "tdesign-miniprogram/link/link"
}
}

```

## API

### LinkProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| content | String | - | 链接内容 | N |
| disabled | Boolean | false | 是否为禁用态 | N |
| hover | Boolean | - | 是否开启点击反馈 | N |
| navigator-props | Object | - | 与 navigator 原生组件属性保持一致，具体使用参考：微信开放文档。使用时请将形如`open-type`风格的属性名改为`openType`风格 | N |
| prefix-icon | String / Object | - | 前置图标 | N |
| size | String | medium | 尺寸。可选项：small/medium/large。TS 类型：`SizeEnum`。通用类型定义 | N |
| status | String | normal | 已废弃。组件状态。可选项：normal/active/disabled | N |
| suffix-icon | String / Object | - | 后置图标 | N |
| theme | String | default | 组件风格，依次为默认色、品牌色、危险色、警告色、成功色。可选项：default/primary/danger/warning/success | N |
| underline | Boolean | - | 是否显示链接下划线 | N |

### LinkEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| complete | - | 页面链接执行完成后触发（失败或成功均会触发） |
| fail | - | 页面链接跳转失败后触发 |
| success | - | 页面链接跳转成功后触发 |

### LinkSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| content | 自定义`content`显示内容 |
| prefix-icon | 自定义`prefix-icon`显示内容 |
| suffix-icon | 自定义`suffix-icon`显示内容 |

### LinkExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-content | 内容样式类 |
| t-class-hover | 悬停样式类 |
| t-class-prefix-icon | 前置图标样式类 |
| t-class-suffix-icon | 后置图标样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-link-danger-active-color | @error-color-active | - |
| --td-link-danger-color | @error-color | - |
| --td-link-danger-disabled-color | @error-color-disabled | - |
| --td-link-default-active-color | @brand-color-active | - |
| --td-link-default-color | @text-color-primary | - |
| --td-link-default-disabled-color | @text-color-disabled | - |
| --td-link-primary-active-color | @brand-color-active | - |
| --td-link-primary-color | @brand-color | - |
| --td-link-primary-disabled-color | @brand-color-disabled | - |
| --td-link-success-active-color | @success-color-active | - |
| --td-link-success-color | @success-color | - |
| --td-link-success-disabled-color | @success-color-disabled | - |
| --td-link-warning-active-color | @warning-color-active | - |
| --td-link-warning-color | @warning-color | - |
| --td-link-warning-disabled-color | @warning-color-disabled | - |