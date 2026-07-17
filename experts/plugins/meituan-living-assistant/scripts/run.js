#!/usr/bin/env node
/**
 * huisheng-coupon-tool 统一入口脚本
 *
 * 跨平台（macOS / Windows）统一调度，AI 只需执行:
 *   node run.js <command> [options]
 *
 * 子命令:
 *   init                          环境初始化（Python检查 + npm检查 + pt-passport安装）
 *   get-device-token              获取设备标识
 *   get-token [--env test|prod]   获取缓存的用户Token
 *   auth-get-code [--env test|prod]  获取授权链接
 *   auth-poll-token               获取用户授权结果
 *   qrcode <url>                  获取二维码图片URL（服务端生成）
 *   qrcode <url> [client_id]      生成二维码PNG
 *   issue                         领券
 *   hotword --city-id <id>        热搜词查询
 *   search --keyword <kw> --lat <lat> --lng <lng> --city-id <id> [--page N] [--page-size N] [--query-id Q] [--request-id R] [--max-distance-km D]
 *   location                      获取用户近期位置
 *   location-by-address --address <addr>  根据地址获取经纬度
 *   order --product-id <pid> --poi-id <pid> --city-id <id> --uuid <u> [--lat <lat>] [--lng <lng>] [--quantity N]
 *   logout                        退出登录
 *   clear-device-token            清除设备标识
 *
 * 所有命令输出 JSON 到 stdout，错误信息输出到 stderr。
 */


const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// ── 全局常量 ─────────────────────────────────────────────────
const SCRIPTS_DIR = __dirname;
const SKILL_DIR = path.dirname(SCRIPTS_DIR);
const CLIENT_ID = 'c6f50b5a1e2f4e2bb00a3e2f58df3ced';
const PT_PASSPORT_BIN = path.join(SCRIPTS_DIR, 'node_modules', '.bin', 'pt-passport');
const AUTH_DIR = path.join(require('os').homedir(), '.workbuddy', 'credentials', 'meituan-living-deals-assistant');
const PYTHON = findPython();

// 动态获取 certifi 证书路径，用于修复 macOS Python SSL 证书问题
// 若 certifi 未安装则为空字符串，Python 脚本使用系统默认证书
const CERT_FILE = (() => {
  try {
    return execSync(`${PYTHON} -m certifi`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
  } catch (_) { return ''; }
})();

// ── 工具函数 ─────────────────────────────────────────────────

function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const ver = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
      if (ver && !ver.startsWith('Python 2.')) return cmd;
    } catch (_) { /* ignore */ }
  }
  return 'python3';
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function fail(error, extra) {
  out(Object.assign({ ok: false, error }, extra || {}));
  process.exit(1);
}

/** 执行 Python 脚本，返回解析后的 JSON */
function runPython(scriptName, args) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const cmdArgs = [scriptPath, ...args];
  try {
    try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch (_) {}
    const sslEnv = CERT_FILE
        ? { SSL_CERT_FILE: CERT_FILE, REQUESTS_CA_BUNDLE: CERT_FILE }
        : {};
    const result = spawnSync(PYTHON, cmdArgs, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: SCRIPTS_DIR,
      env: Object.assign({}, process.env, sslEnv, {
        WORKBUDDY_AUTH_FILE: path.join(AUTH_DIR, 'token.json'),
        NODE_OPTIONS: ''
      })
    });
    const stdout = (result.stdout || '').trim();
    if (result.status !== 0) {
      try { return JSON.parse(stdout); } catch (_) {}
      return { ok: false, error: 'SCRIPT_ERROR', message: (result.stderr || stdout || 'Unknown error').trim() };
    }
    try { return JSON.parse(stdout); } catch (_) {
      return { ok: false, error: 'PARSE_ERROR', message: 'Invalid JSON from script', raw: stdout };
    }
  } catch (e) {
    return { ok: false, error: 'EXEC_ERROR', message: e.message };
  }
}

/** 执行 pt-passport CLI 命令，返回原始 stdout */
function runPassport(args) {
  try {
    const result = spawnSync(PT_PASSPORT_BIN, args, {
      encoding: 'utf-8',
      timeout: 620000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        HOME: require('os').homedir(),
        PT_PASSPORT_AUTH_FILE: path.join(AUTH_DIR, 'pt_passport_auth.json'),
        NODE_OPTIONS: ''
      }),
      shell: true
    });
    return {
      exitCode: result.status,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim()
    };
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: e.message };
  }
}

/**
 * 从 pt-passport 缓存中读取当前用户 Token
 * 内部使用，不暴露到命令行参数中，防止 token 泄漏
 */
function getCachedToken() {
  const res = runPassport(['get-token', '--client_id', CLIENT_ID]);
  if (res.exitCode === 0 && res.stdout) {
    return res.stdout;
  }
  return null;
}

/** 解析 --key value 形式的命令行参数 */
function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i];
      } else {
        args[key] = 'true';
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}



