'use strict';

const stage = document.getElementById('stage');
const navEl = document.getElementById('nav');
const crumbEl = document.getElementById('crumb');
const filterEl = document.getElementById('filter');
const viewSeg = document.getElementById('viewSeg');
const openRaw = document.getElementById('openRaw');
const rootPathEl = document.getElementById('rootPath');

let current = null; // { item, source }

async function init() {
  const res = await fetch('/api/tree');
  const data = await res.json();
  rootPathEl.textContent = data.root;
  renderNav(data.tree);
}

function iconTemplate() {
  // small inline glyph used as default thumb for non-icon items
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

function renderNav(tree) {
  navEl.innerHTML = '';
  tree.forEach((group) => {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.dataset.kind = group.kind;

    const title = document.createElement('div');
    title.className = 'group-title';
    title.innerHTML = '<span>' + group.group + '</span><span class="count">' + group.items.length + '</span>';
    wrap.appendChild(title);

    group.items.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'item';
      btn.dataset.name = item.name.toLowerCase();
      btn.dataset.url = item.url;
      btn.dataset.type = item.type;

      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      thumb.innerHTML = iconTemplate();
      const label = document.createElement('span');
      label.textContent = item.name;
      const tag = document.createElement('span');
      tag.className = 'ico-type';
      tag.textContent = item.type === 'icon-gallery' ? (item.icons ? item.icons.length + ' svg' : 'gallery') : item.type;

      btn.appendChild(thumb);
      btn.appendChild(label);
      btn.appendChild(tag);
      btn.addEventListener('click', () => select(item, btn));
      wrap.appendChild(btn);
    });

    navEl.appendChild(wrap);
  });
}

function setActive(btn) {
  document.querySelectorAll('.item.active').forEach((e) => e.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function select(item, btn) {
  setActive(btn);
  current = { item, view: 'render' };
  crumbEl.innerHTML = '<b>' + escapeHtml(item.name) + '</b> &nbsp;·&nbsp; ' + item.url;
  const isGallery = item.type === 'icon-gallery';
  openRaw.hidden = isGallery;
  openRaw.href = item.url;

  // view toggle only meaningful for html/css/md
  const toggleable = item.type === 'html' || item.type === 'css' || item.type === 'md';
  viewSeg.hidden = !toggleable;
  resetSeg();

  await render();
}

function resetSeg() {
  viewSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === current.view));
}

viewSeg.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    if (!current) return;
    current.view = b.dataset.view;
    resetSeg();
    render();
  });
});

async function render() {
  const { item, view } = current;
  stage.innerHTML = '';

  if (item.type === 'icon-gallery') {
    stage.appendChild(await renderIconGallery(item.icons || []));
    return;
  }

  if (item.type === 'icon') {
    const svg = await (await fetch(item.url)).text();
    stage.appendChild(renderIconDetail(svg));
    return;
  }

  if (item.type === 'html') {
    if (view === 'source') {
      stage.appendChild(await renderSource(item.url));
    } else {
      const frame = document.createElement('iframe');
      frame.className = 'frame';
      frame.src = item.url;
      stage.appendChild(frame);
    }
    return;
  }

  if (item.type === 'css') {
    if (view === 'source') {
      stage.appendChild(await renderSource(item.url));
    } else {
      stage.appendChild(await renderTokenEditor());
    }
    return;
  }

  if (item.type === 'md') {
    const text = await (await fetch('/api/raw?path=' + encodeURIComponent(item.url))).text();
    if (view === 'source') {
      const pre = document.createElement('pre');
      pre.className = 'code';
      pre.textContent = text;
      stage.appendChild(pre);
    } else {
      const div = document.createElement('div');
      div.className = 'md';
      div.innerHTML = renderMarkdown(text);
      stage.appendChild(div);
    }
    return;
  }
}

async function renderSource(url) {
  const text = await (await fetch('/api/raw?path=' + encodeURIComponent(url))).text();
  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.textContent = text;
  return pre;
}

