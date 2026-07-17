#!/usr/bin/env node

/**
 * 抖音统一解析器 - 三层降级策略
 *
 * Level 1: 直接调用抖音 Web API + HTML DOM 解析
 * Level 2: 浏览器模式（通过环境变量传入音视频 URL）
 * Level 3: yt-dlp 兜底下载
 *
 * 用法:
 *   node douyin_resolver.js resolve "分享链接" [-o 输出目录]
 *   node douyin_resolver.js info "分享链接"
 *   node douyin_resolver.js download "分享链接" [-o 输出目录]
 *
 * 环境变量:
 *   SILICONFLOW_API_KEY     - 硅基流动 API Key（必须，用于语音识别）
 *   DOUYIN_AUDIO_URL   - 浏览器模式音频流 URL（由 agent 设置）
 *   DOUYIN_VIDEO_URL   - 浏览器模式视频流 URL（由 agent 设置，可选）
 *   DOUYIN_TITLE       - 浏览器模式视频标题（由 agent 设置）
 *   DOUYIN_AUTHOR      - 浏览器模式视频作者（由 agent 设置）
 */

const { execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============ 配置 ============

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1'
};

const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const SILICONFLOW_MODEL = 'FunAudioLLM/SenseVoiceSmall';
const DOUYIN_DETAIL_API = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=';

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.join(SCRIPT_DIR, '..');

// 加载 .env 文件
function loadEnvFile() {
  const envPath = path.join(SKILL_DIR, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    });
  }
}
loadEnvFile();

// ============ 工具函数 ============

function log(msg, color = 'reset') {
  const colors = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function warn(msg) { log(`⚠️  ${msg}`, 'yellow'); }
function error(msg) { log(`❌ ${msg}`, 'red'); }

function findCommand(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = execSync(`${which} ${cmd}`, { stdio: 'pipe', encoding: 'utf-8' }).trim().split('\n')[0].trim();
    if (result && !result.includes('not found') && !result.includes('Could not find')) return result;
  } catch {}
  const candidates = process.platform === 'win32'
    ? [`C:\\ffmpeg\\bin\\${cmd}.exe`, `C:\\Program Files\\ffmpeg\\bin\\${cmd}.exe`]
    : [`/usr/local/bin/${cmd}`, `/usr/bin/${cmd}`, `/opt/homebrew/bin/${cmd}`];
  for (const p of candidates) { if (fs.existsSync(p)) return p; }
  return cmd;
}

function getFfmpegPath() { return findCommand('ffmpeg'); }
function getFfprobePath() { return findCommand('ffprobe'); }
function getYtdlpPath() { return findCommand('yt-dlp'); }

// ============ HTTP 工具 ============

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const opts = {
      method: options.method || 'GET',
      headers: { ...HEADERS, ...(options.headers || {}) }
    };
    const req = client.request(url, opts, (res) => {
      if (options.stream) { resolve(res); return; }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(options.timeout || 30000, () => { req.destroy(); reject(new Error('请求超时')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function downloadFile(url, filepath, showProgress = true) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, filepath, showProgress).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const totalSize = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const writer = fs.createWriteStream(filepath);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (showProgress && totalSize > 0) {
          process.stdout.write(`\r下载进度: ${(downloaded / totalSize * 100).toFixed(1)}%`);
        }
      });
      res.pipe(writer);
      writer.on('finish', () => {
        if (showProgress) process.stdout.write('\n');
        resolve(filepath);
      });
      writer.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('下载超时')); });
  });
}

