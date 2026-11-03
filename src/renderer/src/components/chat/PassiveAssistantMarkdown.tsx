import { useEffect, type ReactElement } from 'react'
import { loadKatexCopyTex } from '../../lib/katex-copy-tex'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// Paper answers may repeat attacker-controlled source content. Formatting is
// passive: no HTML parsing, images, links, file previews or executable fences.
// Never reuse StreamdownCode / StreamdownLink here: those offer app actions.
const components: Components = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span>{alt}</span>,
  table: ({ children }) => (
    <div className="ds-passive-markdown-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  )
}

export function PassiveAssistantMarkdown({
  text,
  className
}: {
  text: string
  className?: string
}): ReactElement {
  useEffect(() => {
    void loadKatexCopyTex()
  }, [])
  return (
    <div className={['ds-passive-markdown', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        skipHtml
        urlTransform={() => ''}
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[[rehypeKatex, {
          trust: false,
          strict: 'ignore',
          throwOnError: false,
          maxExpand: 1000,
          maxSize: 20,
          errorColor: 'var(--ds-text-muted)'
        }]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
