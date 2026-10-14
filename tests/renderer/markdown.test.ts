import { renderMarkdown } from '../../src/renderer/lib/markdown';

test('headings, paragraphs and lists', () => {
  expect(renderMarkdown('# Title\n\nFirst line\nsame paragraph.\n\n## Part\n\n- one\n- two\n\n1. a\n2. b')).toEqual([
    { kind: 'h1', text: 'Title' },
    { kind: 'p', inlines: [{ kind: 'text', text: 'First line same paragraph.' }] },
    { kind: 'h2', text: 'Part' },
    { kind: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
    { kind: 'ol', items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]] },
  ]);
});

test('bold and links inside text', () => {
  expect(renderMarkdown('Read **this** and [the policy](#/legal/privacy).')).toEqual([
    {
      kind: 'p',
      inlines: [
        { kind: 'text', text: 'Read ' },
        { kind: 'strong', text: 'this' },
        { kind: 'text', text: ' and ' },
        { kind: 'link', text: 'the policy', href: '#/legal/privacy' },
        { kind: 'text', text: '.' },
      ],
    },
  ]);
});

test('raw HTML stays text', () => {
  expect(renderMarkdown('<script>alert(1)</script>')).toEqual([
    { kind: 'p', inlines: [{ kind: 'text', text: '<script>alert(1)</script>' }] },
  ]);
});

test('only https, mailto and in-app links become links', () => {
  const [p] = renderMarkdown('[a](javascript:alert(1)) [b](https://supabase.com) [c](mailto:x@y.z) [d](file:///etc/passwd)');
  expect(p).toEqual({
    kind: 'p',
    inlines: [
      { kind: 'text', text: 'a' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'b', href: 'https://supabase.com' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'c', href: 'mailto:x@y.z' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'd' },
    ],
  });
});
