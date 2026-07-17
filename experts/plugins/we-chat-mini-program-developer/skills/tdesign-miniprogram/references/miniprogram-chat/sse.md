# 什么是流式输出

## 简述

流式输出，也称为流式传输，指的是服务器持续地将数据推送到客户端，而不是一次性发送完毕。这种模式下，连接一旦建立，服务器就能实时地发送更新给客户端。

### 使用场景

流式输出的典型应用场景包括实时消息推送、股票行情更新、实时通知等，任何需要服务器向客户端实时传输数据的场合都可以使用。

### 与普通请求的区别

与传统的 HTTP 请求不同，普通请求是基于请求-响应模型，客户端发送请求后，服务器处理完毕即刻响应并关闭连接。流式输出则保持连接开放，允许服务器连续发送多个响应。

## 如何创建一个SSE

### Python

在 Python 中，可以使用 fastAPI 框架来实现 Server-Sent Events。以下是一个示例：

1. 安装 FastAPI 和 Uvicorn 首先，确保你已经安装了 FastAPI 和 Uvicorn ：

```none
pip install fastapi uvicorn
```

1. 创建 FastAPI 应用 接下来，创建一个 FastAPI 应用，并定义一个流式接口。我们将使用异步生成器来逐步生成数据，并使用 StreamingResponse 来流式发送数据给客户端。

```js
import json
import asyncio
from fastapi import FastAPI
from sse_starlette.sse import EventSourceResponse
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
CORSMiddleware,
allow_origins=['*'], # 设置允许跨域的域名列表，* 代表所有域名
allow_credentials=True,
allow_methods=['*'],
allow_headers=['*'],
)
async def event_generator():
count = 0
while True:
await asyncio.sleep(1)
count += 1
data = {"count": count}
yield json.dumps(data)

@app.get("/events")
async def get_events():
return EventSourceResponse(event_generator())
@app.post("/events")
async def post_events():
return EventSourceResponse(event_generator())

if __name__ == '__main__':
uvicorn.run(app, host='0.0.0.0', port=4000)
```

1. 运行应用 保存上述代码到一个文件（[例如main.py](http://xn--main-zu6fx14c.py)），然后运行应用：

```none
python3 main.py
```

1. 测试流式接口

- get接口

```none
curl http://0.0.0.0:4000/events
```

- post接口

```none
curl -X POST "http://0.0.0.0:4000/events" -H "Content-Type: application/json"
```

你应该会看到每秒钟输出一行数据，类似于：

```none
data: {"count": 1}

data: {"count": 2}

data: {"count": 3}

data: {"count": 4}

data: {"count": 5}

...
```

## 为什么大模型LLM需要使用SSE？

从某种意义上说，现阶段 LLM 模型采用 SSE 是历史遗留原因。

Transformer 前后内容是需要推理拼接的，且不说内容很多的时候，推理的时间会很长（还有 Max Token 的限制）。推理上下文的时候也是逐步推理生成的，因此默认就是流式输出进行包裹。如果哪天 AI 的速度可以不受这些内容的限制了，可能一次性返回是一个更好的交互。

## TDesignAIChat如何接入SSE

对于流式请求来说，组件其实只关心一个内容，那就是返回的 String，下面是 hunyuan 的流式返回案例。

```js
data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"我是"}}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"由腾"}}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"讯公"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"司开"}}],"usage":{"prompt_tokens":10,"completion_tokens":7,"total_tokens":17}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"发的"}}],"usage":{"prompt_tokens":10,"completion_tokens":8,"total_tokens":18}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"大型"}}],"usage":{"prompt_tokens":10,"completion_tokens":9,"total_tokens":19}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"语言"}}],"usage":{"prompt_tokens":10,"completion_tokens":10,"total_tokens":20}}

data: {"id":"7eced65bb3cb122d9f927563fc0e5673","created":1695218378,"choices":[{"delta":{"role":"assistant","content":"模型"}}],"usage":{"prompt_tokens":10,"completion_tokens":11,"total_tokens":21}}
```

下面是微信小程序解析SSE流式接口请求的代码片段示例：

```js
const requestTask = wx.request({
url: 'https://your-api-url',
enableChunked: true,
success(res){
console.log('success：', res)
},
fail(err){
console.warn('fail：', err);
}
});
// 解析流式返回的数据
requestTask.onChunkReceived((chunk)=>console.log('chunk', chunk))
```