// ── 子命令实现 ───────────────────────────────────────────────

const commands = {};

/**
 * init — 环境初始化
 */
commands.init = function () {
  // 1. 路径验证
  if (!fs.existsSync(SCRIPTS_DIR) || !fs.statSync(SCRIPTS_DIR).isDirectory()) {
    fail('PATH_NOT_FOUND');
  }

  // 2. Python 检查
  let pyVer = '';
  try {
    pyVer = execSync(`${PYTHON} --version`, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
  } catch (_) { /* ignore */ }

  if (!pyVer) fail('PYTHON_NOT_FOUND');
  if (pyVer.startsWith('Python 2.')) fail('PYTHON_VERSION_2');

  // 3. Node.js 版本检查
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    fail('NODE_VERSION_LOW', { current: String(nodeMajor), required: '>=18' });
  }

  // 4. npm 检查
  try {
    execSync('npm --version', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe', env: Object.assign({}, process.env, { NODE_OPTIONS: '' }) });
  } catch (_) {
    fail('NPM_NOT_FOUND');
  }

  // 5. pt-passport CLI 本地安装/更新
  const tgzFiles = fs.readdirSync(SCRIPTS_DIR)
      .filter(f => f.startsWith('mtuser-pt-passport-') && f.endsWith('.tgz'))
      .sort()
      .map(f => path.join(SCRIPTS_DIR, f));

  if (tgzFiles.length === 0) fail('TGZ_NOT_FOUND');

  const tgzFile = tgzFiles[tgzFiles.length - 1];
  const bundleVersion = path.basename(tgzFile).replace('mtuser-pt-passport-', '').replace('.tgz', '');

  let localVersion = '';
  try {
    const res = spawnSync(PT_PASSPORT_BIN, ['--version'], { encoding: 'utf-8', timeout: 10000, stdio: 'pipe', shell: true, env: Object.assign({}, process.env, { NODE_OPTIONS: '' }) });
    localVersion = (res.stdout || '').trim().split('\n').pop();
  } catch (_) { /* not installed */ }

  if (localVersion !== bundleVersion) {
    try {
      execSync(`npm install "${tgzFile}" --prefix "${SCRIPTS_DIR}" --save-exact --force`, { encoding: 'utf-8', timeout: 60000, stdio: 'pipe', env: Object.assign({}, process.env, { NODE_OPTIONS: '' }) });
    } catch (_) {
      fail('INSTALL_FAILED');
    }
  }

  // 6. 确保 .auth 目录存在
  try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch (_) {}

  // 7. 检测客户端类型
  var clientType = (function () {
    var envType = (process.env.WORKBUDDY_CLIENT_TYPE || '').toLowerCase();
    if (envType === 'mac' || envType === 'windows' || envType === 'miniprogram') return envType;
    if (envType === 'pc') return process.platform === 'darwin' ? 'mac' : 'windows';
    if (process.platform === 'darwin') return 'mac';
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'linux') return 'miniprogram';
    return 'pc';
  })();

  out({ ok: true, scripts_dir: SCRIPTS_DIR, skill_dir: SKILL_DIR, clientType: clientType });
};

/**
 * get-client-type — 检测当前运行环境
 * 返回: mac / windows / miniprogram
 */
commands['get-client-type'] = function () {
  var envType = (process.env.WORKBUDDY_CLIENT_TYPE || '').toLowerCase();
  if (envType === 'mac' || envType === 'windows' || envType === 'miniprogram') {
    out({ ok: true, clientType: envType });
    return;
  }
  if (envType === 'pc') {
    out({ ok: true, clientType: process.platform === 'darwin' ? 'mac' : 'windows' });
    return;
  }
  // 操作系统推断
  if (process.platform === 'darwin') {
    out({ ok: true, clientType: 'mac' });
  } else if (process.platform === 'win32') {
    out({ ok: true, clientType: 'windows' });
  } else if (process.platform === 'linux') {
    out({ ok: true, clientType: 'miniprogram' });
  } else {
    out({ ok: true, clientType: 'pc' });
  }
};

/**
 * get-device-token — 获取设备标识
 */
commands['get-device-token'] = function () {
  const result = runPython('auth.py', ['get-device-token']);
  if (result.success && result.device_token) {
    out({ ok: true, device_token: result.device_token });
  } else if (result.device_token) {
    out({ ok: true, device_token: result.device_token });
  } else {
    fail('DEVICE_TOKEN_FAILED', { detail: result });
  }
};

/**
 * get-token — 获取缓存的用户 Token
 */
commands['get-token'] = function (argv) {
  const { args } = parseArgs(argv || []);
  const passportArgs = ['get-token', '--client_id', CLIENT_ID];
  if (args['env'] === 'test') {
    passportArgs.push('--env', 'test');
  }
  const res = runPassport(passportArgs);
  if (res.exitCode === 0 && res.stdout) {
    out({ ok: true, token: res.stdout });
  } else {
    out({ ok: false, error: 'NO_TOKEN', message: 'Token not found or expired' });
  }
};

