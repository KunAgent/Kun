# snapshot 截图组件

## 概述

`snapshot` 是 Skyline 新增的截图组件，可以将组件内的内容渲染为图片。适用于生成分享海报、保存页面截图等场景。

## 基本用法

```html
<snapshot id="my-snapshot">
  <view class="poster">
    <image src="{{productImage}}" />
    <text>{{productName}}</text>
    <text>¥{{productPrice}}</text>
  </view>
</snapshot>

<button bindtap="takeSnapshot">生成图片</button>
```

```javascript
Page({
  takeSnapshot() {
    this.createSelectorQuery()
      .select('#my-snapshot')
      .node()
      .exec(res => {
        const snapshotNode = res[0].node
        snapshotNode.takeSnapshot({
          type: 'arraybuffer',
          format: 'png',
          success: (res) => {
            // res.data 是图片的 ArrayBuffer
            const fs = wx.getFileSystemManager()
            const filePath = `${wx.env.USER_DATA_PATH}/snapshot.png`
            fs.writeFile({
              filePath,
              data: res.data,
              encoding: 'binary',
              success: () => {
                // 保存到相册
                wx.saveImageToPhotosAlbum({
                  filePath,
                  success: () => {
                    wx.showToast({ title: '保存成功' })
                  }
                })
              }
            })
          },
          fail: (err) => {
            console.error('截图失败', err)
          }
        })
      })
  }
})
```

## takeSnapshot 方法

### 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| type | string | file | 输出类型：file/arraybuffer |
| format | string | png | 图片格式：png/jpg |
| quality | number | 1.0 | jpg 质量（0-1） |
| success | function | - | 成功回调 |
| fail | function | - | 失败回调 |

### 返回值

| 属性 | 类型 | 说明 |
|------|------|------|
| data | string/ArrayBuffer | type=file 时为临时文件路径，type=arraybuffer 时为 ArrayBuffer |
| width | number | 图片宽度 |
| height | number | 图片高度 |

## 示例代码

### 生成分享海报

```html
<view class="container">
  <!-- 海报预览 -->
  <snapshot id="poster" class="poster">
    <view class="poster-content">
      <!-- 商品图片 -->
      <image class="product-image" src="{{product.image}}" mode="aspectFill" />
      
      <!-- 商品信息 -->
      <view class="product-info">
        <text class="product-name">{{product.name}}</text>
        <text class="product-desc" max-lines="2" overflow="ellipsis">
          {{product.desc}}
        </text>
        <view class="price-row">
          <text class="price">¥{{product.price}}</text>
          <text class="original-price">¥{{product.originalPrice}}</text>
        </view>
      </view>
      
      <!-- 底部信息 -->
      <view class="poster-footer">
        <image class="qrcode" src="{{qrcodeUrl}}" />
        <view class="footer-text">
          <text>长按识别小程序码</text>
          <text>立即购买</text>
        </view>
      </view>
    </view>
  </snapshot>
  
  <!-- 操作按钮 -->
  <view class="actions">
    <button class="save-btn" bindtap="saveToAlbum">保存到相册</button>
    <button class="share-btn" open-type="share">分享给好友</button>
  </view>
</view>
```

```css
.poster {
  width: 300px;
  margin: 20px auto;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.poster-content {
  background: #fff;
}

.product-image {
  width: 100%;
  height: 300px;
}

.product-info {
  padding: 16px;
}

.product-name {
  display: block;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.product-desc {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #999;
  line-height: 1.5;
}

.price-row {
  display: flex;
  align-items: baseline;
  margin-top: 12px;
}

.price {
  font-size: 20px;
  font-weight: bold;
  color: #f5222d;
}

.original-price {
  margin-left: 8px;
  font-size: 12px;
  color: #999;
  text-decoration: line-through;
}

.poster-footer {
  display: flex;
  align-items: center;
  padding: 16px;
  border-top: 1px solid #eee;
}

.qrcode {
  width: 60px;
  height: 60px;
}

.footer-text {
  margin-left: 12px;
}

.footer-text text {
  display: block;
  font-size: 12px;
  color: #666;
}

.actions {
  display: flex;
  padding: 20px;
}

.save-btn,
.share-btn {
  flex: 1;
  margin: 0 8px;
}
```

