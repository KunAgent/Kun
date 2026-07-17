#!/usr/bin/env node

/**
 * 微信公众号文章搜索工具
 * 通过搜狗微信搜索获取微信公众号文章
 */

const https = require('https');
const cheerio = require('cheerio');
const zlib = require('zlib');

// 可配置 User-Agent 池（固定 20 个），每次请求随机选一个，避免固定 UA
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/123.0.0.0 Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/122.0.0.0 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Mi 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Encoding': 'identity',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Host': 'weixin.sogou.com',
  'Referer': 'https://weixin.sogou.com/',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decompressBody(buffer, contentEncoding) {
  if (!contentEncoding) return buffer;
  const encoding = String(contentEncoding).toLowerCase();
  try {
    if (encoding.includes('gzip')) return zlib.gunzipSync(buffer);
    if (encoding.includes('deflate')) return zlib.inflateSync(buffer);
    if (encoding.includes('br')) return zlib.brotliDecompressSync(buffer);
  } catch {
    // 解压失败时直接返回原始数据，避免影响主流程
  }
  return buffer;
}

/**
 * 统一的网络请求工具（仅 https），带超时与重试，可处理 gzip/deflate/br 解压。
 * @param {{
 *   url: string,
 *   method?: string,
 *   headers?: Object,
 *   timeoutMs?: number,
 *   retries?: number
 * }} options
 * @returns {Promise<{statusCode: number, headers: Object, body: Buffer}>}
 */