/**
 * auth-get-code — 获取授权链接
 */
commands['auth-get-code'] = function (argv) {
  const { args } = parseArgs(argv || []);
  const passportArgs = ['auth', 'get-code', '--client_id', CLIENT_ID];
  if (args['env'] === 'test') {
    passportArgs.push('--env', 'test');
  }
  const res = runPassport(passportArgs);
  const stdout = res.stdout;

  // Token: <token> — 缓存命中
  const tokenMatch = stdout.match(/Token:\s*(.+)/);
  if (tokenMatch) {
    out({ ok: true, type: 'token', token: tokenMatch[1].trim() });
    return;
  }

  // AUTH_LINK: <url>
  const linkMatch = stdout.match(/AUTH_LINK:\s*(.+)/);
  if (linkMatch) {
    out({ ok: true, type: 'auth_link', url: linkMatch[1].trim() });
    return;
  }

  // ❌ 错误
  const errorMatch = stdout.match(/❌\s*code=(\d+)\s*message=(.*)/);
  if (errorMatch) {
    out({ ok: false, error: 'AUTH_ERROR', code: errorMatch[1], message: errorMatch[2].trim() });
    return;
  }

  out({ ok: false, error: 'UNKNOWN', raw: stdout, stderr: res.stderr });
};

/**
 * auth-poll-token — 获取用户授权结果
 * 注意：poll-token 从 get-code 生成的 session 文件读取环境信息，无需传 --env
 *
 * 兜底逻辑：若 poll-token 失败，自动调用 auth get-code 二次确认，
 * 因为存在后端竞态条件（用户已扫码成功但 poll 会话已被关闭）。
 */
commands['auth-poll-token'] = function () {
  const res = runPassport(['auth', 'poll-token', '--client_id', CLIENT_ID]);
  const stdout = res.stdout;

  // 正常成功
  const tokenMatch = stdout.match(/Token:\s*(.+)/);
  if (res.exitCode === 0 && tokenMatch) {
    out({ ok: true, token: tokenMatch[1].trim() });
    return;
  }

  // poll 失败，执行兜底：调用 auth get-code 检查是否已有 token
  const fallbackRes = runPassport(['auth', 'get-code', '--client_id', CLIENT_ID]);
  const fallbackStdout = fallbackRes.stdout;

  // 兜底命中缓存：用户已扫码成功
  const fallbackTokenMatch = fallbackStdout.match(/Token:\s*(.+)/);
  if (fallbackTokenMatch) {
    out({ ok: true, token: fallbackTokenMatch[1].trim() });
    return;
  }

  // 兜底未命中缓存：确认登录确实失败
  out({ ok: false, error: 'POLL_FAILED', message: '登录失败，请重新登录' });
};

// ── CLIGuard 签名集成 ─────────────────────────────────────────

function loadCliguard() {
  const vendorPath = path.join(SCRIPTS_DIR, 'vendor', 'cliguard', 'js', 'cliguard.js');
  const updatePath = path.join(
      require('os').homedir(), '.cliguard', 'cliguard-updates', 'core', 'cliguard.js'
  );
  if (fs.existsSync(vendorPath)) return require(vendorPath);
  if (fs.existsSync(updatePath)) return require(updatePath);
  return null;
}

function addCommonParams(urlStr) {
  try {
    const cliguard = loadCliguard();
    if (!cliguard || typeof cliguard.addCommonParams !== 'function') return urlStr;
    const result = cliguard.addCommonParams(urlStr);
    return (result && result.url) ? result.url : urlStr;
  } catch (e) {
    process.stderr.write('[run.js:addCommonParams] warning: ' + e.message + '\n');
    return urlStr;
  }
}

function makeSignHeaders(method, urlStr, bodyHash) {
  try {
    const cliguard = loadCliguard();
    if (!cliguard || typeof cliguard.signRequest !== 'function') return {};
    return cliguard.signRequest(method.toUpperCase(), urlStr, bodyHash || '') || {};
  } catch (e) {
    process.stderr.write('[run.js:makeSignHeaders] warning: ' + e.message + '\n');
    return {};
  }
}

function httpsPost(urlStr, bodyObj, extraHeaders) {
  return new Promise(function (resolve, reject) {
    const bodyStr = JSON.stringify(bodyObj);
    const bodyBuf = Buffer.from(bodyStr, 'utf-8');
    const hashSlice = bodyBuf.slice(0, 16200);
    const bodyHash = crypto.createHash('md5').update(hashSlice).digest('hex');
    const signedUrl = addCommonParams(urlStr);
    const sigHeaders = makeSignHeaders('POST', signedUrl, bodyHash);
    const parsed = new URL(signedUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.length,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'X-Requested-With': 'XMLHttpRequest'
      }, sigHeaders, extraHeaders || {})
    };
    const req = https.request(options, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, data: null, raw: body }); }
      });
    });
    req.on('error', function (e) { reject(e); });
    req.setTimeout(15000, function () { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(bodyBuf);
    req.end();
  });
}

