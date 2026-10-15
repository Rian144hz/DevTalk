// Builds src/renderer/lib/stack-icons.generated.ts from a curated list of Simple Icons (CC0-1.0).
// Only these icons enter the app bundle. Run: npm run gen:stack-icons
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Slugs from simple-icons, roughly by how often developers list them. */
export const CURATED = [
  // Languages
  'python', 'openjdk', 'cplusplus', 'c', 'javascript', 'typescript', 'go', 'rust', 'kotlin', 'swift', 'dart', 'php', 'ruby',
  'scala', 'elixir', 'haskell', 'lua', 'r', 'julia', 'clojure', 'erlang', 'zig', 'gnubash', 'dotnet',
  'webassembly', 'solidity',
  // Front end
  'react', 'vuedotjs', 'angular', 'svelte', 'nextdotjs', 'nuxt', 'solid', 'astro', 'remix', 'gatsby', 'jquery',
  'tailwindcss', 'bootstrap', 'sass', 'html5', 'css', 'redux', 'threedotjs', 'd3', 'vite', 'webpack', 'storybook',
  'htmx',
  // Back end and runtimes
  'nodedotjs', 'deno', 'bun', 'express', 'nestjs', 'fastify', 'django', 'flask', 'fastapi', 'rubyonrails', 'laravel',
  'symfony', 'spring', 'springboot', 'graphql', 'trpc', 'prisma', 'socketdotio',
  // Data stores
  'postgresql', 'mysql', 'mariadb', 'sqlite', 'mongodb', 'redis', 'elasticsearch', 'apachecassandra', 'neo4j',
  'supabase', 'firebase',
  // DevOps and cloud
  'docker', 'kubernetes', 'helm', 'terraform', 'ansible', 'githubactions', 'gitlab', 'jenkins', 'git', 'github',
  'linux', 'ubuntu', 'debian', 'archlinux', 'fedora', 'nginx', 'apachekafka', 'rabbitmq', 'googlecloud', 'vercel',
  'netlify', 'cloudflare', 'digitalocean', 'prometheus', 'grafana', 'sentry',
  // Mobile and desktop
  'flutter', 'android', 'ios', 'expo', 'electron', 'tauri', 'qt', 'unity', 'unrealengine', 'godotengine', 'jetpackcompose',
  // Build, test, tools
  'cmake', 'gradle', 'apachemaven', 'npm', 'pnpm', 'yarn', 'pytest', 'jest', 'vitest', 'cypress', 'selenium', 'junit5',
  'postman', 'swagger', 'neovim', 'vim', 'gnuemacs', 'jetbrains', 'figma', 'jupyter', 'anaconda', 'poetry',
  // Data and ML
  'pandas', 'numpy', 'scikitlearn', 'tensorflow', 'pytorch', 'keras', 'apachespark', 'apacheairflow',
  'snowflake', 'databricks', 'huggingface',
  // Hardware
  'raspberrypi', 'arduino',
];

/** Extra names people type, normalized (lowercase, single spaces) → slug. */
export const ALIASES: Record<string, string> = {
  'c++': 'cplusplus', cpp: 'cplusplus', java: 'openjdk', js: 'javascript', ts: 'typescript', golang: 'go', bash: 'gnubash',
  shell: 'gnubash', '.net': 'dotnet', 'c#': 'dotnet', csharp: 'dotnet', 'react native': 'react', reactjs: 'react',
  'react.js': 'react', vue: 'vuedotjs', vuejs: 'vuedotjs', next: 'nextdotjs', nextjs: 'nextdotjs', 'nuxt.js': 'nuxt',
  solidjs: 'solid', tailwind: 'tailwindcss', css3: 'css', html: 'html5', threejs: 'threedotjs', 'd3.js': 'd3',
  node: 'nodedotjs', nodejs: 'nodedotjs', 'express.js': 'express', expressjs: 'express', nest: 'nestjs', rails: 'rubyonrails',
  'spring boot': 'springboot', 'socket.io': 'socketdotio', postgres: 'postgresql', mongo: 'mongodb', cassandra: 'apachecassandra',
  k8s: 'kubernetes', 'github actions': 'githubactions', gcp: 'googlecloud', 'google cloud': 'googlecloud', kafka: 'apachekafka',
  maven: 'apachemaven', 'unreal engine': 'unrealengine', unreal: 'unrealengine', godot: 'godotengine', emacs: 'gnuemacs',
  'scikit-learn': 'scikitlearn', sklearn: 'scikitlearn', spark: 'apachespark', airflow: 'apacheairflow', 'hugging face': 'huggingface',
  'jetpack compose': 'jetpackcompose', junit: 'junit5', pyspark: 'apachespark',
};

