export class MissingTemplateVarError extends Error {
  constructor(readonly varName: string) {
    super(`Prompt template variable "{${varName}}" has no value`);
    this.name = 'MissingTemplateVarError';
  }
}

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** Single-pass `{name}` substitution; inserted values are never re-scanned. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new MissingTemplateVarError(name);
    return value;
  });
}