function httpsGet(urlStr, extraHeaders) {
  return new Promise(function (resolve, reject) {
    const signedUrl = addCommonParams(urlStr);
    const sigHeaders = makeSignHeaders('GET', signedUrl, '');
    const parsed = new URL(signedUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'X-Requested-With': 'XMLHttpRequest'
      }, sigHeaders, extraHeaders || {})
    };
    const req = https.request(options, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, data: null, raw: body }); }
      });
    });
    req.on('error', function (e) { reject(e); });
    req.setTimeout(15000, function () { req.destroy(); reject(new Error('TIMEOUT')); });
    req.end();
  });
}

/**
 * qrcode — 通过服务端接口获取二维码图片 URL
 * 用法: node run.js qrcode <url>
 * 调用 https://click.meituan.com/cps/ai/product/getQrCodeImage
 */
commands.qrcode = function (argv) {
  const url = (argv || [])[0] || '';

  if (!url) {
    out({ ok: false, type: 'skip' });
    return;
  }

  // 支付链接不允许生成二维码，直接跳过
  if (url.indexOf('npay.meituan.com') !== -1) {
    out({ ok: false, type: 'skip', message: 'Payment URL is not allowed to generate QR code' });
    return;
  }

  const apiUrl = 'https://click.meituan.com/cps/ai/product/getQrCodeImage';
  const body = { originalUrl: url, clientSource: 'coupon-fusion-workbuddy' };

  httpsPost(apiUrl, body)
      .then(function (resp) {
        const data = resp.data;
        if (data && data.data) {
          out({ ok: true, type: 'image', imageUrl: data.data });
        } else {
          out({ ok: false, type: 'skip', message: 'No image returned', raw: data });
        }
      })
      .catch(function (e) {
        out({ ok: false, type: 'skip', message: e.message });
      });
};

/**
 * issue — 领取优惠券（纯 Node.js 实现）
 * 用法: node run.js issue
 *
 * Token 从 pt-passport 缓存自动读取，不通过命令行传递。
 *
 * 返回格式（成功）:
 *   { ok: true, success: true, coupon_count: N, coupons: [...], count_str: "...", display_coupons: [...] }
 * 返回格式（失败）:
 *   { ok: false, success: false, error: "<ERROR_TYPE>", message: "..." }
 */
