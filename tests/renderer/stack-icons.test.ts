import { STACK_ICONS } from '../../src/renderer/lib/stack-icons.generated';
import { KNOWN_STACKS, stackIconFor } from '../../src/renderer/lib/stack-icons';

test('common stacks resolve by name, slug or alias, ignoring case and spaces', () => {
  expect(stackIconFor('Python')?.title).toBe('Python');
  expect(stackIconFor('  python ')?.title).toBe('Python');
  expect(stackIconFor('c++')?.title).toBe('C++');
  expect(stackIconFor('React  Native')?.title).toBe('React');
  expect(stackIconFor('node')?.title).toBe('Node.js');
  expect(stackIconFor('postgres')?.title).toBe('PostgreSQL');
});

test('unknown tags have no icon', () => {
  expect(stackIconFor('my-company-lib')).toBeNull();
  expect(stackIconFor('')).toBeNull();
});

test('only the curated icons are bundled', () => {
  const n = Object.keys(STACK_ICONS).length;
  expect(n).toBeGreaterThanOrEqual(100);
  expect(n).toBeLessThanOrEqual(160);
  for (const icon of Object.values(STACK_ICONS)) expect(icon.path).toMatch(/^[Mm]/);
});

test('known stacks are display names for autocomplete', () => {
  expect(KNOWN_STACKS).toContain('Python');
  expect(KNOWN_STACKS).toContain('TypeScript');
  expect(new Set(KNOWN_STACKS).size).toBe(KNOWN_STACKS.length);
});
