#!/usr/bin/env node
/**
 * Map natural-language descriptions to Tencent Cloud products via HTTP MCP.
 * JS rewrite of tencent_cloud_product_map.py — uses native fetch (Node 18+)
 * so it works in sandboxes where Python urllib cannot reach internal WOA hosts.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MCP_URL = 'http://portal-mcp-server.woa.com/mcp';
const DEFAULT_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_THRESHOLD = 130.0;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 5.0;

const EDITION_WORDS = [
  '标准版', '高级版', '企业版', '基础版', '专业版', '旗舰版',
  '增强版', '入门版', '免费版', '试用版', '国内版', '国际版',
  '传统型', 'saas型', 'saas 型', 'SaaS型', 'SaaS 型',
];

/**
 * Each rule: [pattern, targetSlug, excludePattern|null]
 * excludePattern: if query also matches this, skip the alias.
 */
const ALIAS_RULES = [
  [/弹性公网\s*IP|\bEIP\b/i,                         'eip',        null],
  [/公网带宽|BGP\s*按带宽|BGP\s*按流量/i,            'bwp',        /弹性公网\s*IP|\bEIP\b/i],
  [/DDoS\s*高防/i,                                    'ddos',       null],
  [/主机安全|CWPP/i,                                  'hs',         null],
  [/数据安全审计|DBAudit/i,                           'CDS',        null],
  [/漏洞扫描|\bVSS\b/i,                               'vgs',        null],
  [/T-Sec\s*态势感知|态势感知/i,                      'ssa',        null],
  [/MySQL\s*云数据库|云数据库\s*MySQL/i,              'cdb',        null],
  [/PostgreSQL/i,                                     'postgres',   null],
  [/SQL\s*Server/i,                                   'sqlserver',  null],
  [/MariaDB/i,                                        'tdsql',      null],
  [/\bRedis\b/i,                                      'tcdc',       null],
  [/MongoDB/i,                                        'mongodb',    null],
  [/TDSQL-C(?!\s*PostgreSQL)|Cloud\s*Native/i,        'cynosdb',    null],
  [/TDSQL\s*分布式|\bDCDB\b/i,                        'dcdb',       null],
  [/TDSQL-A/i,                                        'tchoused',   null],
  [/CDW-PG|Greenplum/i,                               'tchousep',   null],
  [/CDW-DORIS|DORIS/i,                                'tchoused',   null],
  [/CDW-CK|ClickHouse/i,                              'tchousec',   null],
  [/DNSPod|DNS\s*解析/i,                              'dns',        null],
  [/FaceID|人脸识别.*活体/i,                          'faceid',     null],
  [/北极星|注册中心/i,                                'tse',        null],
  [/持续部署|CICD|制品管理|XRepo/i,                   'coding',     null],
  [/Hunyuan-|腾讯混元|混元/i,                         'hunyuan',    null],
  [/DeepSeek|Kimi|GLM|MiniMax/i,                      'tokenhub',   null],
  [/大模型知识引擎|\bLKE\b/i,                         'lkeap',      null],
];

const UNSUPPORTED_PATTERNS = [
  /服务网格|\bTCM\b/i,
  /工作流\s*ASW|\bASW\b/i,
  /蓝盾流水线|蓝盾/i,
  /图数据库|KonisGraph/i,
  /语音通话|VoIP/i,
  /车联网|TCIP/i,
  /NLP\s*工具包|自然语言处理/i,
];

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalize(value) {
  // NFKC-like: replace common full-width chars, lowercase
  let v = value.normalize('NFKC').toLowerCase();
  // strip HTML entities naively
  v = v.replace(/&[a-z]+;/gi, '');
  // strip tags
  v = v.replace(/<[^>]+>/g, '');
  // strip separators/punctuation
  v = v.replace(/[\s\-_·/\\|,，.。:：;；()（）[\]【】{}<>《》'"'"'"]+/g, '');
  return v;
}

function slugMatchesQuery(slug, query) {
  const nSlug = normalize(slug);
  if (nSlug.length < 2) return false;
  const asciiTokens = [...query.matchAll(/[A-Za-z][A-Za-z0-9+_.-]*/g)].map(m => normalize(m[0]));
  if (asciiTokens.includes(nSlug)) return true;
  return nSlug.length >= 4 && normalize(query).includes(nSlug);
}

// ─── Product catalogue helpers ────────────────────────────────────────────────

function buildLookup(products) {
  const lookup = new Map();
  for (const p of products) {
    lookup.set(normalize(p.name), p);
    if (p.slug) lookup.set(normalize(p.slug), p);
  }
  return lookup;
}

