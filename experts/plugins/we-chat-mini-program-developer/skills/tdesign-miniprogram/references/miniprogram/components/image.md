# Image 图片

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-image": "tdesign-miniprogram/image/image"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/Ntye2Mmz895A)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 裁切样式

**WXML** (`html`):
```html
<view class="tr">
<view class="col">
<view class="text">裁切</view>
<t-image src="{{imageSrc}}" mode="aspectFill" width="72" height="72" aria-label="一个放置在墙角的黄色行李箱" />
</view>
<view class="col">
<view class="text">适应高</view>
<t-image src="{{imageSrc}}" mode="heightFix" width="72" height="72" aria-label="一个放置在墙角的黄色行李箱" />
</view>
<view class="col">
<view class="text">拉伸</view>
<t-image src="{{imageSrc}}" width="72" height="72" aria-label="一个放置在墙角的黄色行李箱" />
</view>
</view>

<view class="tr">
<view class="col">
<view class="text">方形</view>
<t-image src="{{imageSrc}}" mode="aspectFill" width="72" height="72" aria-label="一个放置在墙角的黄色行李箱" />
</view>
<view class="col">
<view class="text">圆角方形</view>
<t-image src="{{imageSrc}}" width="72" height="72" shape="round" aria-label="一个放置在墙角的黄色行李箱" />
</view>
<view class="col">
<view class="text">圆形</view>
<t-image src="{{imageSrc}}" width="72" height="72" shape="circle" aria-label="一个放置在墙角的黄色行李箱" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
imageSrc: 'https://tdesign.gtimg.com/mobile/demos/image1.jpeg',
},
});

```

**CSS** (`css`):
```css
.tr {
display: flex;
}

.col {
margin: 0 32rpx;
}

.tr + .tr {
margin-top: 48rpx;
}

.text {
font-size: 28rpx;
color: var(--td-text-color-secondary);
line-height: 44rpx;
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-image": "tdesign-miniprogram/image/image"
}
}

```

### 加载状态

**WXML** (`html`):
```html
<view class="tr">
<view class="col">
<view class="text">加载默认提示</view>
<t-image id="loading-img" shape="round" width="72" height="72" />
</view>
<view class="col">
<view class="text">加载自定义提示</view>
<t-image id="loading-img-custom" shape="round" loading="slot" width="72" height="72">
<t-loading slot="loading" theme="spinner" size="40rpx" loading />
</t-image>
</view>
</view>

<view class="tr">
<view class="col">
<view class="text">失败默认提示</view>
<t-image id="loading-img" shape="round" src="" width="72" height="72" />
</view>
<view class="col">
<view class="text">失败自定义提示</view>
<t-image src="" shape="round" error="slot" width="72" height="72">
<text class="error-text" slot="error">加载失败</text>
</t-image>
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
pageLifetimes: {
show: function () {
const $ele1 = this.selectComponent('#loading-img');
const $ele2 = this.selectComponent('#loading-img-custom');

this.setLoadingStatus($ele1);
this.setLoadingStatus($ele2);
},
},
methods: {
setLoadingStatus(ele) {
ele.onLoadError = null;
ele.onLoaded = null;
ele.setData({
isLoading: true,
isFailed: false,
});
},
},
});

```

**CSS** (`css`):
```css
.tr {
display: flex;
}

.col {
margin: 0 32rpx;
}

.tr + .tr {
margin-top: 48rpx;
}

.text {
font-size: 28rpx;
color: var(--td-text-color-secondary);
line-height: 44rpx;
margin-bottom: 32rpx;
}

.error-text {
font-size: 20rpx;
font-weight: 400;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-image": "tdesign-miniprogram/image/image",
"t-loading": "tdesign-miniprogram/loading/loading"
}
}

```

## 常见问题

本地图片无法正确引用? 👇
建议使用绝对路径，而不是相对路径。绝对路径以 app.json 所在位置为基准。

## API

### ImageProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| error | String | 'default' | 加载失败时显示的内容。值为`default`则表示使用默认加载失败风格；值为空或者`slot`表示使用插槽渲染，插槽名称为`error`；值为其他则表示普通文本内容，如“加载失败” | N |
| height | String / Number | - | 高度，默认单位为`px` | N |
| lazy | Boolean | false | 是否开启图片懒加载 | N |
| loading | String | 'default' | 加载态内容。值为`default`则表示使用默认加载中风格；值为其他则表示普通文本内容，如“加载中” | N |
| mode | String | scaleToFill | 图片裁剪、缩放的模式；小程序官方文档。可选项：scaleToFill/aspectFit/aspectFill/widthFix/heightFix/top/bottom/center/left/right/top left/top right/bottom left/bottom right | N |
| shape | String | square | 图片圆角类型。可选项：circle/round/square | N |
| show-menu-by-longpress | Boolean | false | 长按图片显示发送给朋友、收藏、保存图片、搜一搜、打开名片/前往群聊/打开小程序（若图片中包含对应二维码或小程序码）的菜单 | N |
| src | String | - | 图片链接 | N |
| t-id | String | - | `1.2.10`。图片标签id | N |
| webp | Boolean | false | 默认不解析 webP 格式，只支持网络资源 | N |
| width | String / Number | - | 宽度，默认单位为`px` | N |

### ImageEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| error | - | 图片加载失败时触发。通用类型定义 |
| load | - | 图片加载完成时触发。通用类型定义 |

### ImageSlots

| 名称 | 描述 |
| --- | --- |
| error | 自定义`error`显示内容 |
| loading | 自定义`loading`显示内容 |

### ImageExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-load | 加载样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-image-color | @text-color-placeholder | - |
| --td-image-loading-bg-color | @bg-color-secondarycontainer | - |
| --td-image-loading-color | @text-color-placeholder | - |
| --td-image-round-radius | @radius-default | - |