commands.issue = function (argv) {
  const { args } = parseArgs(argv || []);
  const token = getCachedToken();
  if (!token) fail('NO_TOKEN', { message: '未登录或 Token 已过期，请先登录' });

  const COUPON_BASE_URL = 'https://media.meituan.com';
  const COUPON_ISSUE_PATH = '/fulishemini/couponActivity/sendCouponWork';
  const CONFIG_FILE = path.join(SCRIPTS_DIR, 'config.json');
  const os = require('os');
  const LOG_DIR = path.join(os.tmpdir(), 'huisheng');
  const LOG_FILE = path.join(LOG_DIR, 'huisheng_issue.log');

  // ── 工具函数 ──────────────────────────────────────────────
  function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch (_) { return {}; }
  }

  function getDeviceToken() {
    try {
      const tokenFile = path.join(AUTH_DIR, 'token.json');
      return JSON.parse(fs.readFileSync(tokenFile, 'utf-8')).device_token || '';
    } catch (_) { return ''; }
  }

  function xorEncrypt(data, aiScene) {
    const deviceToken = getDeviceToken();
    var seed, flag;
    if (deviceToken) { seed = deviceToken + aiScene; flag = '1'; }
    else { seed = aiScene; flag = '0'; }
    const keyBytes = crypto.createHash('sha256').update(seed).digest();
    const dataBytes = Buffer.from(data, 'utf-8');
    const result = Buffer.alloc(dataBytes.length);
    for (var i = 0; i < dataBytes.length; i++) {
      result[i] = dataBytes[i] ^ keyBytes[i % 32];
    }
    return flag + ':' + result.toString('hex');
  }

  function writeLog(entry, aiScene) {
    try {
      try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
      var raw = JSON.stringify(entry);
      var line = aiScene ? xorEncrypt(raw, aiScene) : raw;
      fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
    } catch (_) {}
  }

  function fenToYuan(fen) {
    if (!fen) return '0';
    var yuan = parseInt(fen, 10) / 100;
    return yuan === Math.floor(yuan) ? String(Math.floor(yuan)) : yuan.toFixed(1);
  }

  function formatTimestampMs(tsMs) {
    if (!tsMs) return '-';
    try {
      var d = new Date(parseInt(tsMs, 10));
      var year = d.getFullYear();
      var month = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    } catch (_) { return String(tsMs); }
  }

  function formatCoupon(c) {
    var priceLimit = c.priceLimit;
    var couponValue = c.couponValue || 0;
    var discountInfo = '';
    if (priceLimit && priceLimit > 0) {
      discountInfo = '满' + fenToYuan(priceLimit) + '元减' + fenToYuan(couponValue) + '元';
    }
    var start = c.couponStartTime;
    var end = c.couponEndTime;
    var validPeriod = '';
    if (start && end) {
      validPeriod = formatTimestampMs(start) + ' 至 ' + formatTimestampMs(end);
    }
    return {
      name: c.couponName || '',
      discount_info: discountInfo,
      valid_period: validPeriod,
      priceLimit: priceLimit,
      couponValue: couponValue,
      tabName: c.tabName || ''
    };
  }

  // ── 展示结果构建 ──────────────────────────────────────────
  var _TAB_ORDER = ['外卖', '美食团购', '美团闪购', '休闲娱乐', '生活服务', '丽人医疗', '更多福利'];
  var _TAB_DISPLAY = { '更多福利': '其他' };
  var _SLOT_PLAN_BASE = [['外卖', 2], ['美食团购', 1], ['美团闪购', 1],
                         ['休闲娱乐', 1], ['生活服务', 1], ['丽人医疗', 1]];

  function buildCountStr(coupons) {
    var tabCount = {};
    for (var i = 0; i < coupons.length; i++) {
      var tab = coupons[i].tabName || '';
      tabCount[tab] = (tabCount[tab] || 0) + 1;
    }
    var unknownTabs = Object.keys(tabCount).filter(function (t) { return _TAB_ORDER.indexOf(t) < 0; });
    var finalOrder = _TAB_ORDER.slice(0, 6).concat(unknownTabs, _TAB_ORDER.slice(6));
    var parts = [];
    for (var j = 0; j < finalOrder.length; j++) {
      var t = finalOrder[j];
      if (!tabCount[t]) continue;
      var displayName = _TAB_DISPLAY[t] || t;
      parts.push(displayName + '优惠券' + tabCount[t] + '张');
    }
    return parts.join('、');
  }

  function buildDisplayCoupons(coupons) {
    function sortKey(c) {
      var pl = c.priceLimit;
      if (!pl) return [0, 0];
      return [1, -(c.couponValue / pl)];
    }
    function compareFn(a, b) {
      var ka = sortKey(a), kb = sortKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    }
    var groups = {};
    for (var i = 0; i < coupons.length; i++) {
      var tab = coupons[i].tabName || '';
      if (!groups[tab]) groups[tab] = [];
      groups[tab].push(coupons[i]);
    }
    for (var t in groups) { groups[t].sort(compareFn); }

    var unknownTabs = Object.keys(groups).filter(function (t) { return _TAB_ORDER.indexOf(t) < 0; });
    var slotPlan = _SLOT_PLAN_BASE.concat(unknownTabs.map(function (t) { return [t, 1]; }), [['更多福利', 1]]);

    var used = {};
    var slots = [];

    for (var s = 0; s < slotPlan.length; s++) {
      if (slots.length >= 8) break;
      var slotTab = slotPlan[s][0], quota = slotPlan[s][1];
      var taken = 0;
      var grp = groups[slotTab] || [];
      for (var g = 0; g < grp.length; g++) {
        if (taken >= quota || slots.length >= 8) break;
        slots.push(grp[g]);
        used[slotTab] = (used[slotTab] || 0) + 1;
        taken++;
      }
    }

    var fallbackOrder = ['外卖', '美食团购', '美团闪购', '休闲娱乐', '生活服务', '丽人医疗']
        .concat(unknownTabs, ['更多福利']);
    while (slots.length < 8) {
      var filled = false;
      for (var f = 0; f < fallbackOrder.length; f++) {
        var remaining = (groups[fallbackOrder[f]] || []).slice(used[fallbackOrder[f]] || 0);
        if (remaining.length > 0) {
          slots.push(remaining[0]);
          used[fallbackOrder[f]] = (used[fallbackOrder[f]] || 0) + 1;
          filled = true;
          break;
        }
      }
      if (!filled) break;
    }
    return slots;
  }

  function buildDisplayResult(coupons) {
    return { count_str: buildCountStr(coupons), display_coupons: buildDisplayCoupons(coupons) };
  }

  // ── 发起请求 ──────────────────────────────────────────────
  var config = loadConfig();
  var aiScene = config.aiScene || '';

  var bodyObj = {
    token: token,
    aiScene: aiScene,
    version: 2
  };

  var logEntry = {
    time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    request: {
      url: COUPON_BASE_URL + COUPON_ISSUE_PATH,
      aiScene: aiScene,
      token_masked: token.length > 8 ? token.slice(0, 8) + '****' : token
    }
  };

  httpsPost(COUPON_BASE_URL + COUPON_ISSUE_PATH, bodyObj)
    .then(function (resp) {
      logEntry.response = { http_status: resp.status, body: JSON.stringify(resp.data).slice(0, 500) };

      var respData = resp.data;
      if (!respData) {
        logEntry.result = { success: false, error: 'PARSE_ERROR' };
        writeLog(logEntry, aiScene);
        out({ ok: false, success: false, error: 'PARSE_ERROR', message: 'Invalid response from server' });
        return;
      }

      var code = respData.code;
      var msg = respData.msg || '';
      var data = respData.data || {};

      if (code === 200) {
        var couponList = data.couponList || [];
        var formattedCoupons = couponList.map(formatCoupon);
        var display = buildDisplayResult(formattedCoupons);
        logEntry.result = { success: true, code: 200, coupon_count: formattedCoupons.length };
        writeLog(logEntry, aiScene);
        out({
          ok: true, success: true, code: 200,
          coupon_count: formattedCoupons.length,
          coupons: formattedCoupons,
          count_str: display.count_str,
          display_coupons: display.display_coupons,
          activity_name: data.activityName || '',
          activity_link: data.activityLink || ''
        });
      } else if (code === 1014) {
        logEntry.result = { success: false, code: 1014, error: 'ALREADY_RECEIVED' };
        writeLog(logEntry, aiScene);
        out({
          ok: false, success: false, code: 1014,
          error: 'ALREADY_RECEIVED',
          message: '您今天已经领取过了，每天只能领取一次，明天再来哦～',
          activity_name: data.activityName || '',
          activity_link: data.activityLink || ''
        });
      } else if (code === 401) {
        logEntry.result = { success: false, code: 401, error: 'RE_LOGIN' };
        writeLog(logEntry, aiScene);
        out({ ok: false, success: false, code: 401, error: 'RE_LOGIN', message: '登录已过期，请重新登录' });
      } else if (code === 509 || code === 50200) {
        logEntry.result = { success: false, code: code, error: 'RATE_LIMIT' };
        writeLog(logEntry, aiScene);
        out({ ok: false, success: false, code: code, error: 'RATE_LIMIT', message: '请求过于频繁，请稍后重试' });
      } else if (code === 9999) {
        logEntry.result = { success: false, code: 9999, error: 'SYSTEM_ERROR' };
        writeLog(logEntry, aiScene);
        out({ ok: false, success: false, code: 9999, error: 'SYSTEM_ERROR', message: '系统异常，请稍后重试' });
      } else {
        logEntry.result = { success: false, code: code, error: 'UNKNOWN_ERROR' };
        writeLog(logEntry, aiScene);
        out({ ok: false, success: false, code: code, error: 'UNKNOWN_ERROR', message: '未知错误（code=' + code + '，msg=' + msg + '）' });
      }
    })
    .catch(function (e) {
      logEntry.response = { error: e.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK_ERROR', detail: e.message };
      writeLog(logEntry, aiScene);
      if (e.message === 'TIMEOUT') {
        out({ ok: false, success: false, error: 'TIMEOUT', message: '请求超时，请稍后重试' });
      } else {
        out({ ok: false, success: false, error: 'NETWORK_ERROR', message: '网络异常：' + e.message });
      }
    });
};

