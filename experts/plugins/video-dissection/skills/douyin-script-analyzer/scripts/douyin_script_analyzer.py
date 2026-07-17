#!/usr/bin/env python3
"""
抖音拍摄脚本分析器

功能：
1. 从抖音分享链接下载无水印视频
2. 提取音频并语音识别获取文案
3. 使用火山方舟视频理解 API 分析拍摄手法
4. 生成完整的拍摄脚本分析文档（中文）

环境变量：
- DOUYIN_API_KEY / API_KEY: 硅基流动 API 密钥（用于语音识别）
- ARK_API_KEY: 火山方舟 API 密钥（用于视频理解）

依赖：
- ffmpeg / ffprobe
- requests>=2.31.0
"""

import os
import sys
import json
import time
import argparse
import re
import io
import subprocess
import requests
from pathlib import Path


# ============ 配置 ============
DOUYIN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1"
}

SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
SILICONFLOW_MODEL = "FunAudioLLM/SenseVoiceSmall"

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
ARK_DEFAULT_MODEL = "doubao-seed-2-0-pro-260215"
ARK_DEFAULT_FPS = 1

# 拍摄脚本分析提示词（中文）
FILMING_SCRIPT_PROMPT = """请对这段视频进行专业的拍摄脚本分析，并将分析结果以中文输出。

## 视频口播文案（参考）
---
{text_content}
---

## 分析要求

请结合上述文案，对视频进行深度分析：

1. **景别分析**：识别视频中使用的景别类型（远景、全景、中景、近景、特写、大特写），并说明每个场景的时长
2. **运镜方式**：分析推镜头、拉镜头、摇镜头、移镜头、跟镜头、甩镜头、升降镜头等手法的使用
3. **剪辑节奏与文案配合**：分析镜头切换如何配合口播节奏（如：语速快时快速切换、语速慢时静态镜头等）
4. **色调风格**：描述视频的整体色调和风格倾向
5. **镜头时长分布**：统计各景别的平均时长，以及与文案句子的配合关系
6. **场景转换**：识别视频中的场景切换方式和转场效果
7. **拍摄手法亮点**：总结视频中最突出的拍摄手法和创意点
8. **脚本结构拆解**：将视频内容按镜头/段落拆分，给出结构化的脚本大纲，包含：
   - 镜头序号
   - 景别类型（中文）
   - 预计时长
   - 画面内容描述
   - 对应口播文案（标注在该镜头出现时的具体文案内容）
   - 运镜方式

9. **仿拍建议**：结合以上视频分析和口播文案，给出具体可落地的仿拍建议，包括：
   - **内容策划**：如何套用这个视频的内容框架（开头钩子、中间卖点、结尾转化）到自己的产品上，给出文案模板或改编思路
   - **拍摄执行**：需要什么设备（手机/相机/灯光/支架）、场地选择、演员/模特要求、服装道具准备清单
   - **镜头复刻要点**：哪些镜头是必须保留的（对转化率影响最大），哪些可以简化或跳过
   - **剪辑建议**：推荐的剪辑软件、BGM 风格选择、字幕样式、节奏把控要点
   - **常见踩坑提醒**：仿拍这类视频时新手容易犯的错误和避坑方法

请尽量详细、专业地分析，为后续复刻或学习提供参考。

## 重要：镜头时间戳数据（用于视频裁剪）

在以上分析内容之后，请额外输出一个 JSON 代码块，用于将视频自动裁剪为独立片段。

**关键原则：按「有意义的场景段落」拆分，而不是逐个硬切镜头。**
- 将内容相关、景别接近的连续镜头合并为一个段落（例如：同一个卖点的讲解+展示合为一段）
- 每个片段至少 3 秒，建议 4-8 秒，确保每个片段有完整的表达
- 1分钟以内的视频拆分为 6-10 个片段，2分钟以内拆分为 10-15 个片段
- 只有画面内容或场景发生了明显变化时才拆分

格式如下：

```json
[
  {{"index": 1, "start": "0:00", "end": "0:05", "shot_type": "中景", "subject": "简短画面主题描述"}},
  {{"index": 2, "start": "0:05", "end": "0:12", "shot_type": "近景", "subject": "简短画面主题描述"}}
]
```

要求：
- start/end 使用 分:秒 格式（如 "0:05", "1:23"），精确到秒
- 所有片段的时间必须连续覆盖整个视频，不能有遗漏或重叠
- shot_type 填写该片段中占比最大的景别（远景/全景/中景/近景/特写/大特写）
- subject 控制在15字以内，描述该片段的核心画面内容
- 此 JSON 代码块必须放在回复的最末尾"""