```javascript
Page({
  data: {
    product: {
      image: 'https://example.com/product.jpg',
      name: '精选商品名称',
      desc: '这是商品的详细描述信息，可能会很长，需要截断显示...',
      price: '99.00',
      originalPrice: '199.00'
    },
    qrcodeUrl: '' // 小程序码
  },
  
  onLoad() {
    this.generateQrcode()
  },
  
  generateQrcode() {
    // 调用云函数生成小程序码
    wx.cloud.callFunction({
      name: 'getQrcode',
      data: { page: 'pages/product/index', scene: this.data.product.id },
      success: res => {
        this.setData({ qrcodeUrl: res.result.url })
      }
    })
  },
  
  saveToAlbum() {
    wx.showLoading({ title: '生成中...' })
    
    this.createSelectorQuery()
      .select('#poster')
      .node()
      .exec(res => {
        const snapshotNode = res[0].node
        snapshotNode.takeSnapshot({
          type: 'arraybuffer',
          format: 'png',
          success: (result) => {
            const fs = wx.getFileSystemManager()
            const filePath = `${wx.env.USER_DATA_PATH}/poster_${Date.now()}.png`
            
            fs.writeFile({
              filePath,
              data: result.data,
              encoding: 'binary',
              success: () => {
                wx.saveImageToPhotosAlbum({
                  filePath,
                  success: () => {
                    wx.hideLoading()
                    wx.showToast({ title: '已保存到相册' })
                  },
                  fail: (err) => {
                    wx.hideLoading()
                    if (err.errMsg.includes('auth deny')) {
                      wx.showModal({
                        title: '提示',
                        content: '请授权保存图片到相册',
                        success: (res) => {
                          if (res.confirm) {
                            wx.openSetting()
                          }
                        }
                      })
                    }
                  }
                })
              }
            })
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: '生成失败', icon: 'error' })
            console.error(err)
          }
        })
      })
  }
})
```

### 隐藏截图区域

如果不想在页面上显示截图内容，可以将其移到屏幕外：

```html
<view class="snapshot-container" style="position: fixed; left: -9999px;">
  <snapshot id="hidden-snapshot">
    <view class="content">
      <!-- 截图内容 -->
    </view>
  </snapshot>
</view>
```

## 注意事项

1. **仅限 Skyline**：snapshot 组件仅在 Skyline 渲染模式下可用
2. **内容限制**：截图内容必须在 snapshot 组件内部
3. **图片加载**：确保组件内的图片已加载完成再截图
4. **性能考虑**：大尺寸截图可能耗时较长，建议显示加载状态
5. **权限**：保存到相册需要用户授权

## 与 canvas 截图对比

| 特性 | snapshot | canvas |
|------|----------|--------|
| 使用复杂度 | 简单（直接包裹内容） | 复杂（需要绑制代码） |
| 性能 | 较好 | 一般 |
| 内容支持 | 任意 WXML 内容 | 需要手动绘制 |
| 兼容性 | 仅 Skyline | 通用 |
| 定制能力 | 使用 WXSS 样式 | 完全自定义 |

## 最佳实践

### 1. 等待图片加载

```javascript
Page({
  data: {
    imagesLoaded: 0,
    totalImages: 3
  },
  
  onImageLoad() {
    const loaded = this.data.imagesLoaded + 1
    this.setData({ imagesLoaded: loaded })
    if (loaded === this.data.totalImages) {
      this.setData({ canSnapshot: true })
    }
  }
})
```

### 2. 使用 jpg 减小文件大小

```javascript
snapshotNode.takeSnapshot({
  type: 'arraybuffer',
  format: 'jpg',
  quality: 0.8, // 80% 质量
  success: (res) => {
    // ...
  }
})
```

### 3. 处理授权被拒

```javascript
wx.saveImageToPhotosAlbum({
  filePath,
  fail: (err) => {
    if (err.errMsg.includes('auth deny')) {
      wx.showModal({
        title: '需要授权',
        content: '保存图片需要您授权访问相册',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.openSetting()
          }
        }
      })
    }
  }
})
```
