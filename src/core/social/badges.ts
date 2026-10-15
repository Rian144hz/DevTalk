/** Badges a moderator can give or take (Creator is set once in the SQL Editor). */
export const MANUAL_BADGES = ['beta_tester', 'mentor', 'open_source'] as const;
export type ManualBadge = (typeof MANUAL_BADGES)[number];

/** Display labels by badge id (spec §2). Language badges use the stack's own label. */
export const BADGE_LABELS: Record<string, string> = {
  creator: 'Creator',
  moderator: 'Moderator',
  founding_member: 'Founding member',
  beta_tester: 'Beta tester',
  mentor: 'Mentor',
  open_source: 'Open source contributor',
  diff_master: 'Diff master',
  room_host: 'Room host',
  active_speaker: 'Active speaker',
  'area:backend': 'Back end',
  'area:frontend': 'Front end',
  'area:mobile': 'Mobile',
  'area:data': 'Data',
  'area:devops': 'DevOps',
  linux: 'Linux native',
  streak_7: '7-day streak',
  streak_30: '30-day streak',
  level_up: 'Level up',
  vocabulary: 'Vocabulary hunter',
};
