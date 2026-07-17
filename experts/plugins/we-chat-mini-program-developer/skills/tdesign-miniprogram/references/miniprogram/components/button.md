# Button 按钮

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/NSVqRNmh8l5a)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

#### 基础按钮

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" size="large">填充按钮</t-button>
<t-button theme="light" size="large">填充按钮</t-button>
<t-button size="large">填充按钮</t-button>
</view>

<view class="button-example">
<t-button theme="primary" size="large" variant="outline">描边按钮</t-button>
<t-button theme="primary" size="large" variant="text">文字按钮</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
margin: 32rpx;
display: flex;
justify-content: space-between;
}

.button-example:after {
content: '';
flex: auto;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 图标按钮

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" icon="app" content="填充按钮" size="large"></t-button>
<t-button wx:if="{{skylineRender}}" theme="light" size="large">
<t-loading t-class="loading" theme="spinner" size="40rpx" text="加载中..." />
</t-button>
<t-button wx:else theme="primary" size="large" loading>加载中</t-button>
<t-button theme="primary" icon="search" shape="square" size="large" aria-label="搜索"></t-button>
</view>

```

**JS** (`javascript`):
```javascript
import SkylineBehavior from '@behaviors/skyline.js';

Component({ behaviors: [SkylineBehavior] });

```

**CSS** (`css`):
```css
.button-example {
margin: 32rpx;
display: flex;
justify-content: space-between;
}

.button-example:after {
content: '';
flex: auto;
}

.button-example .loading {
display: flex;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button",
"t-loading": "tdesign-miniprogram/loading/loading"
}
}

```

#### 幽灵按钮

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" ghost size="large">幽灵按钮</t-button>
<t-button theme="danger" ghost size="large">幽灵按钮</t-button>
<t-button ghost size="large">幽灵按钮</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
display: flex;
justify-content: space-between;
background-color: #181818;
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 组合按钮

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="light" block size="large" t-class="group-btn">填充按钮</t-button>
<t-button theme="primary" block size="large" t-class="group-btn">填充按钮</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
margin: 32rpx;
display: flex;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 通栏按钮

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" size="large" block>填充按钮</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
margin: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 02组件状态

#### 按钮禁用态

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" size="large" disabled>填充按钮</t-button>
<t-button theme="light" size="large" disabled>填充按钮</t-button>
<t-button size="large" disabled>填充按钮</t-button>
</view>

<view class="button-example">
<t-button theme="primary" size="large" variant="outline" disabled>描边按钮</t-button>
<t-button theme="primary" size="large" variant="text" disabled>文字按钮</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
margin: 32rpx;
display: flex;
justify-content: space-between;
}

.button-example:after {
content: '';
flex: auto;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

### 03组件样式

#### 按钮尺寸

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" size="large">按钮48</t-button>
<t-button theme="primary">按钮40</t-button>
<t-button theme="primary" size="small">按钮32</t-button>
<t-button theme="primary" size="extra-small">按钮28</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
display: flex;
align-items: flex-start;
justify-content: space-between;
margin: 0 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 按钮形状

**WXML** (`html`):
```html
<view class="button-example">
<t-button theme="primary" size="large">填充按钮</t-button>
<t-button theme="primary" size="large" icon="search" shape="square" aria-label="搜索"></t-button>
<t-button theme="primary" size="large" shape="round">填充按钮</t-button>
<t-button theme="primary" size="large" icon="search" shape="circle" aria-label="搜索"></t-button>
</view>

<t-button theme="primary" size="large" block t-class="external-class">填充按钮</t-button>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
display: flex;
justify-content: space-between;
margin: 0 32rpx 32rpx;
}

