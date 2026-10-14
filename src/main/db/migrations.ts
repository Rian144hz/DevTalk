import { CHALLENGE_CATEGORIES, EXPRESSION_TYPES, MISTAKE_CATEGORIES, TEXT_SOURCES } from '../../core/domain/categories';
import { LEVELS } from '../../core/domain/types';

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
const CARD_STATES = ['new', 'learning', 'review', 'relearning'];
const RATINGS = ['again', 'hard', 'good', 'easy'];

/** Append-only. Each entry runs once; PRAGMA user_version records how many have run. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    native_language TEXT NOT NULL,
    current_level TEXT NOT NULL CHECK (current_level IN (${list(LEVELS)})),
    target_level TEXT NOT NULL CHECK (target_level IN (${list(LEVELS)})),
    explanation_language TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    theme TEXT NOT NULL CHECK (theme IN ('system', 'dark', 'light')),
    onboarded_at TEXT
  );

  CREATE TABLE expressions (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN (${list(EXPRESSION_TYPES)})),
    meaning TEXT NOT NULL,
    example TEXT NOT NULL,
    origin_feedback_id INTEGER REFERENCES feedbacks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE challenges (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN (${list(CHALLENGE_CATEGORIES)})),
    situation TEXT NOT NULL,
    interlocutor TEXT NOT NULL,
    task TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX challenges_created_at ON challenges(created_at);

  CREATE TABLE challenge_required (
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    expression_id INTEGER NOT NULL REFERENCES expressions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    hint TEXT NOT NULL,
    PRIMARY KEY (challenge_id, expression_id)
  );

  CREATE TABLE attempts (
    id INTEGER PRIMARY KEY,
    challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN (${list(TEXT_SOURCES)})),
    created_at TEXT NOT NULL
  );
  CREATE INDEX attempts_created_at ON attempts(created_at);

  CREATE TABLE feedbacks (
    id INTEGER PRIMARY KEY,
    attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    natural_rewrite TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX feedbacks_created_at ON feedbacks(created_at);

  CREATE TABLE corrections (
    id INTEGER PRIMARY KEY,
    feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    original TEXT NOT NULL,
    corrected TEXT NOT NULL,
    explanation TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (${list(MISTAKE_CATEGORIES)}))
  );
  CREATE INDEX corrections_category ON corrections(category);
  CREATE INDEX corrections_feedback ON corrections(feedback_id);

  CREATE TABLE expression_checks (
    feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    expression_id INTEGER NOT NULL REFERENCES expressions(id) ON DELETE CASCADE,
    used INTEGER NOT NULL CHECK (used IN (0, 1)),
    used_correctly INTEGER NOT NULL CHECK (used_correctly IN (0, 1)),
    note TEXT NOT NULL,
    PRIMARY KEY (feedback_id, expression_id)
  );

  CREATE TABLE feedback_expressions (
    feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    expression_id INTEGER NOT NULL REFERENCES expressions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (feedback_id, expression_id)
  );

  CREATE TABLE review_cards (
    expression_id INTEGER PRIMARY KEY REFERENCES expressions(id) ON DELETE CASCADE,
    due TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    learning_steps INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    lapses INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN (${list(CARD_STATES)})),
    last_review TEXT
  );
  CREATE INDEX review_cards_due ON review_cards(due);

  CREATE TABLE review_logs (
    id INTEGER PRIMARY KEY,
    expression_id INTEGER NOT NULL REFERENCES expressions(id) ON DELETE CASCADE,
    rating TEXT NOT NULL CHECK (rating IN (${list(RATINGS)})),
    state TEXT NOT NULL CHECK (state IN (${list(CARD_STATES)})),
    due TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL,
    scheduled_days INTEGER NOT NULL,
    review TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];