/**
 * hotword — 热搜词查询
 * 用法: node run.js hotword --city-id <id>
 */
commands.hotword = function (argv) {
  const { args } = parseArgs(argv || []);
  if (!args['city-id']) fail('MISSING_PARAM', { param: 'city-id' });

  const apiUrl = 'https://peppermall.meituan.com/api/product/search/consumer/hotword?selectCityId=' + encodeURIComponent(args['city-id']);
  httpsGet(apiUrl)
    .then(function (resp) {
      const data = resp.data;
      if (data && data.code === 200) {
        const hotWords = (data.data && data.data.hotWord || []).map(function (item) { return item.word; });
        out({ ok: true, success: true, hotWords: hotWords });
      } else {
        out({ ok: false, success: false, error: 'API_ERROR', code: data && data.code, message: (data && data.message) || '热搜词获取失败' });
      }
    })
    .catch(function (e) {
      out({ ok: false, success: false, error: e.message });
    });
};

/**
 * search — 商品搜索
 * 用法: node run.js search --keyword <kw> --lat <lat> --lng <lng> --city-id <id>
 *        [--page N] [--page-size N] [--query-id Q] [--request-id R] [--max-distance-km D]
 *
 * Token 从 pt-passport 缓存自动读取，不通过命令行传递。
 * 直接用 Node.js https 发请求，避免 Windows Python SSL 兼容问题。
 */