function resolveProduct(target, lookup) {
  return lookup.get(normalize(target)) ?? null;
}

function aliasProduct(query, lookup) {
  for (const [pattern, target, exclude] of ALIAS_RULES) {
    if (!pattern.test(query)) continue;
    if (exclude && exclude.test(query)) continue;
    const product = resolveProduct(target, lookup);
    if (product) return { product, pattern: pattern.toString() };
  }
  return null;
}

function hasUnsupportedPattern(query) {
  for (const pat of UNSUPPORTED_PATTERNS) {
    if (pat.test(query)) return pat.toString();
  }
  return null;
}

function directProduct(query, products) {
  const nq = normalize(query);
  let best = null;
  for (const p of products) {
    const np = normalize(p.name);
    let score = 0;
    const reasons = [];
    if (np && nq.includes(np)) {
      score += 120 + Math.min(np.length, 20);
      reasons.push('product-name-contained-in-query');
    } else if (nq && np.includes(nq)) {
      score += 80;
      reasons.push('query-contained-in-product-name');
    }
    if (slugMatchesQuery(p.slug, query)) {
      score += 90;
      reasons.push('product-slug-contained-in-query');
    }
    if (score && (!best || score > best.score)) {
      best = { product: p, reasons, score };
    }
  }
  return best;
}

// ─── Query variant generation ─────────────────────────────────────────────────

function queryVariants(query) {
  const variants = [];
  const add = (v) => {
    v = v.replace(/\s+/g, ' ').trim();
    if (v && !variants.includes(v)) variants.push(v);
  };
  add(query);
  let stripped = query;
  for (const w of EDITION_WORDS) stripped = stripped.replaceAll(w, ' ');
  add(stripped);
  const chineseParts = [...stripped.matchAll(/[一-鿿]{2,}/g)].map(m => m[0]);
  if (chineseParts.length) {
    add(chineseParts.join(' '));
    add(chineseParts.reduce((a, b) => (a.length >= b.length ? a : b), ''));
  }
  const asciiParts = [...stripped.matchAll(/[A-Za-z][A-Za-z0-9+_.-]{1,}/g)].map(m => m[0]);
  for (const p of asciiParts.slice(0, 2)) add(p);
  return variants.slice(0, 5);
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function resultForProduct(query, product, confidence, reasons, explain) {
  return {
    query,
    found: true,
    name: product.name,
    slug: product.slug,
    product_id: product.product_id,
    confidence: Math.round(confidence * 10) / 10,
    searched: [],
    candidates: explain
      ? [{ name: product.name, slug: product.slug, product_id: product.product_id, score: Math.round(confidence * 10) / 10, reasons }]
      : [],
  };
}

function notFoundResult(query, explain, reason = '', searched = [], candidates = []) {
  const debugCandidates = [...candidates];
  if (explain && reason) debugCandidates.unshift({ reason });
  return {
    query,
    found: false,
    name: query,
    slug: '',
    product_id: null,
    confidence: 0.0,
    searched: explain ? searched : [],
    candidates: explain ? debugCandidates : [],
  };
}

function candidateDebug(candidates) {
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(item => ({
      name: item.product.name,
      slug: item.product.slug,
      product_id: item.product.product_id,
      score: Math.round(item.score * 10) / 10,
      reasons: item.reasons.slice(0, 8),
    }));
}

function formatResult(result, field) {
  if (field === 'json') return JSON.stringify(result);
  if (!result.found) return String(result.query ?? result.name ?? '');
  if (field === 'name') return String(result.name ?? result.query ?? '');
  if (field === 'slug') return String(result.slug ?? result.query ?? '');
  if (field === 'both') {
    const slug = result.slug ?? '';
    return `${result.name}\t${slug}`.trimEnd();
  }
  throw new Error(`unsupported field: ${field}`);
}

// ─── MCP HTTP client ──────────────────────────────────────────────────────────

class McpError extends Error {}
class McpNetworkError extends McpError {}

class PortalMcpClient {
  constructor(url, timeout, retries = DEFAULT_RETRIES, retryDelay = DEFAULT_RETRY_DELAY) {
    this.url = url;
    this.timeout = timeout * 1000; // ms
    this.retries = Math.max(0, retries);
    this.retryDelay = Math.max(0, retryDelay) * 1000;
    this.sessionId = null;
    this.nextId = 1;
  }

  _id() { return this.nextId++; }

  async _post(payload) {
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      try {
        const resp = await fetch(this.url, { method: 'POST', headers, body, signal: ctrl.signal });
        clearTimeout(timer);
        const text = await resp.text();
        const parsed = this._parse(text);
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          throw new McpError(JSON.stringify(parsed.error));
        }
        return { headers: resp.headers, body: parsed ?? {} };
      } catch (err) {
        clearTimeout(timer);
        const isNetwork = err.name === 'AbortError' || err.name === 'TypeError' || err instanceof McpNetworkError;
        if (!isNetwork || attempt >= this.retries) {
          if (isNetwork) throw new McpNetworkError(err.message);
          throw err;
        }
        process.stderr.write(
          `[tencent-cloud-product-mapping] network error: ${err.message}; ` +
          `retrying in ${this.retryDelay / 1000 | 0}s (attempt ${attempt + 1}/${this.retries})\n`
        );
        await new Promise(r => setTimeout(r, this.retryDelay));
      }
    }
    throw new McpNetworkError('exhausted retries without a response');
  }

  /** Handle both plain JSON and SSE (data: {...}) responses. */
  _parse(text) {
    text = text.trim();
    if (!text) return {};
    // SSE: each event line starts with "data: "
    if (text.startsWith('data:') || text.includes('\ndata:')) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const json = line.slice(5).trim();
          if (json) {
            try { return JSON.parse(json); } catch { /* skip non-JSON data lines */ }
          }
        }
      }
      return {};
    }
    try { return JSON.parse(text); } catch { return {}; }
  }

  async initialize() {
    const payload = {
      jsonrpc: '2.0', id: this._id(), method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'tencent-cloud-product-mapping', version: '0.1.0' },
      },
    };
    const { headers } = await this._post(payload);
    this.sessionId = headers.get('mcp-session-id') ?? headers.get('Mcp-Session-Id') ?? null;
    if (!this.sessionId) throw new McpError('missing Mcp-Session-Id in initialize response');
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async callTool(name, args = {}) {
    const payload = {
      jsonrpc: '2.0', id: this._id(), method: 'tools/call',
      params: { name, arguments: args },
    };
    const { body } = await this._post(payload);
    const result = body.result;
    if (!result || typeof result !== 'object') throw new McpError(`invalid tool result for ${name}`);
    if (result.isError) {
      const text = extractText(result);
      throw new McpError(text || `tool failed: ${name}`);
    }
    const text = extractText(result);
    if (!text) return {};
    try { return JSON.parse(text); } catch (e) { throw new McpError(`tool returned non-json: ${name}`); }
  }
}

