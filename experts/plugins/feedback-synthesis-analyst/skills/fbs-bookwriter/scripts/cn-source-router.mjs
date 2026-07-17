#!/usr/bin/env node

/**
 * 中文优先来源路由器（CN-First）
 */
export class CNSourceRouter {
  constructor(options = {}) {
    this.policy = {
      fact: {
        layer: 'A_truth',
        preferredDomains: ['gov.cn', 'people.com.cn', 'xinhuanet.com', 'cctv.com'],
        endpointStrategy: 'direct_fetch_first'
      },
      version: {
        layer: 'A_product_official',
        preferredDomains: ['developers.weixin.qq.com', 'cloud.tencent.com', 'github.com', 'gitee.com'],
        endpointStrategy: 'official_docs_first'
      },
      method: {
        layer: 'B_method',
        preferredDomains: ['36kr.com', 'huxiu.com', 'cloud.tencent.com/developer', 'alibabacloud.com/help/zh'],
        endpointStrategy: 'bing_rss_then_static_page'
      },
      readerLanguage: {
        layer: 'D_language',
        preferredDomains: ['zhihu.com', 'xiaohongshu.com', 'douban.com', 'bilibili.com'],
        endpointStrategy: 'summary_first'
      },
      academic: {
        layer: 'C_learning',
        preferredDomains: ['arxiv.org', 'acm.org', 'ieee.org', 'scholar.google.com'],
        endpointStrategy: 'paper_or_report_first'
      },
      timestamp: {
        layer: 'A_timestamp',
        preferredDomains: ['people.com.cn', 'xinhuanet.com', 'gov.cn'],
        endpointStrategy: 'authority_date_first'
      },
      fallback: {
        layer: 'fallback',
        preferredDomains: ['bing.com', 'baidu.com', 'sogou.com'],
        endpointStrategy: 'bing_rss_zhCN'
      }
    };

    this.jsHeavySites = new Set(['zhihu.com', 'xiaohongshu.com', 'mp.weixin.qq.com']);
    if (Array.isArray(options.jsHeavySites)) {
      options.jsHeavySites.forEach((d) => this.jsHeavySites.add(d));
    }
  }

  classifyIntent(input = {}) {
    const hint = String(input.intentHint || input.taskType || '').toLowerCase();
    const q = String(input.query || input.text || '').toLowerCase();
    const merged = `${hint} ${q}`;

    if (/(今天|日期|年月日|timestamp|time anchor)/.test(merged)) return 'timestamp';
    if (/(政策|规定|标准|监管|fact|事实核查|数据|统计|日期)/.test(merged)) return 'fact';
    if (/(版本|release|changelog|接口|api|更新说明)/.test(merged)) return 'version';
    if (/(论文|学术|研究|白皮书|paper)/.test(merged)) return 'academic';
    if (/(知乎|小红书|微博|豆瓣|语感|读者|评论)/.test(merged)) return 'readerLanguage';
    if (/(方法|最佳实践|strategy|framework|流程)/.test(merged)) return 'method';
    return 'fallback';
  }

  route(input = {}) {
    const intent = this.classifyIntent(input);
    const selected = this.policy[intent] || this.policy.fallback;

    return {
      intent,
      ...selected,
      jsHeavySites: [...this.jsHeavySites],
      shouldUseSummaryFirst: intent === 'readerLanguage',
      querySiteHints: this.buildSiteHints(selected.preferredDomains)
    };
  }

  buildSiteHints(domains = []) {
    return domains.map((d) => `site:${d}`);
  }

  buildSiteScopedQueries(baseQuery, domains = [], max = 2) {
    return domains.slice(0, max).map((d) => `${baseQuery} site:${d}`);
  }
}

export default CNSourceRouter;