commands.search = function (argv) {
  const { args } = parseArgs(argv || []);
  const required = ['keyword', 'lat', 'lng', 'city-id'];
  for (const r of required) {
    if (!args[r]) fail('MISSING_PARAM', { param: r });
  }
  const token = getCachedToken();
  if (!token) fail('NO_TOKEN', { message: '未登录或 Token 已过期，请先登录' });

  const page = parseInt(args['page'] || '1', 10);
  const pageSize = parseInt(args['page-size'] || '10', 10);
  const maxDistanceKm = parseFloat(args['max-distance-km'] || '8');

  const body = {
    keyword: args['keyword'],
    page: page,
    pageSize: String(pageSize),
    clientSource: 'coupon-fusion-workbuddy',
    userParamDTO: {
      lat: args['lat'],
      lng: args['lng'],
      token: token,
      cityId: args['city-id'],
      app: 216,
      platform: 1,
      partner: 1018
    }
  };
  if (args['query-id']) body.queryId = args['query-id'];
  if (args['request-id']) body.requestId = args['request-id'];

  const apiUrl = 'https://click.meituan.com/cps/ai/product/searchProductByAgent';
  httpsPost(apiUrl, body, { token: token })
    .then(function (resp) {
      const data = resp.data;
      if (data && data.code === 200 && data.success) {
        const dataBlock = data.data || {};
        var productList = (dataBlock.productList || []).map(function (item) {
          if (item.productId) item.productId = String(item.productId);
          if (item.poiId) item.poiId = String(item.poiId);
          return item;
        });
        // 按距离过滤
        productList = productList.filter(function (item) {
          var dt = (item.distanceText || '').trim().toLowerCase();
          var km = 999;
          if (dt.endsWith('km')) km = parseFloat(dt.slice(0, -2));
          else if (dt.endsWith('m')) km = parseFloat(dt.slice(0, -1)) / 1000;
          return km <= maxDistanceKm;
        });
        // 重新编号
        productList.forEach(function (item, idx) { item.index = idx + 1; });
        out({
          ok: true, success: true,
          productList: productList,
          isLastPage: !!dataBlock.isLastPage,
          queryId: String(dataBlock.queryId || ''),
          requestId: String(dataBlock.requestId || ''),
          page: page,
          pageSize: pageSize
        });
      } else {
        out({ ok: false, success: false, error: 'API_ERROR', code: data && data.code, message: (data && data.message) || '搜索失败' });
      }
    })
    .catch(function (e) {
      out({ ok: false, success: false, error: e.message });
    });
};

/**
 * location — 获取用户近期位置
 * 用法: node run.js location
 *
 * Token 从 pt-passport 缓存自动读取，不通过命令行传递。
 * 直接用 Node.js https 发请求，避免 Windows Python SSL 兼容问题。
 */
commands.location = function (argv) {
  const token = getCachedToken();
  if (!token) fail('NO_TOKEN', { message: '未登录或 Token 已过期，请先登录' });

  const apiUrl = 'https://click.meituan.com/cps/ai/product/getUserRecentLocation';
  httpsPost(apiUrl, { token: token }, { token: token })
    .then(function (resp) {
      const data = resp.data;
      if (data && data.code === 200 && data.success) {
        const loc = data.data || {};
        out({
          ok: true,
          success: true,
          cityId: loc.cityId,
          cityName: loc.cityName,
          lng: loc.lng,
          lat: loc.lat,
          formattedAddress: loc.formattedAddress
        });
      } else {
        out({
          ok: false,
          success: false,
          error: (data && data.message) || '未知错误',
          code: data && data.code
        });
      }
    })
    .catch(function (e) {
      out({ ok: false, success: false, error: e.message });
    });
};

/**
 * location-by-address — 根据地址获取经纬度
 * 用法: node run.js location-by-address --address <addr>
 * 直接用 Node.js https 发请求，避免 Windows Python SSL 兼容问题。
 */
commands['location-by-address'] = function (argv) {
  const { args } = parseArgs(argv || []);
  if (!args['address']) fail('MISSING_PARAM', { param: 'address' });

  const apiUrl = 'https://click.meituan.com/cps/ai/product/getLocationByAddress';
  httpsPost(apiUrl, { address: args['address'] })
    .then(function (resp) {
      const data = resp.data;
      if (data && data.code === 200 && data.success) {
        const loc = data.data || {};
        out({ ok: true, success: true, cityId: loc.cityId, lng: loc.lng, lat: loc.lat });
      } else {
        out({ ok: false, success: false, error: (data && data.message) || '未知错误', code: data && data.code });
      }
    })
    .catch(function (e) {
      out({ ok: false, success: false, error: e.message });
    });
};

/**
 * order — 下单
 * 用法: node run.js order --product-id <pid> --poi-id <pid> --city-id <id> --uuid <u>
 *        [--lat <lat>] [--lng <lng>] [--quantity N]
 *
 * Token 从 pt-passport 缓存自动读取，不通过命令行传递。
 * clientType 内部自动判断。
 * 直接用 Node.js https 发请求，避免 Windows Python SSL 兼容问题。
 */
