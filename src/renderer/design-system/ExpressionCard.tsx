import type { ReactNode } from 'react';
import type { Expression } from '../../core/domain/types';
import { TypeBadge } from './TypeBadge';

export function ExpressionCard({ expression, foot }: { expression: Expression; foot?: ReactNode }) {
  return (
    <article className="expr" aria-label={expression.text}>
      <div className="expr-top">
        <span className="expr-phrase">{expression.text}</span>
        <TypeBadge type={expression.type} />
      </div>
      <p className="expr-meaning">{expression.meaning}</p>
      <p className="expr-example">{expression.example}</p>
      {foot && <p className="expr-foot">{foot}</p>}
    </article>
  );
}
