import { spawn } from 'node:child_process';
import type { HandlerMap } from '../ipc/handle';
import type { SocialChannel } from '../ipc/handlers';

export interface SmokeIO {
  /** Asks for one line of text; null when the dialog is closed. */
  ask(text: string): Promise<string | null>;
  log(line: string): void;
}

/**
 * `--social-smoke`: signs in to the real community server (e-mail + code), accepts the documents,
 * creates a minimal profile when there is none and reads it back. `--check-moderator` also prints the flag.
 */
export async function runSocialSmoke(h: HandlerMap<SocialChannel>, io: SmokeIO, opts: { checkModerator: boolean }): Promise<number> {
  const failed = (step: string, error: { kind: string; message: string }) => {
    io.log(`failed at ${step}: [${error.kind}] ${error.message}`);
    return 1;
  };
  const cancelled = () => {
    io.log('cancelled');
    return 1;
  };

  let status = await h['social:status']({});
  if (!status.ok) return failed('status', status.error);
  if (!status.data.configured) return failed('status', { kind: 'not_configured', message: 'No Supabase URL and key in this build (.env).' });

  if (!status.data.signedIn) {
    const email = await io.ask('Your e-mail for the DevTalk community:');
    if (email === null) return cancelled();
    const sent = await h['social:sendCode']({ email });
    if (!sent.ok) return failed('send code', sent.error);
    const code = await io.ask(`Type the code sent to ${email.trim()}:`);
    if (code === null) return cancelled();
    status = await h['social:verifyCode']({ email, code: code.trim() });
    if (!status.ok) return failed('verify', status.error);
  }
  if (status.data.needsDocuments) {
    status = await h['social:acceptDocuments']({});
    if (!status.ok) return failed('documents', status.error);
  }
  if (!status.data.hasProfile) {
    const name = await io.ask('Display name for your profile (you can change it in the app):');
    if (name === null) return cancelled();
    const saved = await h['social:saveProfile']({
      displayName: name.trim(),
      nativeLanguage: 'Portuguese (Brazil)',
      level: 'B1',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      area: 'other',
      stack: [],
      availability: [],
      bio: '',
      mainStack: [],
      showProgress: true,
      mascot: null,
    });
    if (!saved.ok) return failed('profile', saved.error);
  }
  const profile = await h['social:getProfile']({});
  if (!profile.ok) return failed('read profile', profile.error);
  if (opts.checkModerator) {
    const mod = await h['moderation:isModerator']({});
    if (!mod.ok) return failed('moderator', mod.error);
    io.log(`moderator: ${mod.data ? 'yes' : 'no'}`);
  }
  io.log(`ok: signed in as ${status.data.email}, profile "${profile.data?.displayName ?? '(none)'}"`);
  return 0;
}

/** A zenity text dialog (Linux), so nothing has to be typed in a terminal. */
export function zenityAsk(text: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('zenity', ['--entry', '--title=DevTalk', `--text=${text}`, '--width=420'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.replace(/\n$/, '') : null));
  });
}
