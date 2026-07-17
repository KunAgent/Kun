# Icon 图标

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-icon": "tdesign-miniprogram/icon/icon"
}
```

## 常见问题

控制台告警：Failed to load font 👇
告警属于开发者工具的 bug，可以忽略，具体可以看 [官网文档](https://developers.weixin.qq.com/miniprogram/dev/api/ui/font/wx.loadFontFace.html)

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/7OxuPMmW8X5w)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础组件图标

**WXML** (`html`):
```html
<view class="demo__list">
<view class="demo__card" wx:for="{{icons}}" wx:key="index">
<t-icon name="{{item}}" size="48rpx" data-name="{{item}}" bind:click="onIconTap" />
<view class="demo__card-name">{{item}}</view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
import icons from '../data';

Component({
data: {
icons,
},

methods: {
onIconTap(event) {
const { name, type } = event.currentTarget.dataset;
if (type === 'prefix') return;
wx.showToast({ title: name, icon: 'none', duration: 1000 });
},
},
});

```

**CSS** (`css`):
```css
.demo__list {
display: flex;
flex-wrap: wrap;
padding: 16rpx 32rpx;
}

.demo__card {
flex: 0 0 25%;
text-align: center;
margin-bottom: 30rpx;
color: var(--td-text-color-primary);
}

.demo__card-name {
font-size: 24rpx;
color: #999;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

### 自定义组件图标

**WXML** (`html`):
```html
<view class="demo__list">
<view class="demo__card" wx:for="{{prefixIcons}}" wx:key="index">
<t-icon name="{{item}}" size="48rpx" prefix="icon" data-name="{{item}}" data-type="prefix" bind:click="onIconTap" />
<view class="demo__card-name">{{item}}</view>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
prefixIcons: ['a-0', 'a-1h', 'a-2h', 'a-3h'],
},
methods: {
onIconTap(event) {
const { name, type } = event.currentTarget.dataset;
if (type === 'prefix') return;
wx.showToast({ title: name, icon: 'none', duration: 1000 });
},
},
});

```

**CSS** (`css`):
```css
.demo__list {
display: flex;
flex-wrap: wrap;
padding: 16rpx 32rpx;
}

.demo__card {
flex: 0 0 25%;
text-align: center;
}

.demo__card-name {
font-size: 24rpx;
color: #999;
}

/* 自定义图标 */
@font-face {
font-family: 'icon'; /* Project id 3144196 */
src: url('data:application/x-font-woff2;charset=utf-8;base64,d09GMgABAAAAAAPUAAsAAAAACGAAAAOFAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHFQGYACDGgqEPIQBATYCJAMUCwwABCAFhDcHQhtVBxHVmy/JfhzGjunMd9u7ZdNoJGL95+B5ckPfvzsIgZjoVHHRKe1qNlEdfUoAPFpzlgKhvLdV7dpf4MyYhRbmw1+ObxM9+wDSmJP2okWn0XkEe1sWSOAJJR4mYA3TSx7kD48ggEsZ9VFNm7ftSsjYQVPHk4DBlwpUtTJ21IhBONyBmagVHAR76U6DbMQCtUo9BzZk75cfVIgDCkvjn9NxeLOhPPTb+R31wtqF6PckEgQ4WwEWoIGih7mk93SgK7pIF6FxhwKGPDTZIOB3rK312yWKZ//hgaDQGBAbvzoIgIYwY8BvFxEI+O0JFPgdCDT4HVVfpN0CwAWWfQ68w1yWUQUvFRUUEJMZ0zBmzKILZ26suXbqHGrh2ZNXV18/fV68hafWnInRi06vPskQ3VV6eKqH9vB2nPDWbNu2C1xZtH31VhgiPfbE7kmo2ba78+R9oy6cueOtuXVuHwt3+kNEdfVYNWfEmhMii067q3cK6kYqetu26F2w6GjUtlO79uXprVE7b7r38YsHl62wxmwPBrvdDvyl7A2Os2v65berseOS461n/fL6PbPim4dlpFSGJIdmpmSGMm3NvmaVrZtVNPePPcwtGCU9i0KcX3dKyKGCTUFnY9aHrCNjTeN5PzcGxQd6498Eh4WH5zXPjbbvdIxJHLz4dnx4QLNlC4Y/nd98/MZvwLSjqfOTGoRGhEX8dfOa50XbtyfEJHVbM+JAnW7F8SnLQr7+lxVUpFRN6PF4ZnpY62/ZybnNs8Ki0qIimiWf7HroYciPBM85E3+uGqdmAKjPamomzPiEAAJN2zkJA0Lr/nY8A8DHwLJq4DAszzgoYIrfbuy7UNRYGTKaoc7Ih2BddD9goQJcXKDWj0Tw8RhT5OIkCKahZFAEEAuNIYUyXAYsPHJgYyiHSyHV+z0iGYhGTCCQwxQAwWEXFCEcgsbhAmW4G7CI4QFsHF7AxXn+ZQ85QYZDxpFxgekHag6eQj1npVcULztmKY8ST8xFwTh0dVvPXdBjXrOmvEXPTEA5ODhvvQ+tDRBz0DhzLZnjvmlo6Cn1HNzqkHFkXIDpB6g5eEos3Fx+RfGyYx5QZ74nQl3hclgPdNS0E9TF4Ce7XrS+vEUPMwFkq4MDzlf70AbpAMThaRpnrpEbknFPg8RoqaG+1uTekpz14a+2RIkWI5bYbAdV7S6ydTKm+/ggVysAAAA=')
format('woff2'),
url('//at.alicdn.com/t/font_3144196_s14ifjx2cyi.woff?t=1642299317916') format('woff'),
url('//at.alicdn.com/t/font_3144196_s14ifjx2cyi.ttf?t=1642299317916') format('truetype');
}

.icon {
font-family: 'icon' !important;
font-size: 16px;
font-style: normal;
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
}

.icon-a-0:before {
content: '\e64d';
}

.icon-a-1h:before {
content: '\e64e';
}

.icon-a-2h:before {
content: '\e64f';
}

.icon-a-3h:before {
content: '\e650';
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

自定义图标用法，下面以 `iconfont` 为例

#### 准备图标文件

文件后缀应为`.wxss`，如下方代码块所示：

```css
@font-face {
font-family: 'icon';  // 使用自定义的字体名称
···
}

.icon {
font-family: 'icon' !important;  // 字体名称
···
}

.icon-a-0:before {  // icon 图标。注意 FontClass 前缀与 font-family 保持一致
content: '\e64d';
}
```

- 添加所需图标，下载图标。图标库一般会提供 **在线链接** 或者 **下载至本地** 等使用方式。**在线链接** 方式会指向一个 `.css` 文件，可以下载或复制其内容，将其修改成后缀名为 `.wxss` 的文件
- 将 `.wxss` 文件中的 `FontClass/Symbol前缀` 与 `Font Family` 两项内容保持一致，如: `FontClass/Symbol` 前缀为 `icon-`，则 `Font Family` 为 `icon`。

> 注：若是采用 `下载至本地` 方式，需关注 `.css` 和 `.ttf` 文件。由于微信小程序不支持处理 `ttf、woff、eot` 等文件，但支持 `base64`，所以需要将 `.ttf` 文件转换为 `base64` (可借助转换工具，如 [transfonter.org](https://transfonter.org/)，会得到一个 `stylesheet.css` 文件)，然后将 `.css` 文件中的 `@font-face {}` 内容替换为 `stylesheet.css` 中的 `base64` 内容，最后将 `.css` 文件修改后缀为 `.wxss`

#### 引入自定义图标

- 全局引入：在项目 `app.wxss`，使用 `@import` 引入上述的 `.wxss` 文件
- 局部引入：在 `page` 对应的 `.wxss` 中，使用 `@import` 引入上述的 `.wxss` 文件

#### 自定义图标的使用

`<t-icon>` 组件中的 `prefix` 属性值与前面设置的 `Font Family` 保持一致，即 `prefix="icon"`，`name` 属性值为自定义图标名称，如图标的 `className` 为 `icon-a-1h`，则 `name="a-1h"`。

### 图片链接

**WXML** (`html`):
```html
<view class="demo__list">
<view class="demo__card" wx:for="{{imageIconList}}" wx:key="index">
<t-icon name="{{item}}" size="48rpx" data-name="{{item}}" bind:click="onIconTap" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
imageIconList: [
'https://tdesign.gtimg.com/mobile/demos/icon1.png',
'https://tdesign.gtimg.com/mobile/demos/icon2.png',
],
},