# ============ 抖音提取相关函数 ============

def http_request(url, method="GET", headers=None, data=None, stream=False):
    """HTTP 请求工具函数"""
    if headers is None:
        headers = DOUYIN_HEADERS.copy()
    else:
        headers = {**DOUYIN_HEADERS, **headers}

    response = requests.request(method, url, headers=headers, data=data, stream=stream, timeout=30)

    if stream:
        return response

    try:
        return response.json()
    except:
        return response.text


def download_file(url, filepath, show_progress=True):
    """下载文件"""
    response = requests.get(url, headers=DOUYIN_HEADERS, stream=True, timeout=60)

    if response.status_code >= 300 and response.status_code < 400:
        return download_file(response.headers["location"], filepath, show_progress)

    if response.status_code != 200:
        raise Exception(f"HTTP {response.status_code}")

    total_size = int(response.headers.get("content-length", 0))
    downloaded = 0

    with open(filepath, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
            downloaded += len(chunk)
            if show_progress and total_size > 0:
                progress = (downloaded / total_size * 100)
                sys.stdout.write(f"\r下载进度: {progress:.1f}%")
                sys.stdout.flush()

    if show_progress:
        print(f"\n文件已保存: {filepath}")

    return filepath


def run_ffmpeg(args):
    """运行 ffmpeg 命令"""
    try:
        subprocess.run(
            ["ffmpeg"] + args,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
    except subprocess.CalledProcessError as e:
        raise Exception(f"ffmpeg 执行失败: {e.stderr}")
    except FileNotFoundError:
        raise Exception("ffmpeg 未安装，请先安装 ffmpeg")


def get_media_info(filepath):
    """获取媒体信息"""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", filepath],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        info = json.loads(result.stdout)
        format_info = info.get("format", {})
        return {
            "duration": float(format_info.get("duration", 0)),
            "size": int(format_info.get("size", 0))
        }
    except:
        stat = os.stat(filepath)
        return {"duration": 0, "size": stat.st_size}


def follow_redirect(url):
    """跟踪重定向获取真实 URL"""
    response = requests.get(url, headers=DOUYIN_HEADERS, timeout=15, allow_redirects=False)
    if response.status_code >= 300 and response.status_code < 400:
        location = response.headers.get("location", "")
        if location.startswith("http"):
            return location
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}{location}"
    return url


def parse_share_url(share_text):
    """解析抖音分享链接"""
    url_match = re.search(r"https?://[^\s]+", share_text)
    if not url_match:
        raise Exception("未找到有效的分享链接")

    share_url = url_match.group(0)

    if "v.douyin.com" in share_url:
        share_url = follow_redirect(share_url)

    video_id_match = re.search(r"/video/(\d+)", share_url)
    aweme_id = video_id_match.group(1) if video_id_match else share_url.split("/")[-1].split("?")[0]

    api_url = f"https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id={aweme_id}"

    try:
        api_response = http_request(api_url)

        if isinstance(api_response, str):
            page_url = share_url if share_url.startswith("http") else f"https://www.douyin.com{share_url}"
            page_content = http_request(page_url)

            if isinstance(page_content, str):
                data_match = re.search(r'window\._ROUTER_DATA\s*=\s*(.*?)</script>', page_content)
                if data_match:
                    json_data = json.loads(data_match.group(1))
                    loader_data = json_data.get("loaderData", json_data)

                    video_data = (
                        loader_data.get("video_(id)/page", {}).get("videoInfoRes", {}).get("item_list", [{}])[0]
                        or loader_data.get("note_(id)/page", {}).get("videoInfoRes", {}).get("item_list", [{}])[0]
                    )

                    if not video_data or not video_data.get("video"):
                        aweme_match = re.search(r'"aweme_id":\s*"(\d+)"', page_content)
                        if aweme_match:
                            aweme_id = aweme_match.group(1)
                            raise Exception("需要重新解析视频ID")
                        else:
                            raise Exception("无法从页面中提取视频信息")
        else:
            video_data = api_response.get("aweme_detail", api_response)

        if not video_data or not video_data.get("video"):
            raise Exception("无法解析视频信息：video 数据为空")

        video_info = video_data.get("video", {})
        play_addr = video_info.get("play_addr", {})
        url_list = play_addr.get("url_list", [])
        video_url = url_list[0].replace("playwm", "play") if url_list else None

        if not video_url:
            download_addr = video_info.get("download_addr", {})
            url_list = download_addr.get("url_list", [])
            video_url = url_list[0] if url_list else None

        desc = video_data.get("desc", f"douyin_{video_info.get('id', 'unknown')}")
        video_id = video_info.get("id", video_data.get("aweme_id", aweme_id))

        title = re.sub(r'[\\/:*?"<>|]', '_', desc)

        return {
            "url": video_url,
            "title": title,
            "video_id": str(video_id)
        }
    except Exception as e:
        raise Exception(f"解析视频信息失败: {str(e)}")


def extract_audio(video_path, show_progress=True):
    """从视频中提取音频"""
    audio_path = video_path.replace(".mp4", ".mp3")

    if show_progress:
        print("正在提取音频...")

    run_ffmpeg([
        "-i", video_path,
        "-vn",
        "-acodec", "libmp3lame",
        "-q:a", "0",
        "-y",
        audio_path
    ])

    if show_progress:
        print(f"音频已保存: {audio_path}")

    return audio_path


def extract_cover(video_path, show_progress=True):
    """从视频中提取首帧作为封面"""
    cover_path = video_path.replace(".mp4", ".jpg")

    if show_progress:
        print("正在提取封面...")

    run_ffmpeg([
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        "-y",
        cover_path
    ])

    if show_progress:
        print(f"封面已保存: {cover_path}")

    return cover_path


def transcribe_audio(audio_path, api_key, show_progress=True):
    """语音转文字（使用 SiliconFlow API）"""
    if show_progress:
        print("正在识别语音...")

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    boundary = "----FormBoundary" + "".join([str(ord(c)) for c in str(time.time())])
    body = io.BytesIO()

    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="file"; filename="{os.path.basename(audio_path)}"\r\n'.encode())
    body.write("Content-Type: audio/mpeg\r\n\r\n".encode())
    body.write(audio_data)
    body.write(f"\r\n--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="model"\r\n\r\n{SILICONFLOW_MODEL}\r\n'.encode())
    body.write(f"--{boundary}--\r\n".encode())

    body.seek(0)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}"
    }

    response = requests.post(SILICONFLOW_API_URL, data=body.getvalue(), headers=headers, timeout=60)

    if response.status_code != 200:
        raise Exception(f"语音识别失败: {response.text}")

    result = response.json()
    text = result.get("text", "")
    if not text:
        text = json.dumps(result, ensure_ascii=False)

    return text