// ============ ffmpeg 工具 ============

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', data => stderr += data.toString());
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 失败 (code ${code}): ${stderr.slice(-300)}`));
    });
    proc.on('error', reject);
  });
}

function getMediaInfo(filepath) {
  return new Promise((resolve) => {
    const ffprobePath = getFfprobePath();
    const proc = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', filepath]);
    let stdout = '';
    proc.stdout.on('data', data => stdout += data.toString());
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(stdout);
          const fmt = info.format || {};
          resolve({ duration: parseFloat(fmt.duration || '0'), size: parseInt(fmt.size || '0', 10) });
        } catch {
          resolve({ duration: 0, size: fs.statSync(filepath).size });
        }
      } else {
        resolve({ duration: 0, size: fs.statSync(filepath).size });
      }
    });
  });
}

function extractAudio(videoPath, audioPath, showProgress = true) {
  if (!audioPath) audioPath = videoPath.replace(/\.mp4$/, '.mp3');
  if (showProgress) log('正在提取音频...', 'cyan');
  return runFfmpeg(['-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '0', '-y', audioPath])
    .then(() => {
      if (showProgress) log(`音频已保存: ${audioPath}`, 'green');
      return audioPath;
    });
}

function extractCover(videoPath, coverPath, showProgress = true) {
  if (!coverPath) coverPath = videoPath.replace(/\.mp4$/, '.jpg');
  if (showProgress) log('正在提取封面...', 'cyan');
  return runFfmpeg(['-i', videoPath, '-vframes', '1', '-q:v', '2', '-y', coverPath])
    .then(() => {
      if (showProgress) log(`封面已保存: ${coverPath}`, 'green');
      return coverPath;
    });
}

// ============ 硅基流动语音识别 ============

function transcribeAudio(audioPath, apiKey, showProgress = true) {
  return new Promise((resolve, reject) => {
    if (showProgress) log('正在识别语音 (硅基流动 SenseVoiceSmall)...', 'cyan');

    const audioData = fs.readFileSync(audioPath);
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

    const parts = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(audioPath)}"\r\nContent-Type: audio/mpeg\r\n\r\n`),
      audioData,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${SILICONFLOW_MODEL}\r\n--${boundary}--\r\n`)
    ];
    const body = Buffer.concat(parts);

    const parsedUrl = new URL(SILICONFLOW_API_URL);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const opts = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const startTime = Date.now();
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        try {
          const result = JSON.parse(data);
          if (result.error) {
            reject(new Error(`硅基流动 API 错误: ${result.error.message || JSON.stringify(result.error)}`));
          } else {
            if (showProgress) log(`语音识别完成 (耗时 ${elapsed}s)`, 'green');
            resolve(result.text || JSON.stringify(result));
          }
        } catch {
          reject(new Error('API 返回解析失败: ' + data.substring(0, 500)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============ Level 1: 抖音 Web API + HTML DOM ============

function followRedirect(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.request(url, { method: 'GET', headers: HEADERS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location;
        resolve(location.startsWith('http') ? location : `${parsedUrl.protocol}//${parsedUrl.host}${location}`);
      } else {
        resolve(url);
      }
      res.resume();
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('重定向超时')); });
    req.end();
  });
}