.external-class {
border-radius: 0 !important;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

#### 按钮主题

**WXML** (`html`):
```html
<view class="button-example">
<t-button size="large">填充按钮</t-button>
<t-button size="large" variant="outline">描边按钮</t-button>
<t-button size="large" variant="text">文字按钮</t-button>
</view>

<view class="button-example">
<t-button size="large" theme="primary">填充按钮</t-button>
<t-button size="large" theme="primary" variant="outline">描边按钮</t-button>
<t-button size="large" theme="primary" variant="text">文字按钮</t-button>
</view>

<view class="button-example">
<t-button size="large" theme="danger">填充按钮</t-button>
<t-button size="large" theme="danger" variant="outline">描边按钮</t-button>
<t-button size="large" theme="danger" variant="text">文字按钮</t-button>
</view>

<view class="button-example">
<t-button size="large" theme="light">填充按钮</t-button>
<t-button size="large" theme="light" variant="outline">描边按钮</t-button>
<t-button size="large" theme="light" variant="text">文字按钮</t-button>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.button-example {
margin: 32rpx;
display: flex;
justify-content: space-between;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-button": "tdesign-miniprogram/button/button"
}
}

```

## API

### ButtonProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| app-parameter | String | - | 打开 APP 时，向 APP 传递的参数，open-type=launchApp时有效 | N |
| block | Boolean | false | 是否为块级元素 | N |
| content | String | - | 按钮内容 | N |
| custom-dataset | any | - | 自定义 dataset，可通过 event.currentTarget.dataset.custom 获取 | N |
| disabled | Boolean | undefined | 禁用状态。优先级：Button.disabled > Form.disabled | N |
| ghost | Boolean | false | 是否为幽灵按钮（镂空按钮） | N |
| hover-class | String | - | 指定按钮按下去的样式类，按钮不为加载或禁用状态时有效。当`hover-class="none"`时，没有点击态效果 | N |
| hover-start-time | Number | 20 | 按住后多久出现点击态，单位毫秒 | N |
| hover-stay-time | Number | 70 | 手指松开后点击态保留时间，单位毫秒 | N |
| hover-stop-propagation | Boolean | false | 指定是否阻止本节点的祖先节点出现点击态 | N |
| icon | String / Object | - | 图标名称。值为字符串表示图标名称，值为`Object`类型，表示透传至`icon` | N |
| lang | String | - | 指定返回用户信息的语言，zh_CN 简体中文，zh_TW 繁体中文，en 英文。<br>具体释义：<br>`en`英文；<br>`zh_CN`简体中文；<br>`zh_TW`繁体中文。<br>小程序官方文档。可选项：en/zh_CN/zh_TW | N |
| loading | Boolean | false | 是否显示为加载状态 | N |
| loading-props | Object | - | 透传 Loading 组件全部属性。TS 类型：`LoadingProps`，Loading API Documents。详细类型定义 | N |
| open-type | String | - | 微信开放能力。<br>具体释义：<br>`contact`打开客服会话，如果用户在会话中点击消息卡片后返回小程序，可以从 bindcontact 回调中获得具体信息，具体说明（鸿蒙 OS 暂不支持）；<br>`liveActivity`通过前端获取新的一次性订阅消息下发机制使用的 code；<br>`share`触发用户转发，使用前建议先阅读使用指引；<br>`getPhoneNumber`获取用户手机号，可以从 bindgetphonenumber 回调中获取到用户信息，具体说明（小程序插件中不能使用）；<br>`getUserInfo`获取用户信息，可以从 bindgetuserinfo 回调中获取到用户信息 （小程序插件中不能使用）；<br>`launchApp`打开APP，可以通过 app-parameter 属性设定向 APP 传的参数具体说明；<br>`openSetting`打开授权设置页；<br>`feedback`打开“意见反馈”页面，用户可提交反馈内容并上传日志，开发者可以登录小程序管理后台后进入左侧菜单“客服反馈”页面获取到反馈内容；<br>`chooseAvatar`获取用户头像，可以从 bindchooseavatar 回调中获取到头像信息；<br>`agreePrivacyAuthorization`用户同意隐私协议按钮。用户点击一次此按钮后，所有隐私接口可以正常调用。可通过`bindagreeprivacyauthorization`监听用户同意隐私协议事件。隐私合规开发指南详情可见《小程序隐私协议开发指南》。<br>小程序官方文档。可选项：contact/share/getPhoneNumber/getUserInfo/launchApp/openSetting/feedback/chooseAvatar/agreePrivacyAuthorization | N |
| phone-number-no-quota-toast | Boolean | true | 原生按钮属性，当手机号快速验证或手机号实时验证额度用尽时，是否对用户展示“申请获取你的手机号，但该功能使用次数已达当前小程序上限，暂时无法使用”的提示，默认展示，open-type="getPhoneNumber" 或 open-type="getRealtimePhoneNumber" 时有效 | N |
| send-message-img | String | 截图 | 会话内消息卡片图片，open-type="contact"时有效 | N |
| send-message-path | String | 当前分享路径 | 会话内消息卡片点击跳转小程序路径，open-type="contact"时有效 | N |
| send-message-title | String | 当前标题 | 会话内消息卡片标题，open-type="contact"时有效 | N |
| session-from | String | - | 会话来源，open-type="contact"时有效 | N |
| shape | String | rectangle | 按钮形状，有 4 种：长方形、正方形、圆角长方形、圆形。可选项：rectangle/square/round/circle | N |
| show-message-card | Boolean | false | 是否显示会话内消息卡片，设置此参数为 true，用户进入客服会话会在右下角显示"可能要发送的小程序"提示，用户点击后可以快速发送小程序消息，open-type="contact"时有效 | N |
| size | String | medium | 组件尺寸。可选项：extra-small/small/medium/large | N |
| t-id | String | - | 按钮标签id | N |
| theme | String | default | 组件风格，依次为品牌色、危险色。可选项：default/primary/danger/light | N |
| type | String | - | 同小程序的 formType。可选项：submit/reset | N |
| variant | String | base | 按钮形式，基础、线框、虚线、文字。可选项：base/outline/dashed/text | N |

### ButtonEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| agreeprivacyauthorization | - | 原生按钮属性，用户同意隐私协议事件回调，open-type=agreePrivacyAuthorization时有效 （Tips: 如果使用 onNeedPrivacyAuthorization 接口，需要在 bindagreeprivacyauthorization 触发后再调用 resolve({ event: "agree", buttonId })） |
| chooseavatar | - | 原生按钮属性，获取用户头像回调，`open-type=chooseAvatar`时有效。返回`e.detail.avatarUrl`为头像临时文件链接 |
| click | `(e: MouseEvent)` | 点击时触发 |
| contact | - | 原生按钮属性，客服消息回调，`open-type="contact"`时有效 |
| createliveactivity | - | 新的一次性订阅消息下发机制回调，`open-type=liveActivity`时有效 |
| error | - | 原生按钮属性，当使用开放能力时，发生错误的回调，`open-type=launchApp`时有效 |
| getphonenumber | - | 原生按钮属性，手机号快速验证回调，open-type=getPhoneNumber时有效。Tips：在触发 bindgetphonenumber 回调后应立即隐藏手机号按钮组件，或置为 disabled 状态，避免用户重复授权手机号产生额外费用 |
| getrealtimephonenumber | - | 原生按钮属性，手机号实时验证回调，open-type=getRealtimePhoneNumber 时有效。Tips：在触发 bindgetrealtimephonenumber 回调后应立即隐藏手机号按钮组件，或置为 disabled 状态，避免用户重复授权手机号产生额外费用 |
| getuserinfo | - | 原生按钮属性，用户点击该按钮时，会返回获取到的用户信息，回调的detail数据与wx.getUserInfo返回的一致，open-type="getUserInfo"时有效 |
| launchapp | - | 打开 APP 成功的回调，`open-type=launchApp`时有效 |
| opensetting | - | 原生按钮属性，在打开授权设置页后回调，open-type=openSetting时有效 |
| tap | `event` | 点击按钮，当按钮不为加载或禁用状态时触发 |

### ButtonSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| content | 自定义`content`显示内容 |
| suffix | 右侧内容，可用于定义右侧图标 |

### ButtonExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-icon | 图标样式类 |
| t-class-loading | 加载样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-button-border-radius | @radius-default | - |
| --td-button-border-width | 4rpx | - |
| --td-button-danger-active-bg-color | @error-color-active | - |
| --td-button-danger-active-border-color | @error-color-active | - |
| --td-button-danger-bg-color | @error-color | - |
| --td-button-danger-border-color | @error-color | - |
| --td-button-danger-color | @text-color-anti | - |
| --td-button-danger-dashed-border-color | @button-danger-dashed-color | - |
| --td-button-danger-dashed-color | @error-color | - |
| --td-button-danger-dashed-disabled-color | @button-danger-disabled-color | - |
| --td-button-danger-disabled-bg | @error-color-3 | - |
| --td-button-danger-disabled-border-color | @error-color-3 | - |
| --td-button-danger-disabled-color | @font-white-1 | - |
| --td-button-danger-outline-active-bg-color | @bg-color-container-active | - |
| --td-button-danger-outline-active-border-color | @error-color-active | - |
| --td-button-danger-outline-border-color | @button-danger-outline-color | - |
| --td-button-danger-outline-color | @error-color | - |
| --td-button-danger-outline-disabled-color | @error-color-3 | - |
| --td-button-danger-text-active-bg-color | @bg-color-container-active | - |
| --td-button-danger-text-color | @error-color | - |
| --td-button-danger-text-disabled-color | @button-danger-disabled-color | - |
| --td-button-default-active-bg-color | @bg-color-component-active | - |
| --td-button-default-active-border-color | @bg-color-component-active | - |
| --td-button-default-bg-color | @bg-color-component | - |
| --td-button-default-border-color | @bg-color-component | - |
| --td-button-default-color | @text-color-primary | - |
| --td-button-default-disabled-bg | @bg-color-component-disabled | - |
| --td-button-default-disabled-border-color | @bg-color-component-disabled | - |
| --td-button-default-disabled-color | @text-color-disabled | - |
| --td-button-default-outline-active-bg-color | @bg-color-container-active | - |
| --td-button-default-outline-active-border-color | @component-border | - |
| --td-button-default-outline-border-color | @component-border | - |
| --td-button-default-outline-color | @text-color-primary | - |
| --td-button-default-outline-disabled-color | @component-border | - |
| --td-button-default-text-active-bg-color | @bg-color-container-active | - |
| --td-button-extra-small-font-size | @font-size-base | - |
| --td-button-extra-small-height | 56rpx | - |
| --td-button-extra-small-icon-size | 36rpx | - |
| --td-button-extra-small-padding-horizontal | 16rpx | - |
| --td-button-font-weight | 600 | - |
| --td-button-ghost-border-color | @button-ghost-color | - |
| --td-button-ghost-color | @text-color-anti | - |
| --td-button-ghost-danger-border-color | @error-color | - |
| --td-button-ghost-danger-color | @error-color | - |
| --td-button-ghost-danger-hover-color | @error-color-active | - |
| --td-button-ghost-disabled-color | @font-white-4 | - |
| --td-button-ghost-hover-color | @font-white-2 | - |
| --td-button-ghost-primary-border-color | @brand-color | - |
| --td-button-ghost-primary-color | @brand-color | - |
| --td-button-ghost-primary-hover-color | @brand-color-active | - |
| --td-button-icon-border-radius | 8rpx | - |
| --td-button-icon-spacer | @spacer | - |
| --td-button-large-font-size | @font-size-m | - |
| --td-button-large-height | 96rpx | - |
| --td-button-large-icon-size | 48rpx | - |
| --td-button-large-padding-horizontal | 40rpx | - |
| --td-button-light-active-bg-color | @brand-color-light-active | - |
| --td-button-light-active-border-color | @brand-color-light-active | - |
| --td-button-light-bg-color | @brand-color-light | - |
| --td-button-light-border-color | @brand-color-light | - |
| --td-button-light-color | @brand-color | - |
| --td-button-light-disabled-bg | @brand-color-light | - |
| --td-button-light-disabled-border-color | @brand-color-light | - |
| --td-button-light-disabled-color | @brand-color-disabled | - |
| --td-button-light-outline-active-bg-color | @brand-color-light-active | - |
| --td-button-light-outline-active-border-color | @brand-color-active | - |
| --td-button-light-outline-bg-color | @brand-color-light | - |
| --td-button-light-outline-border-color | @button-light-outline-color | - |
| --td-button-light-outline-color | @brand-color | - |
| --td-button-light-outline-disabled-color | @brand-color-disabled | - |
| --td-button-light-text-active-bg-color | @bg-color-container-active | - |
| --td-button-light-text-color | @brand-color | - |
| --td-button-medium-font-size | @font-size-m | - |
| --td-button-medium-height | 80rpx | - |
| --td-button-medium-icon-size | 40rpx | - |
| --td-button-medium-padding-horizontal | 32rpx | - |
| --td-button-primary-active-bg-color | @brand-color-active | - |
| --td-button-primary-active-border-color | @brand-color-active | - |
| --td-button-primary-bg-color | @brand-color | - |
| --td-button-primary-border-color | @brand-color | - |
| --td-button-primary-color | @text-color-anti | - |
| --td-button-primary-dashed-border-color | @button-primary-dashed-color | - |
| --td-button-primary-dashed-color | @brand-color | - |
| --td-button-primary-dashed-disabled-color | @brand-color-disabled | - |
| --td-button-primary-disabled-bg | @brand-color-disabled | - |
| --td-button-primary-disabled-border-color | @brand-color-disabled | - |
| --td-button-primary-disabled-color | @text-color-anti | - |
| --td-button-primary-outline-active-bg-color | @bg-color-container-active | - |
| --td-button-primary-outline-active-border-color | @brand-color-active | - |
| --td-button-primary-outline-border-color | @button-primary-outline-color | - |
| --td-button-primary-outline-color | @brand-color | - |
| --td-button-primary-outline-disabled-color | @brand-color-disabled | - |
| --td-button-primary-text-active-bg-color | @bg-color-container-active | - |
| --td-button-primary-text-color | @brand-color | - |
| --td-button-primary-text-disabled-color | @brand-color-disabled | - |
| --td-button-small-font-size | @font-size-base | - |
| --td-button-small-height | 64rpx | - |
| --td-button-small-icon-size | 36rpx | - |
| --td-button-small-padding-horizontal | 24rpx | - |