# ============ 火山方舟视频理解相关函数 ============

def get_ark_api_key():
    """获取火山方舟 API Key"""
    api_key = os.getenv("ARK_API_KEY")
    if not api_key:
        raise ValueError(
            "缺少必要的凭证配置，请设置 ARK_API_KEY 环境变量。"
            "获取方式：访问 https://www.volcengine.com/product/ark 注册并获取 API Key"
        )
    return api_key


def upload_video_file(api_key, file_path, fps=1):
    """上传视频到火山方舟 Files API"""
    headers = {"Authorization": f"Bearer {api_key}"}

    with open(file_path, "rb") as f:
        files = {
            "file": (os.path.basename(file_path), f, "video/mp4"),
            "purpose": (None, "user_data")
        }
        data = {
            "preprocess_configs[video][fps]": str(fps)
        }
        response = requests.post(
            f"{ARK_BASE_URL}/files",
            headers=headers,
            files=files,
            data=data,
            timeout=120
        )

        if response.status_code >= 400:
            raise Exception(f"上传失败: HTTP {response.status_code}, 响应: {response.text[:500]}")

        result = response.json()
        if not result.get("id"):
            raise Exception(f"上传失败: {result}")
        return result["id"]


def wait_for_file_processing(api_key, file_id, max_wait=180, show_progress=True):
    """等待文件处理完成"""
    headers = {"Authorization": f"Bearer {api_key}"}
    start_time = time.time()
    check_count = 0

    while time.time() - start_time < max_wait:
        response = requests.get(
            f"{ARK_BASE_URL}/files/{file_id}",
            headers=headers,
            timeout=30
        )

        if response.status_code >= 400:
            raise Exception(f"文件状态查询失败: HTTP {response.status_code}")

        result = response.json()
        status = result.get("status", "unknown")
        check_count += 1

        if show_progress and check_count % 10 == 0:
            elapsed = int(time.time() - start_time)
            print(f"   视频预处理中... 状态: {status} ({elapsed}s)", end="\r", flush=True)

        if status in ["active", "processed"]:
            elapsed = int(time.time() - start_time)
            print(f"\n视频预处理完成 (状态: {status}, 耗时: {elapsed}s)")
            return result
        elif status == "error":
            raise Exception(f"文件处理失败: {result}")

        time.sleep(2)

    print(f"\n等待超时，文件状态: {status}，尝试继续...")
    return result


