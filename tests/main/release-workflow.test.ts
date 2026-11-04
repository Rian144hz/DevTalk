// .github/workflows/release.yml builds the Windows installer and the Linux AppImage on GitHub's runners and, on a tag,
// publishes them. These tests fail when a decision recorded there drifts: the triggers, the runners, the secrets, the release.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { block } from './yaml-block';

const workflow = readFileSync(join(__dirname, '../../.github/workflows/release.yml'), 'utf8');
/** The workflow's jobs, by name. */
const jobs = Object.fromEntries(
  [...block(workflow, 'jobs').matchAll(/^ {2}([\w-]+):\n((?:(?: {3,}.*)?\n)*)/gm)].map((m) => [m[1]!, m[2]!]),
) as Record<string, string>;

test('runs by hand and when a v* tag is pushed', () => {
  const on = block(workflow, 'on');
  expect(on).toMatch(/^ {2}workflow_dispatch:$/m);
  expect(on).toMatch(/^ {2}push:\n {4}tags:\n {6}- 'v\*'$/m);
});

test('builds on a Windows and a Linux runner and uploads exactly the files electron-builder.yml names', () => {
  expect(jobs['build']).toContain('os: windows-latest');
  expect(jobs['build']).toContain('os: ubuntu-latest');
  expect(jobs['build']).toContain('builder_flag: --win');
  expect(jobs['build']).toContain('builder_flag: --linux');
  expect(jobs['build']).toContain('files: dist/DevTalk-Setup-*.exe');
  expect(jobs['build']).toContain('files: dist/DevTalk-*.AppImage');
  expect(jobs['build']).toContain('if-no-files-found: error');
});

test('uses Node 22 with the npm cache and npm 11, installs with npm ci and never publishes from the build', () => {
  expect(jobs['build']).toMatch(/node-version: 22\n\s+cache: npm/);
  expect(jobs['build']).toContain('npm install --global npm@11');
  expect(jobs['build']).toMatch(/run: npm ci$/m);
  expect(jobs['build']).toContain('run: npx electron-builder ${{ matrix.builder_flag }} --publish never');
});

test('uses only actions published by GitHub itself', () => {
  const uses = [...workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((m) => m[1]!);
  expect(uses.length).toBeGreaterThan(0);
  for (const action of uses) expect(action).toMatch(/^actions\/[\w-]+@v\d+$/);
});

test('hands the Supabase secrets to the build step alone and never prints them', () => {
  for (const name of ['MAIN_VITE_SUPABASE_URL', 'MAIN_VITE_SUPABASE_PUBLISHABLE_KEY']) {
    expect(workflow.match(new RegExp(`\\$\\{\\{ secrets\\.${name} \\}\\}`, 'g'))).toHaveLength(1);
  }
  expect(jobs['build']).toMatch(
    /run: npx electron-vite build\n\s+env:\n\s+MAIN_VITE_SUPABASE_URL: \$\{\{ secrets\.MAIN_VITE_SUPABASE_URL \}\}\n\s+MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.MAIN_VITE_SUPABASE_PUBLISHABLE_KEY \}\}\n/,
  );
  expect(workflow).not.toMatch(/\b(?:echo|printenv|Write-Host|Write-Output|set -x)\b[^\n]*(?:secrets|MAIN_VITE)/);
});

test('only a tag makes a GitHub Release, after both builds, with the gh CLI and the workflow token', () => {
  const release = jobs['release']!;
  expect(release).toContain("if: startsWith(github.ref, 'refs/tags/v')");
  expect(release).toMatch(/^ {4}needs: build$/m);
  expect(release).toMatch(/gh release create "\$TAG" release-files\/\*/);
  expect(release).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
});

test('can write to the repository in the release job only', () => {
  expect(block(workflow, 'permissions').trim()).toBe('contents: read');
  expect(workflow.match(/contents: write/g)).toHaveLength(1);
  expect(jobs['release']).toMatch(/^ {4}permissions:\n {6}contents: write$/m);
});
