import type { ReactNode } from 'react';
import type { Expression } from '../../core/domain/types';
import { TypeBadge } from './TypeBadge';

/** `concealed` hides meaning and example (Review, before the learner reveals them). */
export function ExpressionCard({ expression, foot, concealed = false }: { expression: Expression; foot?: ReactNode; concealed?: boolean }) {
  return (
    <article className="expr" aria-label={expression.text}>
      <div className="expr-top">
        <span className="expr-phrase">{expression.text}</span>
        <TypeBadge type={expression.type} />
      </div>
      {!concealed && <p className="expr-meaning">{expression.meaning}</p>}
      {!concealed && <p className="expr-example">{expression.example}</p>}
      {foot && <p className="expr-foot">{foot}</p>}
    </article>
  );
}