def analyze_video(api_key, model, file_id, instruction, fps=1):
    """调用火山方舟 Responses API 进行视频理解"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_video", "file_id": file_id},
                    {"type": "input_text", "text": instruction}
                ]
            }
        ]
    }

    response = requests.post(
        f"{ARK_BASE_URL}/responses",
        headers=headers,
        json=payload,
        timeout=300
    )

    if response.status_code >= 400:
        raise Exception(f"视频理解请求失败: HTTP {response.status_code}, 响应: {response.text[:1000]}")

    return response.json()


def extract_response_text(result):
    """从 Responses API 响应中提取文本内容"""
    if "output" in result:
        for item in result.get("output", []):
            if item.get("type") == "message":
                for content_item in item.get("content", []):
                    if content_item.get("type") == "output_text":
                        return content_item.get("text", "")
    elif "choices" in result and len(result["choices"]) > 0:
        return result["choices"][0].get("message", {}).get("content", "")
    return ""


# ============ 镜头裁剪相关函数 ============

def parse_shot_list(filming_text):
    """从 AI 分析文本中解析镜头时间戳 JSON"""
    # 查找最后一个 ```json ... ``` 代码块
    pattern = r'```json\s*\n(.*?)```'
    matches = re.findall(pattern, filming_text, re.DOTALL)
    if not matches:
        return None

    json_str = matches[-1].strip()
    try:
        shot_list = json.loads(json_str)
        if not isinstance(shot_list, list) or len(shot_list) == 0:
            return None
        # 校验必需字段
        for shot in shot_list:
            if not all(k in shot for k in ("index", "start", "end", "shot_type", "subject")):
                return None
        return shot_list
    except json.JSONDecodeError:
        return None


def _time_to_seconds(time_str):
    """将 '分:秒' 或 '时:分:秒' 格式转为秒数"""
    parts = time_str.strip().split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    else:
        return float(time_str)


def _safe_filename(text, max_len=20):
    """将文本转为安全的文件名片段"""
    text = re.sub(r'[\\/:*?"<>|\n\r\t]', '', text)
    text = text.strip()
    if len(text) > max_len:
        text = text[:max_len]
    return text


def split_video_by_shots(video_path, shot_list, output_dir, show_progress=True):
    """
    根据镜头列表裁剪视频

    Args:
        video_path: 源视频路径
        shot_list: parse_shot_list 返回的镜头列表
        output_dir: 输出目录（会在其下创建 shots/ 子目录）
        show_progress: 是否显示进度

    Returns:
        list: 生成的文件路径列表
    """
    shots_dir = os.path.join(output_dir, "shots")
    os.makedirs(shots_dir, exist_ok=True)

    generated_files = []
    total = len(shot_list)

    for shot in shot_list:
        idx = shot["index"]
        start_sec = _time_to_seconds(shot["start"])
        end_sec = _time_to_seconds(shot["end"])
        shot_type = _safe_filename(shot["shot_type"], 10)
        subject = _safe_filename(shot["subject"], 20)

        filename = f"{idx:02d}_{shot_type}_{subject}.mp4"
        output_path = os.path.join(shots_dir, filename)

        if show_progress:
            print(f"  裁剪镜头 {idx}/{total}: {filename}")

        try:
            run_ffmpeg([
                "-ss", str(start_sec),
                "-i", video_path,
                "-t", str(end_sec - start_sec),
                "-c:v", "libx264",
                "-c:a", "aac",
                "-y",
                output_path
            ])
            generated_files.append(output_path)
        except Exception as e:
            if show_progress:
                print(f"  警告：镜头 {idx} 裁剪失败: {e}")

    if show_progress:
        print(f"镜头裁剪完成，共生成 {len(generated_files)} 个片段")

    return generated_files


# ============ 主流程函数 ============

def analyze_filming_script(
    share_link,
    output_dir="./output",
    fps=1,
    model=ARK_DEFAULT_MODEL,
    show_progress=True,
    no_split=False  # 内部参数，不暴露为 CLI 选项
):
    """
    抖音拍摄脚本分析主函数

    Args:
        share_link: 抖音分享链接
        output_dir: 输出目录
        fps: 视频采样帧率
        model: 火山方舟模型 ID
        show_progress: 是否显示进度

    Returns:
        dict: 包含完整分析结果的字典
    """
    # ========== 阶段1：获取视频数据 ==========
    if show_progress:
        print("\n" + "=" * 60)
        print("第一阶段：提取视频数据")
        print("=" * 60)

    # 解析视频信息
    if show_progress:
        print("正在解析抖音分享链接...")

    video_info = parse_share_url(share_link)

    # 创建输出目录
    output_folder = os.path.join(output_dir, video_info["video_id"])
    os.makedirs(output_folder, exist_ok=True)

    # 下载视频（强制保留，供火山方舟上传）
    if show_progress:
        print("正在下载视频...")

    video_path = os.path.join(output_folder, f"{video_info['video_id']}.mp4")
    download_file(video_info["url"], video_path, show_progress)

    # 获取媒体信息
    media_info = get_media_info(video_path)
    file_size_mb = media_info["size"] / 1024 / 1024

    if show_progress:
        print(f"视频时长: {media_info['duration']:.2f}秒")
        print(f"视频大小: {file_size_mb:.1f} MB")

    # 检查视频大小（火山方舟限制 512MB）
    if file_size_mb > 512:
        raise Exception(f"视频文件过大（{file_size_mb:.1f} MB），火山方舟 Files API 最大支持 512MB")

    # 提取音频
    audio_path = extract_audio(video_path, show_progress)

    # 提取封面
    cover_path = extract_cover(video_path, show_progress)

    # 语音识别
    siliconflow_key = os.getenv("DOUYIN_API_KEY") or os.getenv("API_KEY")
    if not siliconflow_key:
        raise Exception("未设置 API 密钥，请设置 DOUYIN_API_KEY 或 API_KEY 环境变量")

    text_content = transcribe_audio(audio_path, siliconflow_key, show_progress)

    if show_progress:
        print(f"\n文案识别完成，共 {len(text_content)} 字")

    # ========== 阶段2：视频理解分析 ==========
    if show_progress:
        print("\n" + "=" * 60)
        print("第二阶段：分析拍摄手法")
        print("=" * 60)

    ark_key = get_ark_api_key()

    if show_progress:
        print(f"上传视频到火山方舟...")
        print(f"使用模型: {model}")
        print(f"采样帧率: {fps}")

    file_id = upload_video_file(ark_key, video_path, fps)

    if show_progress:
        print(f"文件上传成功，ID: {file_id}")

    wait_for_file_processing(ark_key, file_id, show_progress=show_progress)

    if show_progress:
        print("\n正在进行拍摄脚本分析（这可能需要 1-2 分钟）...")

    filming_analysis = analyze_video(
        ark_key,
        model,
        file_id,
        FILMING_SCRIPT_PROMPT.format(text_content=text_content),
        fps
    )

    filming_text = extract_response_text(filming_analysis)

    if not filming_text:
        filming_text = "【分析结果解析失败，请查看完整数据】"
        if show_progress:
            print("警告：无法解析分析结果，将保留原始响应")

    if show_progress:
        print(f"\n拍摄手法分析完成")

    # ========== 阶段3：镜头裁剪 ==========
    shot_list = None
    shot_files = []

    if not no_split:
        if show_progress:
            print("\n" + "=" * 60)
            print("第三阶段：镜头裁剪")
            print("=" * 60)

        shot_list = parse_shot_list(filming_text)
        if shot_list:
            if show_progress:
                print(f"识别到 {len(shot_list)} 个镜头，开始裁剪...")
            shot_files = split_video_by_shots(video_path, shot_list, output_folder, show_progress)
        else:
            if show_progress:
                print("警告：未能从分析结果中解析镜头时间戳，跳过裁剪")

    # ========== 清理临时文件 ==========
    try:
        os.remove(audio_path)
    except:
        pass

    # ========== 返回结果 ==========
    return {
        "video_info": video_info,
        "media_info": media_info,
        "text_content": text_content,
        "filming_analysis": filming_text,
        "cover_path": cover_path,
        "video_path": video_path,
        "output_folder": output_folder,
        "raw_filming_response": filming_analysis,
        "shot_list": shot_list,
        "shot_files": shot_files
    }


def generate_script_report(result, output_path=None):
    """
    生成拍摄脚本分析 Markdown 报告

    Args:
        result: analyze_filming_script 返回的结果字典
        output_path: 可选，保存文件路径

    Returns:
        str: Markdown 格式的报告内容
    """
    video_info = result["video_info"]
    media_info = result["media_info"]
    duration_sec = media_info["duration"]

    # 格式化时长
    minutes = int(duration_sec // 60)
    seconds = int(duration_sec % 60)
    duration_str = f"{minutes}分{seconds}秒" if minutes > 0 else f"{seconds}秒"

    # 文件大小
    size_mb = media_info["size"] / 1024 / 1024

    md = []
    md.append("# 视频拍摄脚本分析\n")

    # 视频基本信息
    md.append("## 视频基本信息\n")
    md.append(f"- **标题**: {video_info['title']}")
    md.append(f"- **视频ID**: {video_info['video_id']}")
    md.append(f"- **时长**: {duration_str}（{duration_sec:.2f}秒）")
    md.append(f"- **文件大小**: {size_mb:.1f} MB")
    md.append(f"- **视频链接**:")
    md.append(f"  ```")
    md.append(f"  {video_info['url']}")
    md.append(f"  ```")
    md.append(f"  提示：复制链接到浏览器地址栏访问\n")

    # 视频封面
    if result.get("cover_path") and os.path.exists(result["cover_path"]):
        cover_rel = os.path.basename(result["cover_path"])
        md.append("## 视频封面\n")
        md.append(f"![封面](./{cover_rel})\n")

    # 视频文案
    md.append("## 视频文案（语音识别）\n")
    text_content = result["text_content"].strip()
    if text_content:
        # 分段展示，每段用引用格式
        for paragraph in text_content.split("\n"):
            paragraph = paragraph.strip()
            if paragraph:
                md.append(f"> {paragraph}")
        md.append("")
    else:
        md.append("> 【未能识别到语音内容】\n")

    # 拍摄手法分析
    md.append("## 拍摄手法分析\n")
    filming_analysis = result["filming_analysis"].strip()
    if filming_analysis:
        md.append(filming_analysis)
        md.append("")
    else:
        md.append("> 【未能获取拍摄手法分析】\n")

    # 镜头片段
    shot_files = result.get("shot_files", [])
    if shot_files:
        md.append("## 镜头片段\n")
        md.append(f"共裁剪 {len(shot_files)} 个镜头片段：\n")
        md.append("| 序号 | 文件名 | 文件路径 |")
        md.append("|------|--------|----------|")
        for i, fpath in enumerate(shot_files, 1):
            fname = os.path.basename(fpath)
            rel_path = f"shots/{fname}"
            md.append(f"| {i} | `{fname}` | [{rel_path}]({rel_path}) |")
        md.append("")

    # 输出文件信息
    md.append("## 输出文件\n")
    md.append(f"- **视频文件**: `{os.path.basename(result['video_path'])}`")
    md.append(f"- **封面图片**: `{os.path.basename(result['cover_path'])}`")
    if shot_files:
        md.append(f"- **镜头片段**: `shots/` 目录（{len(shot_files)} 个片段）")
    md.append("")

    # 数据说明
    md.append("## 数据说明\n")
    md.append("| 数据字段 | 含义 | 用途 |")
    md.append("|---------|------|------|")
    md.append("| video_id | 视频唯一标识 | 识别和引用特定视频 |")
    md.append("| title | 视频标题 | 了解视频主题 |")
    md.append("| text_content | 语音识别的文案 | 获取视频完整的口播内容 |")
    md.append("| filming_analysis | AI 分析的拍摄手法 | 学习视频的拍摄技巧 |")
    md.append("| duration | 视频时长（秒） | 了解视频长度 |")
    md.append("| cover_path | 封面图片路径 | 获取视频封面 |")
    md.append("")
    md.append("**数据来源**：")
    md.append("- 视频信息：通过抖音公开 API 接口解析")
    md.append("- 文案内容：使用硅基流动语音识别 API（模型：FunAudioLLM/SenseVoiceSmall）")
    md.append("- 拍摄分析：使用火山方舟视频理解 API（模型：doubao-seed-2-0-pro-260215）")
    md.append("- 封面/音频：使用 ffmpeg 从视频中提取")
    md.append("")

    # 完整原始数据
    md.append("## 完整数据\n")
    md.append("```json")
    raw_data = {
        "video_info": video_info,
        "media_info": media_info,
        "text_content": text_content,
        "filming_analysis": filming_analysis,
    }
    md.append(json.dumps(raw_data, indent=2, ensure_ascii=False))
    md.append("```\n")

    report_content = "\n".join(md)

    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(report_content)

    return report_content


def main():
    parser = argparse.ArgumentParser(
        description="抖音拍摄脚本分析器 - 从抖音链接提取文案并分析拍摄手法",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("share_link", help="抖音分享链接")
    parser.add_argument("-o", "--output", default="./output", help="输出目录（默认 ./output）")
    parser.add_argument("--fps", type=int, default=1, help="视频采样帧率（默认 1）")
    parser.add_argument("--model", default=ARK_DEFAULT_MODEL, help=f"火山方舟模型 ID（默认 {ARK_DEFAULT_MODEL}）")
    parser.add_argument("--no-progress", action="store_true", help="不显示详细进度")

    args = parser.parse_args()

    show_progress = not args.no_progress

    try:
        start_time = time.time()

        result = analyze_filming_script(
            share_link=args.share_link,
            output_dir=args.output,
            fps=args.fps,
            model=args.model,
            show_progress=show_progress
        )

        raw_title = result['video_info']['title']
        safe_title = re.sub(r'#\S*', '', raw_title)
        safe_title = re.sub(r'[\\/:*?"<>|\n\r\t@]', '', safe_title).strip()
        for sep in ['，', '！', '。', '?', '？', '!', ' ']:
            if sep in safe_title:
                safe_title = safe_title.split(sep)[0].strip()
                break
        if len(safe_title) > 15:
            safe_title = safe_title[:15]
        report_filename = f"{safe_title}_拍摄脚本分析.md" if safe_title else "拍摄脚本分析.md"
        report_path = os.path.join(result["output_folder"], report_filename)
        report = generate_script_report(result, report_path)
        if show_progress:
            print(f"\n报告已保存: {report_path}")

        elapsed = time.time() - start_time

        if show_progress:
            print("\n" + "=" * 60)
            print("分析完成!")
            print("=" * 60)
            print(f"视频标题: {result['video_info']['title']}")
            print(f"文案字数: {len(result['text_content'])} 字")
            if result.get('shot_files'):
                print(f"镜头片段: {len(result['shot_files'])} 个")
            print(f"输出目录: {result['output_folder']}")
            print(f"总耗时: {int(elapsed)} 秒")
            print("=" * 60)

            print("\n【拍摄手法分析摘要】")
            print("-" * 40)
            analysis_preview = result["filming_analysis"][:800]
            print(analysis_preview + ("..." if len(result["filming_analysis"]) > 800 else ""))
            print("-" * 40)

    except Exception as e:
        print(f"\n错误: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