async function request(options) {
  const {
    url,
    method = 'GET',
    headers = {},
    timeoutMs = 15000,
    retries = 0,
  } = options;

  const lastErrorPrefix = `Request failed: ${method} ${url}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method,
          headers,
        };

        const req = https.request(reqOptions, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const body = decompressBody(raw, res.headers['content-encoding']);
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body,
            });
          });
        });

        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        req.end();
      });

      return result;
    } catch (e) {
      if (attempt >= retries) {
        throw new Error(`${lastErrorPrefix}: ${e.message}`);
      }
      await sleep(300 + attempt * 300);
    }
  }

  throw new Error(`${lastErrorPrefix}: unexpected`);
}

async function requestText(options) {
  const resp = await request(options);
  return {
    ...resp,
    text: resp.body.toString('utf-8'),
  };
}

/**
 * 从响应头中提取cookie
 * @param {Object} headers - HTTP响应头
 * @returns {string} cookie字符串
 */
function extractCookies(headers) {
  const cookies = [];
  const setCookieHeader = headers['set-cookie'];
  
  if (setCookieHeader) {
    setCookieHeader.forEach(cookie => {
      const cookieValue = cookie.split(';')[0];
      if (cookieValue) {
        cookies.push(cookieValue);
      }
    });
  }
  
  return cookies.join('; ');
}

/**
 * 从搜狗视频页面获取cookie
 * @returns {Promise<{cookieStr: string, cookieObj: Object}>} cookie字符串与对象
 */
async function getSogouCookie() {
  try {
    const resp = await request({
      url: 'https://v.sogou.com/v?ie=utf8&query=&p=40030600',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': getRandomUserAgent(),
      },
      timeoutMs: 10000,
      retries: 1,
    });

    const cookies = extractCookies(resp.headers);
    const cookieObj = {};
    if (cookies) {
      cookies.split('; ').forEach(cookie => {
        const [key, value] = cookie.split('=');
        if (key && value) {
          cookieObj[key.trim()] = value.trim();
        }
      });
    }

    return { cookieStr: cookies || '', cookieObj };
  } catch {
    return { cookieStr: '', cookieObj: {} };
  }
}

/**
 * 发起HTTP GET请求
 * @param {string} url - 请求URL
 * @param {string} cookieStr - cookie字符串（可选）
 * @returns {Promise<string>} 响应HTML内容
 */
async function httpGet(url, cookieStr = '') {
  const headers = {
    ...HEADERS,
    'User-Agent': getRandomUserAgent(),
  };
  if (cookieStr) {
    headers['Cookie'] = cookieStr;
  }

  const resp = await requestText({
    url,
    headers,
    timeoutMs: 30000,
    retries: 1,
  });

  return resp.text;
}

/**
 * 从搜狗搜索页 HTML 中解析文章列表
 * @param {string} html
 * @param {number} maxResults
 */
function parseArticlesFromSearchHtml(html, maxResults) {
  const articles = [];
  const $ = cheerio.load(html);

  const $newsList = $('ul.news-list');
  if ($newsList.length === 0) return [];

  $newsList.find('li').each((_, element) => {
    if (articles.length >= maxResults) return false;
    const article = parseArticle($, element);
    if (article) {
      articles.push(article);
    }
  });

  return articles;
}

/**
 * 从HTML中提取跳转URL（处理JavaScript跳转或meta refresh）
 * @param {string} html - HTML内容
 * @returns {string|null} 跳转URL
 */
function extractRedirectUrlFromHtml(html) {
  // 尝试匹配 meta refresh
  const metaMatch = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)["'][^>]*>/i);
  if (metaMatch) {
    return metaMatch[1];
  }
  
  // 尝试匹配 JavaScript 跳转
  const jsMatch = html.match(/location\.href\s*=\s*["']([^"']+)["']/i) || 
                  html.match(/location\s*=\s*["']([^"']+)["']/i) ||
                  html.match(/window\.location\s*=\s*["']([^"']+)["']/i);
  if (jsMatch) {
    return jsMatch[1];
  }

  // 尝试匹配“拼接 url 变量 + location.replace(url)”的跳转方式
  // 典型形态：
  //   var url = '';
  //   url += 'https://mp.';
  //   url += 'weixin.qq.com/...';
  //   window.location.replace(url)
  // 参考截图中的 Python 思路：re.findall("url\s*\+=\s*'([^']*)'") 后 join
  const urlParts = [];
  for (const m of html.matchAll(/url\s*\+=\s*'([^']*)'/g)) {
    urlParts.push(m[1]);
  }
  for (const m of html.matchAll(/url\s*\+=\s*"([^"]*)"/g)) {
    urlParts.push(m[1]);
  }
  if (urlParts.length > 0) {
    const joined = urlParts.join('');
    if (joined.includes('mp.weixin.qq.com')) {
      return joined;
    }
  }
  
  return null;
}

/**
 * 获取URL重定向后的真实地址（参考Python实现）
 * @param {string} url - 原始URL
 * @param {Object} cookieObj - cookie对象
 * @param {number} retries - 重试次数
 * @returns {Promise<string>} 重定向后的真实URL
 */
function getRealUrl(url, cookieObj = {}, retries = 3) {
  return new Promise((resolve) => {
    // 如果不是搜狗链接，直接返回原URL
    if (!url.includes('weixin.sogou.com')) {
      resolve(url);
      return;
    }

    (async () => {
      // 构建Cookie字符串
      const baseCookies = 'ABTEST=7|1716888919|v1; IPLOC=CN5101; ariaDefaultTheme=default; ariaFixed=true; ariaReadtype=1; ariaStatus=false';
      const snuid = cookieObj['SNUID'] || '';
      const cookieStr = snuid ? `${baseCookies}; SNUID=${snuid}` : baseCookies;

      const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cookie': cookieStr,
        'User-Agent': getRandomUserAgent(),
      };

      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const resp = await request({
            url,
            headers,
            timeoutMs: 5000,
            retries: 0,
          });

          // 检查重定向（不跟随重定向，直接获取Location）
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
            const redirectUrl = resp.headers.location;
            if (redirectUrl.includes('mp.weixin.qq.com')) {
              resolve(redirectUrl);
              return;
            }
            resolve(url);
            return;
          }

          if (resp.statusCode === 200) {
            const html = resp.body.toString('utf-8');
            console.error(`  获取到HTML内容(长度: ${html.length})，尝试解析跳转URL...`);
            const redirectUrl = extractRedirectUrlFromHtml(html);
            if (redirectUrl && redirectUrl.includes('mp.weixin.qq.com')) {
              resolve(redirectUrl);
              return;
            }
            resolve(url);
            return;
          }
        } catch {
          // 忽略错误，进入重试
        }

        if (attempt < retries - 1) {
          await sleep(1000);
        }
      }

      resolve(url);
    })();
  });
}

function parseCliArgs(args) {
  let query = '';
  let num = 10;
  let output = '';
  let resolveRealUrl = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--num') {
      num = parseInt(args[i + 1]) || 10;
      i++;
    } else if (args[i] === '-o' || args[i] === '--output') {
      output = args[i + 1] || '';
      i++;
    } else if (args[i] === '-r' || args[i] === '--resolve-url') {
      resolveRealUrl = true;
    } else if (!args[i].startsWith('-')) {
      query = args[i];
    }
  }

  return { query, num, output, resolveRealUrl };
}

/**
 * 批量获取文章的真实URL
 * @param {Array} articles - 文章列表
 * @returns {Promise<Array>} 包含真实URL的文章列表
 */
async function resolveRealUrls(articles) {
  // 获取cookie用于解析URL
  const { cookieObj } = await getSogouCookie();
  
  console.error(`获取到 ${articles.length} 篇文章，开始解析真实URL...`);
  console.error('注意：搜狗微信有严格的反爬虫机制，可能无法获取真实URL');
  
  const results = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    try {
      console.error(`[${i + 1}/${articles.length}] 解析: ${article.title.substring(0, 30)}...`);
      const realUrl = await getRealUrl(article.url, cookieObj);
      
      // 检查是否成功获取到真实URL（不是搜狗链接，也不是antispider页面）
      const isSuccess = !realUrl.includes('weixin.sogou.com') && !realUrl.includes('antispider');
      
      results.push({
        ...article,
        url: isSuccess ? realUrl : article.url,
        url_resolved: isSuccess
      });
      
      if (isSuccess) {
        successCount++;
      } else {
        failCount++;
      }
      
      // 添加延迟避免请求过快
      if (i < articles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      }
    } catch (error) {
      console.error(`  解析失败: ${error.message}`);
      failCount++;
      results.push({
        ...article,
        url: article.url,
        url_resolved: false
      });
    }
  }
  
  console.error(`\n解析完成: 成功 ${successCount}, 失败 ${failCount}`);
  
  return results;
}

/**
 * 解析相对时间为绝对时间
 * @param {string} timeText - 时间文本（如"1天前"、"2小时前"、"30分钟前"）
 * @returns {Object} 包含datetime和dateText的对象
 */
function parseRelativeTime(timeText) {
  if (!timeText) return { datetime: '', dateText: '' };
  
  const now = new Date();
  let targetDate = new Date(now);
  
  // 匹配各种相对时间格式
  const dayMatch = timeText.match(/(\d+)天前/);
  const hourMatch = timeText.match(/(\d+)小时前/);
  const minuteMatch = timeText.match(/(\d+)分钟前/);
  
  if (dayMatch) {
    const days = parseInt(dayMatch[1]);
    targetDate.setDate(now.getDate() - days);
  } else if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    targetDate.setHours(now.getHours() - hours);
  } else if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1]);
    targetDate.setMinutes(now.getMinutes() - minutes);
  } else {
    // 尝试匹配标准日期格式（如"2024-01-15"）
    const dateMatch = timeText.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      targetDate = new Date(
        parseInt(dateMatch[1]),
        parseInt(dateMatch[2]) - 1,
        parseInt(dateMatch[3])
      );
    } else {
      return { datetime: '', dateText: timeText };
    }
  }
  
  const datetime = targetDate.toISOString().slice(0, 19).replace('T', ' ');
  const dateText = `${targetDate.getFullYear()}年${String(targetDate.getMonth() + 1).padStart(2, '0')}月${String(targetDate.getDate()).padStart(2, '0')}日`;
  
  return { datetime, dateText };
}

/**
 * 将Date对象格式化为中国时区（UTC+8）的datetime字符串
 * @param {Date} date - Date对象
 * @returns {string} YYYY-MM-DD HH:mm:ss 格式的中国时间
 */
function formatChinaDateTime(date) {
  // 转换为中国时间（UTC+8）
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  const hours = String(chinaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(chinaTime.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 解析单篇文章
 * @param {Object} $ - cheerio实例
 * @param {Object} element - 文章DOM元素
 * @returns {Object|null} 文章数据对象
 */
function parseArticle($, element) {
  try {
    const $elem = $(element);
    
    // 获取标题和URL
    const $titleLink = $elem.find('h3 a');
    if ($titleLink.length === 0) return null;
    
    const title = $titleLink.text().trim();
    let url = $titleLink.attr('href') || '';
    
    // 处理相对URL
    if (url.startsWith('/')) {
      url = `https://weixin.sogou.com${url}`;
    }
    
    // 获取概要
    const summary = $elem.find('p.txt-info').text().trim();
    
    // 获取日期和来源
    let datetime = '';
    let dateText = '';
    let source = '';
    let timeDescription = ''; // 原始时间文字描述（如"2小时前"）
    
    const $sourceBox = $elem.find('.s-p');
    if ($sourceBox.length > 0) {
      // 获取日期 - 优先从script标签获取时间戳
      const $dateScript = $sourceBox.find('.s2 script');
      if ($dateScript.length > 0) {
        const scriptText = $dateScript.text();
        const timestampMatch = scriptText.match(/(\d{10})/);
        if (timestampMatch) {
          const timestamp = parseInt(timestampMatch[1]) * 1000;
          const date = new Date(timestamp);
          datetime = formatChinaDateTime(date);
          dateText = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
        }
      }
      
      // 尝试从文本获取时间描述（优先保存原始描述）
      const $timeElem = $sourceBox.find('.s2');
      if ($timeElem.length > 0) {
        // 获取script中的时间戳用于计算
        const scriptText = $timeElem.find('script').text();
        const timestampMatch = scriptText.match(/(\d{10})/);
        
        if (timestampMatch) {
          // 如果有时间戳，计算相对时间描述
          const timestamp = parseInt(timestampMatch[1]) * 1000;
          const articleDate = new Date(timestamp);
          const now = new Date();
          const diffMs = now - articleDate;
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          
          if (diffDays > 0) {
            timeDescription = `${diffDays}天前`;
          } else if (diffHours > 0) {
            timeDescription = `${diffHours}小时前`;
          } else {
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            if (diffMinutes > 0) {
              timeDescription = `${diffMinutes}分钟前`;
            } else {
              timeDescription = '刚刚';
            }
          }
        } else {
          // 如果没有时间戳，尝试从文本获取
          const timeText = $timeElem.clone().children('script').remove().end().text().trim();
          if (timeText && !datetime) {
            timeDescription = timeText;
            const parsedTime = parseRelativeTime(timeText);
            datetime = parsedTime.datetime;
            dateText = parsedTime.dateText;
          }
        }
      }
      
      // 获取来源公众号名称 - 从 .all-time-y2 或 a.account 获取
      const $sourceSpan = $sourceBox.find('.all-time-y2');
      const $sourceLink = $sourceBox.find('a.account');
      if ($sourceSpan.length > 0) {
        source = $sourceSpan.text().trim();
      } else if ($sourceLink.length > 0) {
        source = $sourceLink.text().trim();
      }
    }
    
    return {
      title,
      url,
      summary,
      datetime,
      date_text: dateText,
      date_description: timeDescription || dateText,
      source
    };
  } catch (error) {
    console.error('解析文章失败:', error.message);
    return null;
  }
}

