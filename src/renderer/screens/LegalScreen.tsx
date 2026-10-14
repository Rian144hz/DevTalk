import { Fragment } from 'react';
import conduct from '../../../docs/legal/code-of-conduct.md?raw';
import privacy from '../../../docs/legal/privacy.md?raw';
import terms from '../../../docs/legal/terms.md?raw';
import { renderMarkdown, type Inline, type MdNode } from '../lib/markdown';
import { returnTo } from '../lib/returnTo';

export type LegalDoc = 'terms' | 'privacy' | 'conduct';

export const LEGAL_TITLES: Record<LegalDoc, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  conduct: 'Code of conduct',
};

const SOURCES: Record<LegalDoc, string> = { terms, privacy, conduct };

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, k) =>
        i.kind === 'text' ? <Fragment key={k}>{i.text}</Fragment>
          : i.kind === 'strong' ? <strong key={k}>{i.text}</strong>
            : <a key={k} href={i.href} {...(i.href.startsWith('https://') ? { target: '_blank', rel: 'noreferrer' } : {})}>{i.text}</a>,
      )}
    </>
  );
}

function Node({ node }: { node: MdNode }) {
  switch (node.kind) {
    case 'h1': return <h1>{node.text}</h1>;
    case 'h2': return <h2>{node.text}</h2>;
    case 'h3': return <h3>{node.text}</h3>;
    case 'p': return <p><Inlines items={node.inlines} /></p>;
    case 'ul': return <ul>{node.items.map((it, k) => <li key={k}><Inlines items={it} /></li>)}</ul>;
    case 'ol': return <ol>{node.items.map((it, k) => <li key={k}><Inlines items={it} /></li>)}</ol>;
  }
}

export function LegalScreen({ doc }: { doc: LegalDoc }) {
  const nodes = renderMarkdown(SOURCES[doc]);
  const back = returnTo();
  return (
    <main className="page legal">
      <a className="back-link" href={back.hash}>{back.label}</a>
      <article className="legal-doc">
        {nodes.map((n, k) => <Node key={k} node={n} />)}
      </article>
    </main>
  );
}
