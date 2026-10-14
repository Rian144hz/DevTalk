import { createEmptyCard, fsrs, Rating, State, type Card, type Grade, type ReviewLog } from 'ts-fsrs';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface SrsCard {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: Date | null;
}

export interface SrsLog {
  rating: ReviewRating;
  state: CardState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  review: Date;
}

export const REVIEW_RATINGS: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy'];

// Fuzz off: predictable intervals for the learner and deterministic tests.
const scheduler = fsrs({ enable_fuzz: false });

const TO_GRADE: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};
const FROM_RATING: Partial<Record<Rating, ReviewRating>> = {
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy',
};
const FROM_STATE: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};
const TO_STATE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

function fromCard(c: Card): SrsCard {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: FROM_STATE[c.state],
    lastReview: c.last_review ?? null,
  };
}

function toCard(c: SrsCard): Card {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: TO_STATE[c.state],
    ...(c.lastReview ? { last_review: c.lastReview } : {}),
  };
}

function fromLog(l: ReviewLog): SrsLog {
  const rating = FROM_RATING[l.rating];
  if (!rating) throw new Error(`Unexpected FSRS rating ${l.rating}`);
  return {
    rating,
    state: FROM_STATE[l.state],
    due: l.due,
    stability: l.stability,
    difficulty: l.difficulty,
    elapsedDays: l.elapsed_days,
    scheduledDays: l.scheduled_days,
    review: l.review,
  };
}

export function newCard(now: Date): SrsCard {
  return fromCard(createEmptyCard(now));
}

export function rate(card: SrsCard, rating: ReviewRating, now: Date): { card: SrsCard; log: SrsLog } {
  const result = scheduler.next(toCard(card), now, TO_GRADE[rating]);
  return { card: fromCard(result.card), log: fromLog(result.log) };
}

export function previewDue(card: SrsCard, now: Date): Record<ReviewRating, Date> {
  const preview = scheduler.repeat(toCard(card), now);
  return {
    again: preview[Rating.Again].card.due,
    hard: preview[Rating.Hard].card.due,
    good: preview[Rating.Good].card.due,
    easy: preview[Rating.Easy].card.due,
  };
}