/**
 * 搜索微信公众号文章
 * @param {string} query - 搜索关键词
 * @param {number} maxResults - 最大返回结果数（默认10，最大50）
 * @returns {Promise<Array>} 文章列表
 */
async function searchWechatArticles(query, maxResults = 10, resolveRealUrl = false) {
  // 限制最大结果数
  maxResults = Math.min(maxResults, 50);

  const articles = [];
  let page = 1;
  const pagesNeeded = Math.ceil(maxResults / 10);

  while (articles.length < maxResults && page <= pagesNeeded) {
    try {
      // 先获取cookie
      const { cookieStr } = await getSogouCookie();
      
      // 构建搜索URL
      const encodedQuery = encodeURIComponent(query);
      const url = `https://weixin.sogou.com/weixin?query=${encodedQuery}&s_from=input&_sug_=n&type=2&page=${page}&ie=utf8`;

      const html = await httpGet(url, cookieStr);

      const remaining = maxResults - articles.length;
      const parsed = parseArticlesFromSearchHtml(html, remaining);
      if (parsed.length === 0) break;
      articles.push(...parsed);

      page++;

      // 添加短暂延迟避免请求过快
      if (page <= pagesNeeded) {
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      }
    } catch (error) {
      console.error(`请求第${page}页失败:`, error.message);
      break;
    }
  }

  const result = articles.slice(0, maxResults);
  
  // 如果需要解析真实URL
  if (resolveRealUrl && result.length > 0) {
    console.error('正在解析真实URL...');
    return await resolveRealUrls(result);
  }

  return result;
}

