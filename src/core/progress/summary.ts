import type { MistakeCategory } from '../domain/categories';
import type { StudyStore } from '../ports';

export interface ProgressSummary {
  dueToday: number;
  totalExpressions: number;
  reusedExpressions: number;
  /** Sorted by total desc; categories with no corrections are omitted. */
  mistakes: { category: MistakeCategory; last30Days: number; total: number }[];
}

const DAY_MS = 86_400_000;

export function endOfLocalDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function buildProgressSummary(store: StudyStore, now: Date): ProgressSummary {
  const recent = new Map(store.mistakeCounts(new Date(now.getTime() - 30 * DAY_MS)).map((m) => [m.category, m.count]));
  const mistakes = store
    .mistakeCounts(null)
    .map((m) => ({ category: m.category, last30Days: recent.get(m.category) ?? 0, total: m.count }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  return {
    dueToday: store.countDue(endOfLocalDay(now)),
    totalExpressions: store.expressionCount(),
    reusedExpressions: store.reusedExpressionCount(),
    mistakes,
  };
}
