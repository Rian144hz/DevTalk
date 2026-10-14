import { EXPRESSION_TYPE_LABELS, type ExpressionType } from '../../core/domain/categories';

export const TypeBadge = ({ type }: { type: ExpressionType }) => (
  <span className="badge" data-type={type}>{EXPRESSION_TYPE_LABELS[type]}</span>
);