/**
 * 主函数 - 处理命令行参数
 */
async function main() {
  const args = process.argv.slice(2);

  const { query, num, output, resolveRealUrl } = parseCliArgs(args);
  
  if (!query) {
    console.log(`
微信公众号文章搜索工具

用法:
  node search_wechat.js <关键词> [选项]

选项:
  -n, --num <数量>       返回结果数量（默认10，最大50）
  -o, --output <文件>    输出JSON文件路径
  -r, --resolve-url      解析真实的微信文章URL（会额外请求每个链接）

示例:
  node search_wechat.js "人工智能" -n 20
  node search_wechat.js "ChatGPT" -n 10 -o result.json
  node search_wechat.js "人工智能" -n 5 -r
`);
    process.exit(0);
  }
  
  try {
    console.error(`正在搜索: "${query}"...`);
    
    const articles = await searchWechatArticles(query, num, resolveRealUrl);
    
    const result = {
      query,
      total: articles.length,
      articles
    };
    
    const jsonOutput = JSON.stringify(result, null, 2);
    
    if (output) {
      const fs = require('fs');
      fs.writeFileSync(output, jsonOutput, 'utf-8');
      console.error(`结果已保存到: ${output}`);
    }
    
    console.log(jsonOutput);
  } catch (error) {
    console.error('搜索失败:', error.message);
    process.exit(1);
  }
}

// 导出模块供其他脚本使用
module.exports = {
  searchWechatArticles
};

// 如果直接运行此脚本
if (require.main === module) {
  main();
}
