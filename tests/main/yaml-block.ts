/**
 * The indented lines under a top-level key of a YAML file ("win:", "jobs:"…). The packaging tests read
 * electron-builder.yml and the release workflow with this instead of a YAML parser: both files are simple.
 */
export const block = (yaml: string, key: string): string => yaml.match(new RegExp(`^${key}:\\n((?:(?: .*)?\\n)*)`, 'm'))?.[1] ?? '';
