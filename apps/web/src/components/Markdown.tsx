import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Markdown de una nota. No interpreta HTML incrustado; los enlaces externos se abren en otra pestaña. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => (props.href?.startsWith('#/') ? <a {...props} /> : <a {...props} target="_blank" rel="noreferrer" />) }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