function extractText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return '';
  for (const item of content) {
    if (item?.type === 'text' && typeof item.text === 'string') return item.text;
  }
  return '';
}

// ─── Catalogue & search ───────────────────────────────────────────────────────

async function loadProducts(client) {
  const data = await client.callTool('list-document-product', {});
  const products = [];
  for (const item of (data.Products ?? [])) {
    if (typeof item !== 'object') continue;
    const name = String(item.ProductName ?? '').trim();
    if (!name) continue;
    const productId = typeof item.ProductId === 'number' ? item.ProductId : null;
    products.push({ product_id: productId, name, slug: String(item.ProductSlug ?? '').trim() });
  }
  if (!products.length) throw new McpError('product catalog is empty');
  return products;
}

async function search(client, keyword) {
  const data = await client.callTool('search-documents', { Keyword: keyword });
  const results = data.SearchResults;
  return Array.isArray(results) ? results : [];
}

// ─── Core mapping ─────────────────────────────────────────────────────────────

function extractProductId(url) {
  const m = url.match(/\/product\/(\d+)(?:\/|$)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return isNaN(n) ? null : n;
}

async function mapOne(client, products, query, threshold, explain) {
  const productByName = new Map(products.map(p => [p.name, p]));
  const productById = new Map(products.filter(p => p.product_id != null).map(p => [p.product_id, p]));
  const lookup = buildLookup(products);

  // 1. alias fast-path
  const alias = aliasProduct(query, lookup);
  if (alias) {
    return resultForProduct(query, alias.product, 5000, [`alias:${alias.pattern}`], explain);
  }

  // 2. direct name/slug match
  const direct = directProduct(query, products);
  if (direct && direct.score >= 120) {
    return resultForProduct(query, direct.product, direct.score, direct.reasons, explain);
  }

  // 3. unsupported patterns
  const unsupported = hasUnsupportedPattern(query);
  if (unsupported) {
    return notFoundResult(query, explain, `unsupported-no-catalog-product:${unsupported}`);
  }

  // 4. search-based scoring
  const candidates = new Map(); // name → {product, score, reasons}
  const getCandidate = (product) => {
    if (!candidates.has(product.name)) candidates.set(product.name, { product, score: 0, reasons: [] });
    return candidates.get(product.name);
  };

  const nq = normalize(query);
  if (direct) {
    const c = getCandidate(direct.product);
    c.score += direct.score;
    c.reasons.push(...direct.reasons);
  }

  const searched = [];
  for (const variant of queryVariants(query)) {
    let results;
    try { results = await search(client, variant); } catch { continue; }
    searched.push(variant);
    const nv = normalize(variant);
    for (let i = 0; i < Math.min(results.length, 20); i++) {
      const r = results[i];
      if (typeof r !== 'object') continue;
      const productName = String(r.ProductName ?? '').trim();
      let product = productByName.get(productName) ?? null;
      if (!product) {
        const pid = extractProductId(String(r.DocumentURL ?? ''));
        if (pid != null) product = productById.get(pid) ?? null;
      }
      if (!product && productName) product = { product_id: null, name: productName, slug: '' };
      if (!product) continue;

      let score = Math.max(6, 55 - i * 3);
      if (normalize(product.name) && nq.includes(normalize(product.name))) score += 45;
      if (slugMatchesQuery(product.slug, query)) score += 35;
      const title = normalize(String(r.DocumentTitle ?? ''));
      const snippet = normalize(String(r.Snippet ?? ''));
      if (nv && (title.includes(nv) || snippet.includes(nv))) score += 8;

      const c = getCandidate(product);
      c.score += score;
      if (explain) c.reasons.push(`search:${variant}:rank:${i + 1}:score:${score.toFixed(1)}`);
    }
  }

  if (!candidates.size) return notFoundResult(query, explain, 'no-candidate', searched);
  const best = [...candidates.values()].reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score < threshold) {
    return notFoundResult(
      query, explain,
      `low-confidence:${best.score.toFixed(1)}<threshold:${threshold.toFixed(1)}`,
      searched, candidateDebug(candidates),
    );
  }
  return {
    query, found: true,
    name: best.product.name, slug: best.product.slug, product_id: best.product.product_id,
    confidence: Math.round(best.score * 10) / 10,
    searched: explain ? searched : [],
    candidates: explain ? candidateDebug(candidates) : [],
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    queries: [],
    field: 'name',
    jsonl: false,
    explain: false,
    threshold: DEFAULT_THRESHOLD,
    timeout: 20,
    retries: DEFAULT_RETRIES,
    retryDelay: DEFAULT_RETRY_DELAY,
    url: process.env.TCLOUD_PRODUCT_MCP_URL ?? DEFAULT_MCP_URL,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--field':      opts.field     = argv[++i] ?? 'name'; break;
      case '--jsonl':      opts.jsonl     = true; break;
      case '--explain':    opts.explain   = true; break;
      case '--threshold':  opts.threshold = parseFloat(argv[++i] ?? String(DEFAULT_THRESHOLD)); break;
      case '--timeout':    opts.timeout   = parseFloat(argv[++i] ?? '20'); break;
      case '--retries':    opts.retries   = parseInt(argv[++i] ?? '2', 10); break;
      case '--retry-delay': opts.retryDelay = parseFloat(argv[++i] ?? String(DEFAULT_RETRY_DELAY)); break;
      case '--url':        opts.url       = argv[++i] ?? opts.url; break;
      default:
        if (!argv[i].startsWith('-')) opts.queries.push(argv[i]);
    }
  }
  return opts;
}

async function collectQueries(opts) {
  if (opts.queries.length) return opts.queries;
  // stdin
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf-8').split('\n').map(l => l.trim()).filter(Boolean);
  }
  return [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const queries = await collectQueries(opts);
  if (!queries.length) process.exit(1);

  const explain = opts.explain || opts.field === 'json' || opts.jsonl;

  try {
    const client = new PortalMcpClient(opts.url, opts.timeout, opts.retries, opts.retryDelay);
    await client.initialize();
    const products = await loadProducts(client);
    for (const query of queries) {
      const result = await mapOne(client, products, query, opts.threshold, explain);
      if (opts.jsonl) {
        process.stdout.write(JSON.stringify(result) + '\n');
      } else {
        process.stdout.write(formatResult(result, opts.field) + '\n');
      }
    }
    process.exit(0);
  } catch (err) {
    if (opts.jsonl || opts.field === 'json') {
      for (const query of queries) {
        const r = notFoundResult(query, explain, `mcp-error:${err.message}`);
        process.stdout.write(JSON.stringify(r) + '\n');
      }
    } else {
      for (const query of queries) process.stdout.write(query + '\n');
    }
    process.exit(2);
  }
}

main();