async function parseShareUrl(shareText) {
  const urlMatch = shareText.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) throw new Error('未找到有效的分享链接');

  let shareUrl = urlMatch[0];

  // 短链重定向
  if (shareUrl.includes('v.douyin.com')) {
    shareUrl = await followRedirect(shareUrl);
  }

  // 提取 video ID
  const videoIdMatch = shareUrl.match(/\/video\/(\d+)/);
  const awemeId = videoIdMatch ? videoIdMatch[1] : shareUrl.split('/').pop().split('?')[0];

  // 调用抖音 API
  const apiUrl = `${DOUYIN_DETAIL_API}${awemeId}`;

  try {
    const apiResponse = await httpRequest(apiUrl, { timeout: 15000 });
    let videoData = apiResponse.aweme_detail || apiResponse;

    // API 返回非 JSON，尝试 HTML 兜底
    if (!videoData || !videoData.video) {
      const pageUrl = shareUrl.includes('douyin.com') ? shareUrl : `https://www.douyin.com${shareUrl}`;
      const pageContent = await httpRequest(pageUrl, { timeout: 15000 });

      if (typeof pageContent === 'string') {
        const match = pageContent.match(/window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/);
        if (match) {
          const jsonData = JSON.parse(match[1]);
          const loaderData = jsonData.loaderData || jsonData;
          videoData = loaderData['video_(id)/page']?.videoInfoRes?.item_list?.[0]
            || loaderData['note_(id)/page']?.videoInfoRes?.item_list?.[0];
        }
      }
    }

    if (!videoData || !videoData.video) {
      throw new Error('无法解析视频信息：video 数据为空');
    }

    // 提取无水印视频地址
    const videoUrl = videoData.video?.play_addr?.url_list?.[0]?.replace('playwm', 'play')
      || videoData.video?.download_addr?.url_list?.[0];
    const desc = videoData.desc || `douyin_${videoData.video?.id || 'unknown'}`;
    const videoId = videoData.video?.id || videoData.aweme_id;

    return {
      url: videoUrl,
      title: desc.replace(/[\\/:*?"<>|]/g, '_'),
      video_id: String(videoId || awemeId)
    };
  } catch (e) {
    throw new Error(`Level 1 解析失败: ${e.message}`);
  }
}

async function tryApiParse(shareLink, outputDir, showProgress = true) {
  if (showProgress) log('\n📡 Level 1: 尝试抖音 Web API + HTML DOM...', 'cyan');

  try {
    const videoInfo = await parseShareUrl(shareLink);
    if (!videoInfo.url) throw new Error('未获取到视频 URL');

    const outputFolder = path.join(outputDir, videoInfo.video_id);
    fs.mkdirSync(outputFolder, { recursive: true });
    const videoPath = path.join(outputFolder, `${videoInfo.video_id}.mp4`);

    if (showProgress) log(`正在下载视频: ${videoInfo.title}`);
    await downloadFile(videoInfo.url, videoPath, showProgress);

    // 验证文件
    const stat = fs.statSync(videoPath);
    if (stat.size < 1000) {
      fs.unlinkSync(videoPath);
      throw new Error('下载的视频文件过小，可能无效');
    }

    if (showProgress) log('Level 1 解析成功', 'green');
    return { videoInfo, videoPath, method: 'api' };
  } catch (e) {
    warn(e.message);
    return null;
  }
}

// ============ Level 2: Playwright 浏览器模式 ============

async function tryBrowserExtract(shareLink, outputDir, showProgress = true) {
  if (showProgress) log('\n🌐 Level 2: 尝试 Playwright 浏览器模式...', 'cyan');

  // 检查是否有环境变量传入（兼容 Agent 模式）
  const envAudioUrl = process.env.DOUYIN_AUDIO_URL;
  if (envAudioUrl) {
    if (showProgress) log('检测到环境变量，使用 Agent 传入的流 URL');
    return _downloadStreams(envAudioUrl, process.env.DOUYIN_VIDEO_URL,
      process.env.DOUYIN_TITLE || '未知标题', process.env.DOUYIN_AUTHOR || '未知作者', outputDir, showProgress);
  }

  // 尝试加载 Playwright
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    warn('Playwright 未安装，跳过浏览器模式（npm install playwright）');
    return null;
  }

  // 从分享文本中提取 URL
  const urlMatch = shareLink.match(/https?:\/\/[^\s]+/);
  const pureUrl = urlMatch ? urlMatch[0] : shareLink;

  let browser, page, context;
  try {
    if (showProgress) log('正在启动浏览器...');
    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });
    page = await context.newPage();

    // 拦截网络请求，捕获 douyinvod.com 视频流
    const mediaUrls = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('douyinvod.com') && url.includes('/video/tos/')) {
        mediaUrls.push(url);
      }
    });

    if (showProgress) log(`正在打开抖音页面: ${pureUrl}`);
    await page.goto(pureUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待视频播放
    if (showProgress) log('等待视频加载...');
    await page.waitForTimeout(8000);

    // 提取标题、作者和视频流 URL
    let extracted = await page.evaluate(() => {
      const title = document.querySelector('h1')?.textContent?.trim() ||
                    document.querySelector('[data-e2e="video-desc"]')?.textContent?.trim() ||
                    document.title;
      const authorEl = document.querySelector('[data-e2e="video-account-link"]') ||
                       document.querySelector('.author-name');
      const video = document.querySelector('video');
      return {
        title: title || '未知标题',
        author: authorEl?.textContent?.trim() || '未知作者',
        videoSrc: video?.currentSrc || video?.src || null
      };
    });

    // 合并拦截到的流 URL
    extracted.videoUrl = extracted.videoSrc || mediaUrls[0] || null;
    extracted.audioUrl = null; // PC 端抖音是合并流，没有独立音频

    await browser.close();
    browser = null;

    if (!extracted || !extracted.videoUrl) {
      throw new Error('未能从页面提取到视频流 URL');
    }

    if (showProgress) {
      log(`标题: ${extracted.title}`);
      log(`作者: ${extracted.author}`);
      log(`视频流: ${extracted.videoUrl.slice(0, 80)}...`);
    }

    return _downloadStreams(null, extracted.videoUrl,
      extracted.title, extracted.author, outputDir, showProgress);

  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    warn(`Level 2 失败: ${e.message}`);
    return null;
  }
}

