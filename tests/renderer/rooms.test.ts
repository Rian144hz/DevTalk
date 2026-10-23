import { micProblem, namesList, OUTCOME_TEXT, roleLabel, roomActions, roomMeta, seatsText, speakingNow } from '../../src/renderer/lib/rooms';

const domError = (name: string) => Object.assign(new Error(name), { name });

test('a room reads as theme and level; no level is any level', () => {
  expect(roomMeta({ theme: 'standup', level: 'B1' })).toBe('Stand-up, B1');
  expect(roomMeta({ theme: 'code_review', level: null })).toBe('Code review, any level');
  expect(roomMeta({ theme: 'free', level: 'C2' })).toBe('Free talk, C2');
  expect(seatsText(2)).toBe('2 / 6');
  expect(seatsText(6)).toBe('6 / 6');
});

test('role labels: Host and Room moderator; a member has none', () => {
  expect(roleLabel('host')).toBe('Host');
  expect(roleLabel('moderator')).toBe('Room moderator');
  expect(roleLabel('member')).toBeNull();
});

describe('what you can do to another person in the room', () => {
  const none = { mute: false, remove: false, makeModerator: false, removeModerator: false, makeHost: false };

  test('everyone can mute them for themselves, report and block; members have no room power', () => {
    expect(roomActions('member', 'member')).toEqual(none);
    expect(roomActions('member', 'moderator')).toEqual(none);
    expect(roomActions('member', 'host')).toEqual(none);
  });

  test('the host mutes and removes anyone, gives and takes the moderator role, and passes the host role', () => {
    expect(roomActions('host', 'member')).toEqual({ mute: true, remove: true, makeModerator: true, removeModerator: false, makeHost: true });
    expect(roomActions('host', 'moderator')).toEqual({ mute: true, remove: true, makeModerator: false, removeModerator: true, makeHost: true });
  });

  test('a room moderator mutes anyone but the host and removes members only', () => {
    expect(roomActions('moderator', 'member')).toEqual({ ...none, mute: true, remove: true });
    expect(roomActions('moderator', 'moderator')).toEqual({ ...none, mute: true });
    expect(roomActions('moderator', 'host')).toEqual(none);
  });
});

test('microphone problems explain how to fix them', () => {
  expect(micProblem(domError('NotFoundError')).title).toBe('No microphone found.');
  expect(micProblem(domError('OverconstrainedError')).title).toBe('No microphone found.');
  const refused = micProblem(domError('NotAllowedError'));
  expect(refused.title).toBe('DevTalk cannot use your microphone.');
  expect(refused.detail).toMatch(/Allow DevTalk to use the microphone/);
  expect(micProblem(domError('SecurityError')).title).toBe('DevTalk cannot use your microphone.');
  expect(micProblem(domError('NotReadableError')).title).toBe('Your microphone is busy.');
  expect(micProblem(new Error('boom')).title).toBe('The microphone did not start.');
  expect(micProblem('nothing').title).toBe('The microphone did not start.');
});

test('why you are back on the list', () => {
  expect(OUTCOME_TEXT.removed).toBe('You were removed from this room.');
  expect(OUTCOME_TEXT.ended).toBe('The room has ended.');
  expect(OUTCOME_TEXT.gone).toBe('You are no longer in this room.');
});

test('speaking turns on above a louder level and off below a quieter one, so the ring does not flicker', () => {
  expect(speakingNow(0.2, false)).toBe(false);
  expect(speakingNow(0.5, false)).toBe(true);
  expect(speakingNow(0.4, true)).toBe(true);
  expect(speakingNow(0.4, false)).toBe(false);
  expect(speakingNow(0.2, true)).toBe(false);
  expect(speakingNow(Number.NaN, true)).toBe(false);
});

test('names read as a list: Bia, Bia and Caio, Bia, Caio and Dani', () => {
  expect(namesList([])).toBe('');
  expect(namesList(['Bia'])).toBe('Bia');
  expect(namesList(['Bia', 'Caio'])).toBe('Bia and Caio');
  expect(namesList(['Bia', 'Caio', 'Dani'])).toBe('Bia, Caio and Dani');
});
