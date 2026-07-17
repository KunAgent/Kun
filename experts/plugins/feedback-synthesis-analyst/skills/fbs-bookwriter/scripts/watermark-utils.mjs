const WATERMARK_MARKER = 'data-fbs-preview-watermark';
const WATERMARK_STYLE_ID = 'fbs-preview-watermark-style';

export function createWatermarkLogoDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="福帮手 logo">
      <defs>
        <clipPath id="fbs-logo-top-stripes">
          <polygon points="68,30 105,12 105,57 70,77" />
        </clipPath>
        <clipPath id="fbs-logo-bottom-stripes">
          <polygon points="67,67 90,78 90,104 67,92" />
        </clipPath>
      </defs>
      <polygon points="27,28 59,42 56,71 27,56" fill="#1f67ca" />
      <polygon points="17,73 57,50 54,84 17,105" fill="#1da1e6" />
      <g clip-path="url(#fbs-logo-top-stripes)">
        <rect width="120" height="120" fill="#eff8ff" />
        <g stroke="#10a8f5" stroke-width="6">
          <line x1="53" y1="82" x2="113" y2="44" />
          <line x1="51" y1="71" x2="111" y2="33" />
          <line x1="49" y1="60" x2="109" y2="22" />
          <line x1="47" y1="49" x2="107" y2="11" />
          <line x1="45" y1="38" x2="105" y2="0" />
          <line x1="58" y1="90" x2="118" y2="52" />
          <line x1="62" y1="100" x2="122" y2="62" />
        </g>
      </g>
      <g clip-path="url(#fbs-logo-bottom-stripes)">
        <rect width="120" height="120" fill="#eff8ff" />
        <g stroke="#2ac7ee" stroke-width="5.5">
          <line x1="56" y1="91" x2="98" y2="79" />
          <line x1="56" y1="82" x2="98" y2="70" />
          <line x1="56" y1="73" x2="98" y2="61" />
          <line x1="56" y1="64" x2="98" y2="52" />
          <line x1="56" y1="55" x2="98" y2="43" />
        </g>
      </g>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildWatermarkStyle() {
  return `<style id="${WATERMARK_STYLE_ID}">
    [${WATERMARK_MARKER}="true"] {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483646;
      pointer-events: none;
      user-select: none;
      font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    }
    [${WATERMARK_MARKER}="true"] [data-fbs-preview-watermark-badge="true"] {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.78);
      box-shadow: 0 8px 24px rgba(15,58,110,0.12);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      opacity: 0.56;
    }
    [${WATERMARK_MARKER}="true"] [data-fbs-preview-watermark-badge="true"] img {
      width: 28px;
      height: 28px;
      object-fit: contain;
      flex: 0 0 auto;
    }
    [${WATERMARK_MARKER}="true"] [data-fbs-preview-watermark-badge="true"] span {
      color: #0f67ca;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.18em;
      white-space: nowrap;
    }
    @media (max-width: 640px) {
      [${WATERMARK_MARKER}="true"] {
        right: 12px;
        bottom: 12px;
      }
      [${WATERMARK_MARKER}="true"] [data-fbs-preview-watermark-badge="true"] {
        gap: 6px;
        padding: 7px 10px;
      }
      [${WATERMARK_MARKER}="true"] [data-fbs-preview-watermark-badge="true"] img {
        width: 24px;
        height: 24px;
      }
      [${WATERMARK_MARKER}="true"] [data-fbs-preview-watermark-badge="true"] span {
        font-size: 12px;
      }
    }
  </style>`;
}

export function buildWatermarkMarkup() {
  return `<div ${WATERMARK_MARKER}="true" aria-hidden="true"><div data-fbs-preview-watermark-badge="true"><img src="${createWatermarkLogoDataUrl()}" alt="" /><span>福帮手</span></div></div>`;
}

export function injectPreviewWatermark(html) {
  if (!html || html.includes(WATERMARK_MARKER) || html.includes(WATERMARK_STYLE_ID)) {
    return html;
  }
  const styleBlock = buildWatermarkStyle();
  const watermark = buildWatermarkMarkup();
  const withStyle = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${styleBlock}</head>`)
    : `${styleBlock}${html}`;
  return /<\/body>/i.test(withStyle)
    ? withStyle.replace(/<\/body>/i, `${watermark}</body>`)
    : `${withStyle}${watermark}`;
}
