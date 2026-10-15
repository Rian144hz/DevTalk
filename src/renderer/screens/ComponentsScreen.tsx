// Dev-only gallery: every base component in its states, with real DevTalk content.
import { useState } from 'react';
import { buildGalley } from '../../core/feedback/galley';
import type { Expression } from '../../core/domain/types';
import {
  Avatar, BadgeRow, BlockButton, Button, Chip, CoachProgress, EmptyState, ExpressionCard, Galley, Notice, PasswordField, ReportDialog,
  PracticeGraph, Segmented, Select, Skeleton, StackList, Tally, TextArea, TextField, TypeBadge,
} from '../design-system';
import { addDays, streaks, type DayActivity } from '../../core/progress/practice';
import type { Badge } from '../../core/social/types';
import { MASCOTS } from '../../core/social/types';
import { MASCOT_NAMES } from '../lib/mascots';

const GRAPH_TODAY = '2026-10-14';
/** A year of made-up practice: quiet at first, daily for the last month. */
const SAMPLE_DAYS: DayActivity[] = Array.from({ length: 365 }, (_, i) => {
  const r = (i * 7919) % 101;
  const recent = i > 330;
  const answers = recent ? 1 + (r % 3) : r < 45 ? 0 : r % 3;
  const reviews = answers === 0 && r < 60 ? 0 : (r * 13) % 26;
  return { day: addDays(GRAPH_TODAY, i - 364), answers, reviews };
}).filter((d) => d.answers + d.reviews > 0);
const SAMPLE_STREAKS = streaks(SAMPLE_DAYS, GRAPH_TODAY);

const SAMPLE_BADGES: Badge[] = [
  { id: 'streak_30', group: 'evolution', label: '30-day streak', detail: '34' },
  { id: 'lang:python', group: 'language', label: 'python', detail: null },
  { id: 'creator', group: 'community', label: 'Creator', detail: null },
  { id: 'moderator', group: 'community', label: 'Moderator', detail: null },
  { id: 'founding_member', group: 'community', label: 'Founding member', detail: null },
  { id: 'mentor', group: 'community', label: 'Mentor', detail: null },
  { id: 'open_source', group: 'community', label: 'Open source contributor', detail: null },
  { id: 'area:backend', group: 'technical', label: 'Back end', detail: null },
  { id: 'linux', group: 'technical', label: 'Linux native', detail: null },
  { id: 'lang:java', group: 'language', label: 'java', detail: null },
  { id: 'level_up', group: 'evolution', label: 'B1 → B2', detail: 'B1>B2' },
  { id: 'vocabulary', group: 'evolution', label: 'Vocabulary hunter', detail: '100+' },
];

const answer =
  "Yesterday I have worked on the login bug. The problem was that the token expire too fast. I changed the configuration and now it works good. Today I write tests for it.";
const galley = buildGalley(answer, [
  { original: 'have worked', corrected: 'worked', explanation: '“Yesterday” pede o passado simples.', category: 'verb_tense' },
  { original: 'expire', corrected: 'expired', explanation: 'A frase toda está no passado.', category: 'verb_tense' },
  { original: 'good', corrected: 'well', explanation: 'Para descrever um verbo, use o advérbio “well”.', category: 'word_choice' },
  { original: 'I write', corrected: "I'll write", explanation: "Plano para hoje: “I'll write”.", category: 'missing_word' },
  { original: 'the rollout', corrected: 'x', explanation: 'Fale também do que bloqueia você hoje.', category: 'off_task' },
]);
const expr: Expression = { id: 1, text: 'hold off on', type: 'phrasal_verb', meaning: 'Adiar algo de propósito, esperando o momento certo.', example: "Let's hold off on the migration until the release is out." };

