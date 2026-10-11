// Offline inputs for the real chat/title components, rich-editor extensions,
// Work document codec and shared preview/export renderer. No math/CSS mocks.
export const mathCases = {
  inline: String.raw`E=mc^2`,
  greek: String.raw`\alpha + \beta = \gamma`,
  display: String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`,
  matrix: String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`,
  long: Array.from({ length: 24 }, (_, i) => `\\frac{x_{${i + 1}}^2}{1+x_{${i + 1}}}`).join(' + '),
  saved: String.raw`\frac{a^2+b^2}{c^2}=1`,
  canceled: String.raw`\sqrt{\frac{never}{saved}}`,
  malformed: String.raw`\frac{1}{`,
  attacks: [
    String.raw`\href{javascript:window.__mathXss=1}{unsafe}`,
    String.raw`\includegraphics{https://math-smoke.invalid/pixel.png}`,
    String.raw`\htmlClass{math-injected}{unsafe}`,
    String.raw`\htmlStyle{background-image:url(https://math-smoke.invalid/style)}{unsafe}`,
    String.raw`\text{<img src=x onerror=window.__mathXss=1>}`
  ],
  rawAttack: '<script>window.__mathXss=1</script><iframe src="https://math-smoke.invalid/frame"></iframe><a href="javascript:window.__mathXss=1">unsafe</a>'
}

export function workMathMarkdown({ hostile = false, long = true } = {}) {
  const values = [mathCases.display, mathCases.matrix, ...(long ? [mathCases.long] : [])]
  return [
    `Inline $${mathCases.inline}$ and $${mathCases.greek}$ stay in this sentence.`,
    ...values.map(value => `$$\n${value}\n$$`),
    ...(hostile ? [mathCases.rawAttack, ...mathCases.attacks.map(value => `$$\n${value}\n$$`), `$$\n${mathCases.malformed}\n$$`] : [])
  ].join('\n\n')
}

export function mathRenderingFixture() {
  return `
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Editor } from '@tiptap/core';
import { StreamdownAssistant } from '/src/renderer/src/components/chat/StreamdownAssistant';
import { PaperTitleText } from '/src/renderer/src/components/paper/PaperTitleText';
import { buildWriteRichExtensions } from '/src/renderer/src/write/tiptap/markdown-manager';
import { parseWorkDocument, serializeWorkDocument } from '/src/renderer/src/write/markdown/document-codec';
import { renderWorkMarkdownToHtml } from '/src/shared/markdown/render-html';
import '/src/renderer/src/index.css';
import '/src/renderer/src/styles/base-shell.css';
import '/src/renderer/src/styles/markdown-code.css';
import '/src/renderer/src/styles/write-editor.css';
import '/src/renderer/src/styles/write-rich-editor.css';
import '/src/renderer/src/styles/write-rich-blocks.css';
const cases = ${JSON.stringify(mathCases)};
const normalTitle = ${JSON.stringify('A study of $' + mathCases.inline + '$ and \\(' + mathCases.greek + '\\)')};
const normal = ${JSON.stringify(workMathMarkdown())};
const hostile = ${JSON.stringify(workMathMarkdown({ hostile: true }))};
const calls = [];
window.__mathXss = 0;
window.kunGui = { platform: 'fixture', openExternal: async url => { calls.push(url); }, runtimeRequest: async () => { throw Error('Unexpected runtime call in math fixture'); } };
let editor, ctx, current = { hostile: false, streaming: false, chat: null };
const root = createRoot(document.getElementById('root'));
function chatSource() {
  const source = current.hostile ? hostile : normal;
  // Chat intentionally uses double-dollar inline delimiters; single-dollar
  // math is disabled in StreamdownAssistant to preserve currency text.
  return source.replace('Inline $' + cases.inline + '$ and $' + cases.greek + '$',
    () => 'Inline $$' + cases.inline + '$$ and $$' + cases.greek + '$$');
}
function RichMath({ source }) {
  const host = useRef(null);
  useEffect(() => {
    const parsed = parseWorkDocument(source);
    ctx = parsed.ctx;
    editor = new Editor({ element: host.current, extensions: buildWriteRichExtensions(),
      content: parsed.doc, editorProps: { attributes: { class: 'write-rich-editor' } } });
    return () => { editor.destroy(); editor = null; };
  }, [source]);
  return <div className="write-rich-host" style={{ position: 'relative', minWidth: 0 }}><div ref={host}/></div>;
}
function App() {
  const source = current.hostile ? hostile : normal;
  return <main style={{ maxWidth: 1024, margin: '0 auto', padding: 20, color: 'var(--ds-text)', background: 'var(--ds-bg)' }}>
    <h1 style={{ fontSize: 22, marginBottom: 16 }}>Production math rendering</h1>
    <Section id="chat" title="Assistant chat"><StreamdownAssistant className="ds-markdown" text={current.chat ?? chatSource()} streaming={current.streaming}/></Section>
    <Section id="title" title="Paper title"><PaperTitleText title={normalTitle + (current.hostile ? ' $' + [...cases.attacks, cases.malformed].join('$ $') + '$ ' + cases.rawAttack : '')}/></Section>
    <Section id="editor" title="Work rich editor"><RichMath source={source}/></Section>
    <Section id="preview" title="Work Markdown preview"><div className="ds-markdown" dangerouslySetInnerHTML={{ __html: renderWorkMarkdownToHtml(source, { math: 'html' }) }}/></Section>
  </main>;
}
function Section({ id, title, children }) {
  return <section data-surface={id} style={{ minWidth: 0, padding: 16, marginBottom: 16, border: '1px solid var(--ds-border)', borderRadius: 10 }}>
    <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{title}</h2>{children}
  </section>;
}
function render(next = {}) { current = { ...current, ...next }; flushSync(() => root.render(<App/>)); }
window.mathFixture = { ready: true, cases, calls, render, chatSource,
  editorReady: () => !!editor && !editor.isDestroyed,
  editorSelection: () => ({ ...editor.state.selection.toJSON(), focused: editor.isFocused }),
  editorMath: () => { const nodes = []; editor.state.doc.descendants(node => { if (['inlineMath', 'blockMath'].includes(node.type.name)) nodes.push({ kind: node.type.name, latex: node.attrs.latex }); }); return nodes; },
  serialized: () => serializeWorkDocument(editor.getJSON(), ctx),
  setTheme: theme => { document.documentElement.dataset.theme = theme; },
  renderMode: mode => renderWorkMarkdownToHtml(normal, { math: mode })
};
document.documentElement.dataset.theme = 'light';
render();
`
}
