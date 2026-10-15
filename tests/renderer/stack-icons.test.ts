import { STACK_ICONS } from '../../src/renderer/lib/stack-icons.generated';
import { canBeMain, KNOWN_STACKS, stackIconFor } from '../../src/renderer/lib/stack-icons';

test('common stacks resolve by name, slug or alias, ignoring case and spaces', () => {
  expect(stackIconFor('Python')?.title).toBe('Python');
  expect(stackIconFor('  python ')?.title).toBe('Python');
  expect(stackIconFor('c++')?.title).toBe('C++');
  expect(stackIconFor('React  Native')?.label).toBe('React Native');
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
  expect(KNOWN_STACKS).toContain('Java');
  expect(new Set(KNOWN_STACKS).size).toBe(KNOWN_STACKS.length);
});

test('the label is what the person means, the logo is only decoration', () => {
  expect(stackIconFor('java')).toMatchObject({ title: 'OpenJDK', label: 'Java' });
  expect(stackIconFor('React Native')).toMatchObject({ title: 'React', label: 'React Native' });
  expect(stackIconFor('c#')?.label).toBe('C#');
  expect(stackIconFor('shell')?.label).toBe('Shell');
  expect(stackIconFor('react')?.label).toBe('React');
  expect(stackIconFor('js')?.label).toBe('JavaScript');
  expect(stackIconFor('python')?.label).toBe('Python');
});

test('only known technologies can be marked as main, so a tag cannot pose as a badge', () => {
  expect(canBeMain('python')).toBe(true);
  expect(canBeMain('Java')).toBe(true);
  expect(canBeMain('c++')).toBe(true);
  for (const tag of ['moderator', 'creator', 'staff', 'verified', 'my-company-lib']) expect(canBeMain(tag), tag).toBe(false);
});