export function ComponentsScreen() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [level, setLevel] = useState<'B1' | 'B2' | 'C1'>('B1');
  const [reporting, setReporting] = useState(false);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return (
    <main className="page gallery">
      <header className="page-head">
        <div><h1>Components</h1><p className="lede">Every base component in its states.</p></div>
        <Segmented label="Theme" value={theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
          onChange={(t) => { setTheme(t); document.documentElement.dataset['theme'] = t; }} />
      </header>

      <section className="gallery-row">
        <Button variant="primary" shortcut="Enter">Write it</Button>
        <Button variant="secondary">Review now</Button>
        <Button variant="quiet" shortcut="Esc">Cancel</Button>
        <Button variant="primary" busy>Get feedback</Button>
        <Button variant="secondary" disabled>Write it again</Button>
        <Chip>push back on</Chip><TypeBadge type="phrasal_verb" /><TypeBadge type="collocation" /><TypeBadge type="chunk" />
        <Tally count={7} label="7 times this month" /><Tally count={3} label="3 times this month" />
      </section>

      <section className="gallery-row stack">
        <Galley galley={galley} title="Your last answer, marked by the coach" meta="Stand-up update, yesterday" />
        <Galley galley={buildGalley(answer, [])} title="Your answer" marked={false}
          head={<div className="galley-head"><CoachProgress stage="waiting" startedAt={Date.now() - 6000} onCancel={() => {}} label="The coach is reading your answer" /></div>} />
      </section>

      <section className="gallery-grid">
        <ExpressionCard expression={expr} foot="First review tomorrow" />
        <ExpressionCard expression={{ ...expr, id: 2, text: 'make a trade-off', type: 'collocation', meaning: 'Aceitar perder algo para ganhar outra coisa.', example: 'We made a trade-off: more memory for fewer queries.' }} />
        <ExpressionCard expression={{ ...expr, id: 3, text: 'for very little gain', type: 'chunk', meaning: 'Com pouco benefício em troca do esforço.', example: 'That rewrite adds risk for very little gain.' }} />
      </section>

      <section className="gallery-row stack">
        <Notice tone="error" title="The coach is unavailable right now." detail="Your answer is saved. Check your connection and try again." action={<Button variant="secondary">Try again</Button>} />
        <Notice tone="info" title="Nothing to review now." detail="Next review in 3 h." />
        <EmptyState title="Your first answer will appear here" body="Write an answer to a challenge and the coach marks it up like an editor." action={<Button variant="primary">Get a challenge</Button>} />
        <div><Skeleton width="40%" /><Skeleton /><Skeleton width="80%" /></div>
      </section>

      <section className="gallery-row stack">
        <div className="gallery-row">
          <Avatar src={null} name="Rian" size={64} /><Avatar src={null} name="ana" /><Avatar src={null} name="Élodie" size={28} />
        </div>
        <div className="gallery-row">
          {MASCOTS.map((m) => <Avatar key={m} src={null} name={MASCOT_NAMES[m]} userId="gallery" mascot={m} size={48} />)}
        </div>
        <StackList tags={['python', 'java', 'c++', 'react native', 'postgres', 'docker', 'my-company-lib']} />
        <BadgeRow badges={SAMPLE_BADGES} />
        <PracticeGraph days={SAMPLE_DAYS} current={SAMPLE_STREAKS.current} longest={SAMPLE_STREAKS.longest} today={GRAPH_TODAY} />
        <div className="gallery-row">
          <Button variant="secondary" onClick={() => setReporting(true)}>Report Sam</Button>
          <BlockButton name="Sam" onBlock={async () => { await wait(600); return null; }} />
        </div>
        <ReportDialog open={reporting} targetName="Sam" onClose={() => setReporting(false)}
          onSubmit={async () => { await wait(600); return null; }} />
      </section>

      <section className="gallery-grid">
        <TextField label="Model" defaultValue="gemini-flash-latest" hint="Leave the default unless you know you need another." />
        <PasswordField label="API key" placeholder="Paste your key" error="That key was rejected. Check it and try again." />
        <Select label="Native language" options={[{ value: 'pt', label: 'Portuguese (Brazil)' }, { value: 'es', label: 'Spanish' }]} />
        <Segmented<'B1' | 'B2' | 'C1'> label="Current level" value={level} options={[{ value: 'B1', label: 'B1' }, { value: 'B2', label: 'B2' }, { value: 'C1', label: 'C1' }]} onChange={setLevel} />
        <TextArea label="Your answer" defaultValue={answer} hint="4 sentences. Aim for 3 to 5." />
      </section>
    </main>
  );
}
