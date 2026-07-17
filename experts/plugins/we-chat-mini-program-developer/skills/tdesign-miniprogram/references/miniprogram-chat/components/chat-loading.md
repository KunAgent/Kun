# ChatLoading 对话加载

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-loading": "tdesign-miniprogram/chat-loading/chat-loading"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/GQYNbtmE8g4C)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

支持多种加载中动效类型，包括 gradient、moving、dots

**WXML** (`html`):
```html
<view class="chat-example">
<!-- <view class="chat-example-block">
<t-chat-loading animation="skeleton" />
</view> -->
<view class="chat-example-block">
<t-chat-loading animation="gradient" />
</view>
<view class="chat-example-block">
<t-chat-loading animation="moving" />
</view>
<view class="chat-example-block">
<t-chat-loading animation="dots" />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
currentAnimation: 'skeleton',
loadingText: '',
animations: [
{ key: 'moving', text: '正在理解中...' },
{ key: 'gradient', text: '深度思考中...' },
{ key: 'circle', text: '加载中...' },
{ key: 'skeleton', text: '' },
],
},

onLoad() {
// 模拟动画切换
this.startAnimationCycle();
},

startAnimationCycle() {
let index = 0;
this.animationTimer = setInterval(() => {
const animation = this.data.animations[index];
this.setData({
currentAnimation: animation.key,
loadingText: animation.text,
});

index = (index + 1) % this.data.animations.length;
}, 2000); // 每2秒切换一次动画
},

onUnload() {
// 清理定时器
if (this.animationTimer) {
clearInterval(this.animationTimer);
}
},

// 手动切换动画类型
switchAnimation(e) {
const { animation } = e.currentTarget.dataset;
const animationData = this.data.animations.find((item) => item.key === animation);

if (animationData) {
this.setData({
currentAnimation: animationData.key,
loadingText: animationData.text,
});
}
},
});

```

**CSS** (`css`):
```css
.chat-example {
background-color: var(--td-bg-color-container);
padding: 32rpx;
display: flex;
align-items: center;
gap: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-loading": "tdesign-miniprogram/chat-loading/chat-loading",
"t-col": "tdesign-miniprogram/col/col",
"t-row": "tdesign-miniprogram/row/row"
}
}

```

#### 带文案描述的加载组件

**WXML** (`html`):
```html
<view class="chat-example">
<view class="chat-example-block">
<t-chat-loading animation="dots" text="加载中..." />
</view>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {},
});

```

**CSS** (`css`):
```css
.chat-example {
background-color: var(--td-bg-color-container);
padding: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"usingComponents": {
"t-chat-loading": "tdesign-miniprogram/chat-loading/chat-loading"
}
}

```

## API

### ChatLoadingProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| animation | String | moving | 加载的状态形式。可选项：skeleton/moving/gradient/dot | N |
| text | String | - | 加载过程展示的文字内容 | N |