/**
 * Aliases that name a different (related) technology than the logo's own title: the profile shows this label,
 * and the logo only decorates it ("java" shows "Java" with the OpenJDK logo, never "OpenJDK").
 */
export const ALIAS_LABELS: Record<string, string> = {
  java: 'Java', 'react native': 'React Native', 'c#': 'C#', csharp: 'C#', shell: 'Shell', bash: 'Bash', pyspark: 'PySpark', junit: 'JUnit',
};

/**
 * Brand colours for logos that Simple Icons draws in black (or that mean a related technology): language badges show
 * these instead. Java is shown with the OpenJDK logo in Java's orange.
 */
export const BRAND_OVERRIDES: Record<string, string> = { openjdk: 'ED8B00', rust: 'DEA584', angular: 'DD0031' };

interface SimpleIcon {
  title: string;
  slug: string;
  path: string;
  hex: string;
}

export interface PickedIcon {
  title: string;
  path: string;
  /** Brand colour (RRGGBB), or null when the brand is black or grey: the badge then uses the neutral colour. */
  hex: string | null;
}

/** Black, white and greys carry no brand hue worth showing. */
function isGrey(hex: string): boolean {
  const n = parseInt(hex, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}

export function pickIcons(all: Record<string, SimpleIcon>): { icons: Record<string, PickedIcon>; missing: string[] } {
  const bySlug = new Map(Object.values(all).map((i) => [i.slug, i]));
  const icons: Record<string, PickedIcon> = {};
  const missing: string[] = [];
  for (const slug of CURATED) {
    const icon = bySlug.get(slug);
    if (!icon) {
      missing.push(slug);
      continue;
    }
    const hex = BRAND_OVERRIDES[slug] ?? icon.hex.toUpperCase();
    icons[slug] = { title: icon.title, path: icon.path, hex: isGrey(hex) ? null : hex };
  }
  return { icons, missing };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const all = require('simple-icons') as Record<string, SimpleIcon>;
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'simple-icons', 'package.json'), 'utf8')) as { version: string };
  const version = pkg.version;
  const { icons, missing } = pickIcons(all);
  const aliases = Object.fromEntries(Object.entries(ALIASES).filter(([, slug]) => slug in icons));
  const labels = Object.fromEntries(Object.entries(ALIAS_LABELS).filter(([alias]) => alias in aliases));
  const body = `// Generated by scripts/gen-stack-icons.mts from simple-icons@${version} (CC0-1.0). Do not edit.
// Technology logos identify a profile's stack. Tags draw them in the text colour; the up to two main-stack badges
// use the brand colour (hex, null for black or grey brands), adjusted per theme for contrast (see PRODUCT.md).

export const STACK_ICONS: Record<string, { title: string; path: string; hex: string | null }> = ${JSON.stringify(icons, null, 2)};

export const STACK_ALIASES: Record<string, string> = ${JSON.stringify(aliases, null, 2)};

/** Labels for aliases that name a related technology rather than the logo's own. */
export const STACK_ALIAS_LABELS: Record<string, string> = ${JSON.stringify(labels, null, 2)};
`;
  writeFileSync(join(root, 'src', 'renderer', 'lib', 'stack-icons.generated.ts'), body);
  console.log(`Wrote ${Object.keys(icons).length} icons.${missing.length ? ` Missing: ${missing.join(', ')}` : ''}`);
}