/* ---- colors_and_type.css visual token editor ---- */
async function renderTokenEditor() {
  const wrap = document.createElement('div');
  wrap.className = 'token-editor';

  const data = await (await fetch('/api/tokens')).json();
  const blocks = data.blocks || [];

  const bar = document.createElement('div');
  bar.className = 'token-bar';
  bar.innerHTML =
    '<span class="kicker">colors_and_type.css · 可视化编辑</span>' +
    '<div class="token-bar-actions">' +
      '<span class="token-status" id="tokenStatus"></span>' +
      '<button class="token-save" id="tokenSave">保存到文件</button>' +
    '</div>';
  wrap.appendChild(bar);

  const body = document.createElement('div');
  body.className = 'token-body';
  wrap.appendChild(body);

  let dragSrc = null; // { block, group, row }

  blocks.forEach((block) => {
    const blockEl = document.createElement('section');
    blockEl.className = 'token-block';
    const head = document.createElement('div');
    head.className = 'token-block-head';
    head.innerHTML = '<code>' + escapeHtml(block.selector) + '</code>' +
      '<span class="token-block-tag">' + (block.selector === '.dark' ? '暗色' : '默认') + '</span>';
    blockEl.appendChild(head);

    // Group tokens by their comment group, preserving order.
    const groups = [];
    let cur = null;
    block.tokens.forEach((t) => {
      if (!cur || cur.name !== (t.group || '')) {
        cur = { name: t.group || '', tokens: [] };
        groups.push(cur);
      }
      cur.tokens.push(t);
    });

    groups.forEach((group) => {
      // Group titles may annotate a default token, e.g.
      // "tk-red scale · 默认 --tk-red-500 = #FE2C55" — extract it to badge that row.
      const defMatch = group.name.match(/默认\s+(--[\w-]+)/);
      const defaultName = defMatch ? defMatch[1] : null;
      if (group.name) {
        const gt = document.createElement('div');
        gt.className = 'token-group-title';
        gt.textContent = group.name;
        blockEl.appendChild(gt);
      }
      const list = document.createElement('div');
      list.className = 'token-list';
      list.dataset.group = group.name;

      group.tokens.forEach((t) => {
        const row = document.createElement('div');
        row.className = 'token-row';
        row.draggable = true;
        row._token = t;

        const handle = document.createElement('span');
        handle.className = 'token-handle';
        handle.textContent = '⠿';

        const swatch = document.createElement('span');
        swatch.className = 'token-swatch';
        if (t.isColor) {
          swatch.style.background = t.value;
          const picker = document.createElement('input');
          picker.type = 'color';
          picker.className = 'token-picker';
          // color input needs a hex; only set when value is a plain hex
          if (/^#([0-9a-f]{6})$/i.test(t.value)) picker.value = t.value;
          picker.addEventListener('input', () => {
            t.value = picker.value.toUpperCase();
            swatch.style.background = t.value;
            valInput.value = t.value;
            markDirty();
          });
          swatch.appendChild(picker);
        } else {
          swatch.classList.add('non-color');
        }

        const name = document.createElement('code');
        name.className = 'token-name';
        name.textContent = t.name;

        const valInput = document.createElement('input');
        valInput.className = 'token-value';
        valInput.value = t.value;
        valInput.spellcheck = false;
        valInput.addEventListener('input', () => {
          t.value = valInput.value;
          if (t.isColor) swatch.style.background = t.value;
          if (t.isColor && /^#([0-9a-f]{6})$/i.test(t.value)) {
            const p = swatch.querySelector('.token-picker');
            if (p) p.value = t.value;
          }
          markDirty();
        });

        row.appendChild(handle);
        row.appendChild(swatch);
        row.appendChild(name);
        row.appendChild(valInput);

        if (defaultName && t.name === defaultName) {
          row.classList.add('is-default');
          const badge = document.createElement('span');
          badge.className = 'token-default-badge';
          badge.textContent = '默认';
          badge.title = '该组默认色';
          row.appendChild(badge);
        }

        row.addEventListener('dragstart', () => {
          dragSrc = { list, row, token: t };
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          dragSrc = null;
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!dragSrc || dragSrc.list !== list || dragSrc.row === row) return;
          const rect = row.getBoundingClientRect();
          const after = e.clientY > rect.top + rect.height / 2;
          list.insertBefore(dragSrc.row, after ? row.nextSibling : row);
        });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          reorderModel(block, group, list);
          markDirty();
        });

        list.appendChild(row);
      });

      blockEl.appendChild(list);
    });

    body.appendChild(blockEl);
  });

  // Rebuild this group's token order in the model from the DOM, then rebuild
  // the block's flat token list so serialization keeps group structure.
  function reorderModel() {
    blocks.forEach((block) => {
      const newTokens = [];
      blockBody(block).forEach((list) => {
        list.querySelectorAll('.token-row').forEach((r) => newTokens.push(r._token));
      });
      block.tokens = newTokens;
    });
  }
  function blockBody(block) {
    // collect lists belonging to this block in DOM order
    const sectionEls = body.querySelectorAll('.token-block');
    const idx = blocks.indexOf(block);
    const sec = sectionEls[idx];
    return sec ? sec.querySelectorAll('.token-list') : [];
  }

  const statusEl = bar.querySelector('#tokenStatus');
  const saveBtn = bar.querySelector('#tokenSave');
  function markDirty() {
    statusEl.textContent = '未保存的改动';
    statusEl.className = 'token-status dirty';
  }
  saveBtn.addEventListener('click', async () => {
    reorderModel();
    const payload = {
      blocks: blocks.map((b) => ({
        selector: b.selector,
        tokens: b.tokens.map((t) => ({ name: t.name, value: t.value, group: t.group })),
      })),
    };
    saveBtn.disabled = true;
    statusEl.textContent = '保存中…';
    statusEl.className = 'token-status';
    try {
      const r = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error();
      statusEl.textContent = '已保存到 colors_and_type.css';
      statusEl.className = 'token-status saved';
    } catch (e) {
      statusEl.textContent = '保存失败';
      statusEl.className = 'token-status dirty';
    } finally {
      saveBtn.disabled = false;
    }
  });

  return wrap;
}

