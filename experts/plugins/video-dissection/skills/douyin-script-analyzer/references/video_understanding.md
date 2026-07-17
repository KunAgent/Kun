# 火山方舟视频理解技术参考

## 概述

本模块使用字节跳动火山方舟（Volcengine ARK）视频理解 API 对视频进行深度分析。通过 Files API 上传视频，结合 Responses API 进行拍摄手法分析。

---

## API 架构

### 核心端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `https://ark.cn-beijing.volces.com/api/v3/files` | POST | 上传视频文件 |
| `https://ark.cn-beijing.volces.com/api/v3/files/{file_id}` | GET | 查询文件处理状态 |
| `https://ark.cn-beijing.volces.com/api/v3/responses` | POST | 创建视频理解任务 |

---

## 技术流程

### 步骤 1：上传视频文件

**Files API 上传**：
```bash
curl https://ark.cn-beijing.volces.com/api/v3/files \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F 'purpose=user_data' \
  -F 'file=@video.mp4' \
  -F 'preprocess_configs[video][fps]=1'
```

**响应示例**：
```json
{
  "id": "file-xxxxx",
  "status": "pending",
  "bytes": 15728640
}
```

**关键参数**：
- `purpose`: 必须为 `user_data`
- `preprocess_configs[video][fps]`: 视频采样帧率，影响分析精度

---

### 步骤 2：等待预处理

**轮询状态查询**：
```bash
curl https://ark.cn-beijing.volces.com/api/v3/files/{file_id} \
  -H "Authorization: Bearer $ARK_API_KEY"
```

**状态值**：
- `pending`：等待处理
- `processing`：正在预处理
- `processed`：预处理完成（可使用）
- `active`：文件就绪
- `error`：处理失败

**轮询策略**：每 2 秒查询一次，最长等待 180 秒

---

### 步骤 3：创建视频理解任务

**Responses API**：
```json
{
  "model": "doubao-seed-2-0-pro-260215",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_video",
          "file_id": "file-xxxx"
        },
        {
          "type": "input_text",
          "text": "请分析这段视频的拍摄手法..."
        }
      ]
    }
  ]
}
```

**响应提取**：
```json
{
  "output": [
    {
      "type": "message",
      "content": [
        {
          "type": "output_text",
          "text": "分析结果内容..."
        }
      ]
    }
  ]
}
```

---

## 支持的模型

| 模型 ID | 说明 |
|---------|------|
| `doubao-seed-2-0-pro-260215` | 默认模型，效果最好 |
| `doubao-seed-2-0-lite-250728` | 轻量版，速度更快 |
| `doubao-seed-1-6-251015` | 基础版 |

---

## FPS 设置建议

| FPS | 适用场景 |
|-----|---------|
| 0.3-0.5 | 慢节奏视频、静态场景、节省 token |
| 1 | 一般视频分析（默认） |
| 2-3 | 快速动作、细节分析 |

---

## 限制

| 限制项 | 说明 |
|-------|------|
| **视频格式** | MP4（推荐）、MOV、AVI |
| **文件大小** | 最大 512MB（Files API 方式） |
| **存储时间** | 上传的文件默认存储 7 天 |
| **处理时间** | 根据视频长度和复杂度，通常 10-60 秒 |
| **API 超时** | 单次请求最长 300 秒 |

---

## 常见错误处理

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 401 Unauthorized | API Key 错误或未设置 | 检查 ARK_API_KEY 环境变量 |
| 404 Not Found | file_id 不存在或已过期 | 重新上传视频 |
| 413 Payload Too Large | 视频超过 512MB | 压缩视频或截取片段 |
| 422 Unprocessable Entity | 文件格式不支持 | 转换为 MP4 格式 |
| 500 Internal Server Error | 服务器内部错误 | 稍后重试 |