methods: {
onIconTap(event) {
const { name, type } = event.currentTarget.dataset;
if (type === 'prefix') return;
wx.showToast({ title: name, icon: 'none', duration: 1000 });
},
},
});

```

**CSS** (`css`):
```css
.demo__list {
display: flex;
flex-wrap: wrap;
padding: 16rpx 32rpx;
}

.demo__card {
flex: 0 0 25%;
display: flex;
justify-content: center;
text-align: center;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

### 全部图标

大部分图标在 1.8.0 版本中新增，如果发现引入组件库后，部分图标无法使用，请检查安装的组件库`tdesign-miniprogram`的版本。支持中文英文搜索，如果觉得可以再增加其他关键词提示，欢迎到 [图标仓库](https://github.com/Tencent/tdesign-icons/blob/develop/packages/view/src/manifest.js) 提交PR，帮我们一起补充。

## API

### IconProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| color | String | - | 图标颜色 | N |
| name | String | - | 必需。图标名称或图片链接 | Y |
| prefix | String | - | 自定义图标前缀 | N |
| size | String / Number | - | 图标大小, 如`20`,`20px`,`48rpx`, 默认单位是`px` | N |

### IconEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| click | - | 点击图标时触发。通用类型定义 |

### IconExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| ant: norma | ant: norma | - |