function renderIconDetail(svg) {
  const wrap = document.createElement('div');
  wrap.className = 'icon-detail';

  const canvas = document.createElement('div');
  canvas.className = 'icon-canvas';
  const swatches = document.createElement('div');
  swatches.className = 'icon-swatches';
  swatches.innerHTML =
    '<div class="sw on-cyan"><div class="box">' + svg + '</div><small>--tk-cyan-400</small></div>' +
    '<div class="sw on-red"><div class="box">' + svg + '</div><small>--tk-red-500</small></div>' +
    '<div class="sw on-dark"><div class="box">' + svg + '</div><small>on #161823</small></div>' +
    '<div class="sw on-light"><div class="box">' + svg + '</div><small>on #FAFAFA</small></div>';
  canvas.appendChild(swatches);

  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.textContent = svg.trim();

  wrap.appendChild(canvas);
  wrap.appendChild(pre);
  return wrap;
}

async function renderIconGallery(icons) {
  const wrap = document.createElement('div');
  wrap.className = 'icon-gallery';

  const bar = document.createElement('div');
  bar.className = 'gallery-bar';
  bar.innerHTML =
    '<span class="kicker">Icon Library · ' + icons.length + '</span>' +
    '<div class="gallery-tools">' +
      '<input class="gallery-filter" type="search" placeholder="过滤图标…">' +
      '<div class="gallery-bg-seg">' +
        '<button data-bg="dark" class="active">深底</button>' +
        '<button data-bg="light">浅底</button>' +
      '</div>' +
    '</div>';
  wrap.appendChild(bar);

  const grid = document.createElement('div');
  grid.className = 'gallery-grid bg-dark';
  wrap.appendChild(grid);

  // fetch all svgs in parallel and inline them
  const svgs = await Promise.all(icons.map((ic) =>
    fetch(ic.url).then((r) => r.text()).catch(() => '')
  ));

  icons.forEach((ic, i) => {
    const cell = document.createElement('div');
    cell.className = 'gallery-cell';
    cell.dataset.name = ic.name.toLowerCase();
    cell.title = '点击复制文件名';
    const glyph = document.createElement('div');
    glyph.className = 'gallery-glyph';
    glyph.innerHTML = svgs[i];
    const cap = document.createElement('div');
    cap.className = 'gallery-cap';
    cap.textContent = ic.name.replace(/\.svg$/, '');
    cell.appendChild(glyph);
    cell.appendChild(cap);
    cell.addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(ic.name);
      cap.textContent = '已复制';
      setTimeout(() => { cap.textContent = ic.name.replace(/\.svg$/, ''); }, 900);
    });
    grid.appendChild(cell);
  });

  bar.querySelector('.gallery-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    grid.querySelectorAll('.gallery-cell').forEach((c) => {
      c.style.display = !q || c.dataset.name.includes(q) ? '' : 'none';
    });
  });
  bar.querySelectorAll('.gallery-bg-seg button').forEach((b) => {
    b.addEventListener('click', () => {
      bar.querySelectorAll('.gallery-bg-seg button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      grid.classList.toggle('bg-dark', b.dataset.bg === 'dark');
      grid.classList.toggle('bg-light', b.dataset.bg === 'light');
    });
  });

  return wrap;
}

