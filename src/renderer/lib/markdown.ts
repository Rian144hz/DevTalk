// A tiny Markdown subset for the bundled legal documents: headings, paragraphs, lists, **bold** and links.
// It returns data, never HTML, so nothing in a document can inject markup.

export type Inline = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'link'; text: string; href: string };
export type MdNode =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'ul' | 'ol'; items: Inline[][] };

const SAFE_HREF = /^(https:\/\/|mailto:|#\/)/;
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'strong', text: m[1] });
    else if (SAFE_HREF.test(m[3]!)) out.push({ kind: 'link', text: m[2]!, href: m[3]! });
    else out.push({ kind: 'text', text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function renderMarkdown(src: string): MdNode[] {
  const nodes: MdNode[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const flush = () => {
    if (para.length) nodes.push({ kind: 'p', inlines: parseInline(para.join(' ')) });
    para = [];
    if (list) nodes.push(list);
    list = null;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      nodes.push({ kind: `h${heading[1]!.length}` as 'h1' | 'h2' | 'h3', text: heading[2]! });
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (para.length || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]!));
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return nodes;
}