commands.order = function (argv) {
  const { args } = parseArgs(argv || []);
  const required = ['product-id', 'poi-id', 'city-id', 'uuid'];
  for (const r of required) {
    if (!args[r]) fail('MISSING_PARAM', { param: r });
  }
  const token = getCachedToken();
  if (!token) fail('NO_TOKEN', { message: '未登录或 Token 已过期，请先登录' });

  // 内部自行判断客户端类型
  var clientType = (function () {
    var envType = (process.env.WORKBUDDY_CLIENT_TYPE || '').toLowerCase();
    if (envType === 'mac' || envType === 'windows' || envType === 'miniprogram') return envType;
    if (envType === 'pc') return process.platform === 'darwin' ? 'mac' : 'windows';
    if (process.platform === 'darwin') return 'mac';
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'linux') return 'miniprogram';
    return 'pc';
  })();

  const body = {
    productId: String(args['product-id']),
    poiId: String(args['poi-id']),
    quantity: parseInt(args['quantity'] || '1', 10),
    clientSource: 'coupon-fusion-workbuddy',
    clientType: clientType,
    userParamDTO: {
      token: token,
      cityId: args['city-id'],
      uuid: args['uuid'],
      lat: args['lat'] || '',
      lng: args['lng'] || '',
      app: 216,
      platform: 1,
      partner: 1018
    }
  };

  const apiUrl = 'https://click.meituan.com/cps/ai/product/orderByAgent';
  httpsPost(apiUrl, body, { token: token })
    .then(function (resp) {
      const data = resp.data;
      if (data && data.code === 200 && data.success) {
        const dataBlock = data.data || {};
        out({
          ok: true, success: true,
          orderId: String(dataBlock.orderId || ''),
          payShortLink: dataBlock.payShortLink || '',
          payQrCodeImage: dataBlock.payUrlQrCode || '',
          'WeixinPay-Required': dataBlock.wxPaymentCode || ''
        });
      } else {
        out({ ok: false, success: false, error: 'API_ERROR', code: data && data.code, message: (data && data.message) || '下单失败' });
      }
    })
    .catch(function (e) {
      out({ ok: false, success: false, error: e.message });
    });
};

/**
 * check-login — 检查美团微信小程序登录状态
 * 用法: node run.js check-login
 *
 * Token 从 pt-passport 缓存自动读取，不通过命令行传递。
 * 直接用 Node.js https 发请求，避免 Windows Python SSL 兼容问题。
 */
commands['check-login'] = function () {
  const token = getCachedToken();
  if (!token) fail('NO_TOKEN', { message: '未登录或 Token 已过期，请先登录' });

  const apiUrl = 'https://click.meituan.com/cps/ai/product/checkLoginMtMiniProgram';
  const body = {
    clientSource: 'coupon-fusion-workbuddy',
    userParamDTO: { token: token }
  };
  httpsPost(apiUrl, body)
    .then(function (resp) {
      const data = resp.data;
      if (data && data.code === 200 && data.success) {
        out({ ok: true, success: true, logged: !!data.data });
      } else {
        out({ ok: false, success: false, error: 'API_ERROR', code: data && data.code, message: (data && data.message) || '校验失败' });
      }
    })
    .catch(function (e) {
      out({ ok: false, success: false, error: e.message });
    });
};

/**
* logout — 退出登录
* 直接通过 runPassport 清除 pt-passport CLI 缓存（避免 Python 找不到 pt-passport 的 PATH 问题）
*/
commands.logout = function () {
var cli_cleared = false;
try {
  var res = runPassport(['logout', '--client_id', CLIENT_ID]);
  cli_cleared = true;
} catch (e) {
  cli_cleared = false;
}
out({ ok: true, success: true, message: '已退出登录，下次需重新授权', device_token_preserved: true, cli_cache_cleared: cli_cleared });
};

/**
* clear-device-token — 清除设备标识
* 清除 device_token 并清除 pt-passport CLI 缓存
*/
commands['clear-device-token'] = function () {
// 先清除 pt-passport CLI 缓存
try { runPassport(['logout', '--client_id', CLIENT_ID]); } catch (e) {}
// 再清除本地 device_token（通过 auth.py）
var result = runPython('auth.py', ['clear-device-token']);
out(Object.assign({ ok: !!result.success }, result));
};

// ── 入口 ─────────────────────────────────────────────────────

const allArgs = process.argv.slice(2);
const command = allArgs[0];
const commandArgs = allArgs.slice(1);

if (!command || command === '--help' || command === '-h') {
  console.log(`Usage: node run.js <command> [options]

Commands:
  init                          Environment setup
  get-device-token              Get device token
  get-token [--env test|prod]   Get cached user token
  auth-get-code [--env test|prod]  Get auth link
  auth-poll-token               Poll auth result
  qrcode <url>                  Get QR code image URL (server-side)
  issue                         Issue coupons
  hotword --city-id <id>        Hot search words
  search --keyword <kw> --lat <lat> --lng <lng> --city-id <id>
  location                      Get recent location
  location-by-address --address <addr>  Get location by address
  order --product-id <pid> --poi-id <pid> --city-id <id> --uuid <u>
  check-login                   Check WeChat mini-program login status
  logout                        Logout
  clear-device-token            Clear device token`);
  process.exit(0);
}

if (!commands[command]) {
  fail('UNKNOWN_COMMAND', { command, available: Object.keys(commands) });
}

commands[command](commandArgs);