/* ---- filter ---- */
filterEl.addEventListener('input', () => {
  const q = filterEl.value.trim().toLowerCase();
  document.querySelectorAll('.group').forEach((group) => {
    let visible = 0;
    group.querySelectorAll('.item').forEach((it) => {
      const match = !q || it.dataset.name.includes(q);
      it.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    group.style.display = visible ? '' : 'none';
  });
});

/* ---- minimal markdown renderer ---- */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function renderMarkdown(md) {
  // strip leading YAML frontmatter
  md = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = md.split('\n');
  let html = '';
  let i = 0;
  let inUl = false, inOl = false;

  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };

  while (i < lines.length) {
    let line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      closeLists();
      let code = '';
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      i++;
      html += '<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
      continue;
    }

    // table (simple): header | --- | rows
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:-|]*$/.test(lines[i + 1])) {
      closeLists();
      const parseRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const headers = parseRow(line);
      i += 2;
      let t = '<table><thead><tr>' + headers.map((h) => '<th>' + renderInline(h) + '</th>').join('') + '</tr></thead><tbody>';
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        const cells = parseRow(lines[i]);
        t += '<tr>' + cells.map((c) => '<td>' + renderInline(c) + '</td>').join('') + '</tr>';
        i++;
      }
      t += '</tbody></table>';
      html += t;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); html += '<h' + h[1].length + '>' + renderInline(h[2]) + '</h' + h[1].length + '>'; i++; continue; }

    if (/^\s*>\s?/.test(line)) {
      closeLists();
      let q = '';
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q += lines[i].replace(/^\s*>\s?/, '') + ' '; i++; }
      html += '<blockquote>' + renderInline(q.trim()) + '</blockquote>';
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inUl) { closeLists(); html += '<ul>'; inUl = true; }
      html += '<li>' + renderInline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>';
      i++; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inOl) { closeLists(); html += '<ol>'; inOl = true; }
      html += '<li>' + renderInline(line.replace(/^\s*\d+\.\s+/, '')) + '</li>';
      i++; continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }

    if (line.trim() === '') { closeLists(); i++; continue; }

    closeLists();
    html += '<p>' + renderInline(line) + '</p>';
    i++;
  }
  closeLists();
  return html;
}

init();