// 下载音视频流
async function _downloadStreams(audioUrl, videoUrl, title, author, outputDir, showProgress) {
  const timestamp = Date.now();
  const videoId = `browser_${timestamp}`;
  const outputFolder = path.join(outputDir, videoId);
  fs.mkdirSync(outputFolder, { recursive: true });

  if (showProgress) {
    log(`标题: ${title}`);
    log(`作者: ${author}`);
  }

  let videoPath = null;
  let audioPath = null;

  // 下载视频流（合并流，含音视频）
  if (videoUrl) {
    try {
      videoPath = path.join(outputFolder, `${videoId}.mp4`);
      if (showProgress) log('正在从浏览器流下载视频...');
      const ffmpegPath = getFfmpegPath();
      execFileSync(ffmpegPath, [
        '-y', '-headers', 'Referer: https://www.douyin.com/\r\n',
        '-i', videoUrl, '-c', 'copy', videoPath
      ], { stdio: 'pipe', timeout: 120000 });
      if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 1000) {
        warn('视频流下载失败或为空');
        videoPath = null;
      }
    } catch (e) {
      warn(`视频流下载失败: ${e.message}`);
      videoPath = null;
    }
  }

  // 下载独立音频流（如果有，手机端 DASH 模式）
  if (audioUrl) {
    audioPath = path.join(outputFolder, `${videoId}.mp3`);
    try {
      if (showProgress) log('正在从浏览器流下载音频...');
      const ffmpegPath = getFfmpegPath();
      execFileSync(ffmpegPath, [
        '-y', '-headers', 'Referer: https://www.douyin.com/\r\n',
        '-i', audioUrl, '-vn', '-ar', '16000', '-ac', '1',
        '-c:a', 'libmp3lame', '-q:a', '2', audioPath
      ], { stdio: 'pipe', timeout: 60000 });
      if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
        audioPath = null;
      }
    } catch (e) {
      warn(`音频流下载失败: ${e.message}`);
      audioPath = null;
    }
  }
  // 没有独立音频流时，后续 postProcess 会从视频中提取

  if (showProgress) log('Level 2 浏览器模式成功', 'green');

  return {
    videoInfo: { video_id: videoId, title: title.replace(/[\\/:*?"<>|]/g, '_'), url: videoUrl || audioUrl, author },
    videoPath,
    audioPath,
    method: 'browser'
  };
}

// ============ Level 3: yt-dlp 兜底 ============

async function tryYtdlpDownload(shareLink, outputDir, showProgress = true) {
  if (showProgress) log('\n📥 Level 3: 尝试 yt-dlp...', 'cyan');

  // 从分享文本中提取纯 URL
  const urlMatch = shareLink.match(/https?:\/\/[^\s]+/);
  const pureUrl = urlMatch ? urlMatch[0] : shareLink;

  const ytdlpPath = getYtdlpPath();
  try {
    execSync(`"${ytdlpPath}" --version`, { stdio: 'pipe' });
  } catch {
    warn('yt-dlp 未安装，跳过 Level 3');
    return null;
  }

  const timestamp = Date.now();
  const videoId = `ytdlp_${timestamp}`;
  const outputFolder = path.join(outputDir, videoId);
  fs.mkdirSync(outputFolder, { recursive: true });
  const videoPath = path.join(outputFolder, `${videoId}.mp4`);

  // 构建 cookies 参数：优先 cookies 文件，否则尝试从浏览器获取
  const cookiesPath = path.join(SKILL_DIR, 'temp', 'douyin-cookies.txt');
  let cookiesArg = '';
  if (fs.existsSync(cookiesPath)) {
    cookiesArg = `--cookies "${cookiesPath}"`;
    if (showProgress) log('使用 cookies 文件');
  } else {
    // 尝试从浏览器获取 cookies
    for (const browser of ['chrome', 'safari', 'edge', 'firefox']) {
      try {
        execSync(`"${ytdlpPath}" --cookies-from-browser ${browser} --skip-download "${pureUrl}"`, {
          timeout: 10000, stdio: 'pipe'
        });
        cookiesArg = `--cookies-from-browser ${browser}`;
        if (showProgress) log(`使用浏览器 cookies: ${browser}`);
        break;
      } catch {}
    }
  }

  try {
    // 获取视频信息
    let videoInfo = { title: '未知标题', author: '未知作者' };
    try {
      const infoJson = execSync(`"${ytdlpPath}" ${cookiesArg} --dump-json "${pureUrl}"`, {
        encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe']
      });
      const info = JSON.parse(infoJson);
      videoInfo = { title: info.title || videoInfo.title, author: info.uploader || videoInfo.author, video_id: info.id || videoId };
    } catch {}

    // 下载
    if (showProgress) log('正在用 yt-dlp 下载视频...');
    execSync(`"${ytdlpPath}" ${cookiesArg} -o "${videoPath}" "${pureUrl}"`, {
      timeout: 120000, stdio: ['pipe', 'pipe', 'pipe']
    });

    // 查找实际下载的文件
    let actualVideoPath = videoPath;
    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 1000) {
      const files = fs.readdirSync(outputFolder);
      const found = files.find(f => f.startsWith('ytdlp_'));
      if (found) actualVideoPath = path.join(outputFolder, found);
    }

    if (!fs.existsSync(actualVideoPath) || fs.statSync(actualVideoPath).size < 1000) {
      throw new Error('yt-dlp 下载失败');
    }

    if (showProgress) log('Level 3 yt-dlp 下载成功', 'green');
    return {
      videoInfo: {
        video_id: videoInfo.video_id || videoId,
        title: (videoInfo.title || '未知标题').replace(/[\\/:*?"<>|]/g, '_'),
        url: pureUrl,
        author: videoInfo.author
      },
      videoPath: actualVideoPath,
      method: 'ytdlp'
    };
  } catch (e) {
    warn(`Level 3 失败: ${e.message}`);
    return null;
  }
}

// ============ 统一后处理 ============

async function postProcess(result, outputDir, showProgress = true) {
  const { videoInfo, videoPath, method } = result;
  const outputFolder = path.join(outputDir, videoInfo.video_id);
  fs.mkdirSync(outputFolder, { recursive: true });

  // 提取音频（如果没有直接拿到音频）
  let audioPath = result.audioPath;
  if (!audioPath && videoPath && fs.existsSync(videoPath)) {
    audioPath = path.join(outputFolder, `${videoInfo.video_id}.mp3`);
    await extractAudio(videoPath, audioPath, showProgress);
  }

  // 提取封面（需要视频文件）
  let coverPath = null;
  if (videoPath && fs.existsSync(videoPath)) {
    coverPath = path.join(outputFolder, `${videoInfo.video_id}.jpg`);
    try {
      await extractCover(videoPath, coverPath, showProgress);
    } catch (e) {
      warn(`封面提取失败: ${e.message}`);
      coverPath = null;
    }
  }

  // 获取媒体信息
  let mediaInfo = { duration: 0, size: 0 };
  if (videoPath && fs.existsSync(videoPath)) {
    mediaInfo = await getMediaInfo(videoPath);
  }

  // 语音识别
  let textContent = '';
  const apiKey = process.env.SILICONFLOW_API_KEY || process.env.API_KEY;
  if (audioPath && fs.existsSync(audioPath) && apiKey) {
    try {
      textContent = await transcribeAudio(audioPath, apiKey, showProgress);
    } catch (e) {
      warn(`语音识别失败: ${e.message}`);
      textContent = `[语音识别失败: ${e.message}]`;
    }
  } else if (!apiKey) {
    warn('未设置 SILICONFLOW_API_KEY，跳过语音识别');
    textContent = '[未配置 API Key，跳过语音识别]';
  }

  // 保存文案 Markdown
  let transcriptPath = null;
  if (textContent) {
    transcriptPath = path.join(outputFolder, `${videoInfo.video_id}.md`);
    const durationStr = mediaInfo.duration > 60
      ? `${Math.floor(mediaInfo.duration / 60)}分${Math.floor(mediaInfo.duration % 60)}秒`
      : `${Math.floor(mediaInfo.duration)}秒`;
    const sizeMB = (mediaInfo.size / 1024 / 1024).toFixed(1);
    const author = videoInfo.author || '';
    const md = [
      `# ${videoInfo.title}`,
      '',
      `| 属性 | 值 |`,
      `|------|-----|`,
      `| 视频ID | \`${videoInfo.video_id}\` |`,
      author ? `| 作者 | ${author} |` : null,
      `| 时长 | ${durationStr} |`,
      `| 大小 | ${sizeMB} MB |`,
      `| 来源 | ${videoInfo.url} |`,
      `| 解析方式 | ${method} |`,
      `| 转录时间 | ${new Date().toLocaleString('zh-CN')} |`,
      '',
      '---',
      '',
      '## 文案',
      '',
      textContent,
      ''
    ].filter(Boolean).join('\n');
    fs.writeFileSync(transcriptPath, md, 'utf-8');
    if (showProgress) log(`文案已保存: ${transcriptPath}`, 'green');
  }

  return {
    video_info: videoInfo,
    video_path: videoPath,
    audio_path: audioPath,
    cover_path: coverPath,
    transcript_path: transcriptPath,
    text_content: textContent,
    media_info: mediaInfo,
    resolve_method: method,
    output_folder: outputFolder
  };
}

// ============ 主入口 ============

async function resolve(shareLink, outputDir = './output', showProgress = true) {
  outputDir = path.resolve(outputDir);

  // Level 1: API + HTML
  let result = await tryApiParse(shareLink, outputDir, showProgress);

  // Level 2: 浏览器模式
  if (!result) {
    try {
      result = await tryBrowserExtract(shareLink, outputDir, showProgress);
    } catch (e) {
      warn(`浏览器模式失败: ${e.message}`);
    }
  }

  // Level 3: yt-dlp
  if (!result) {
    result = await tryYtdlpDownload(shareLink, outputDir, showProgress);
  }

  if (!result) {
    throw new Error('所有解析方式均失败（API → 浏览器 → yt-dlp）');
  }

  // 统一后处理
  return postProcess(result, outputDir, showProgress);
}

// ============ CLI ============

function parseCliArgs(args) {
  const parsed = { command: args[0], link: args[1], output: './output', showProgress: true };
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '-o' && args[i + 1]) { parsed.output = args[i + 1]; i++; }
    else if (args[i] === '--no-progress') { parsed.showProgress = false; }
  }
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
抖音统一解析器 - 三层降级策略

用法:
  node douyin_resolver.js resolve "分享链接" [-o 输出目录]
  node douyin_resolver.js info "分享链接"
  node douyin_resolver.js download "分享链接" [-o 输出目录]

命令:
  resolve    完整流程：解析 + 下载 + 音频 + 语音识别（自动降级）
  info       仅解析视频信息（Level 1 快速探测）
  download   仅下载视频文件（自动降级）

选项:
  -o <目录>          输出目录 (默认: ./output)
  --no-progress      不显示进度

降级策略:
  Level 1: 抖音 Web API + HTML DOM 解析（最快）
  Level 2: 浏览器模式（需 agent 设置 DOUYIN_AUDIO_URL 环境变量）
  Level 3: yt-dlp 兜底下载（需安装 yt-dlp）

环境变量:
  SILICONFLOW_API_KEY     硅基流动 API Key（必须，用于语音识别）
  DOUYIN_AUDIO_URL   浏览器模式音频流 URL（由 agent 设置）
  DOUYIN_VIDEO_URL   浏览器模式视频流 URL（由 agent 设置，可选）
  DOUYIN_TITLE       浏览器模式视频标题（由 agent 设置）
  DOUYIN_AUTHOR      浏览器模式视频作者（由 agent 设置）
`);
    process.exit(0);
  }

  const cli = parseCliArgs(args);

  if (!cli.link) {
    error('请提供抖音分享链接');
    process.exit(1);
  }

  try {
    if (cli.command === 'info') {
      log('📡 解析视频信息...', 'cyan');
      const info = await parseShareUrl(cli.link);
      console.log(JSON.stringify(info, null, 2));

    } else if (cli.command === 'download') {
      log('📥 下载视频...', 'cyan');
      let result = await tryApiParse(cli.link, cli.output, cli.showProgress);
      if (!result) {
        try { result = await tryBrowserExtract(cli.link, cli.output, cli.showProgress); } catch {}
      }
      if (!result) {
        result = await tryYtdlpDownload(cli.link, cli.output, cli.showProgress);
      }
      if (!result) throw new Error('所有下载方式均失败');
      const final = await postProcess(result, cli.output, cli.showProgress);
      console.log(JSON.stringify({
        video_info: final.video_info,
        video_path: final.video_path,
        cover_path: final.cover_path,
        media_info: final.media_info,
        resolve_method: final.resolve_method
      }, null, 2));

    } else if (cli.command === 'resolve') {
      log('🎬 抖音统一解析器', 'cyan');
      const final = await resolve(cli.link, cli.output, cli.showProgress);
      console.log(JSON.stringify(final, null, 2));

    } else {
      error(`未知命令: ${cli.command}（支持: resolve, info, download）`);
      process.exit(1);
    }
  } catch (e) {
    error(e.message);
    process.exit(1);
  }
}

main();
