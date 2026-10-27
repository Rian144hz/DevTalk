import { useEffect, useState } from 'react';
import type { SocialStatus } from '../../shared/ipc-contract';
import { api } from '../lib/api';
import { firstRunStep, type FirstRunChoice } from '../lib/first-run';
import { useRoute } from '../lib/useRoute';
import { JoinScreen } from '../screens/JoinScreen';
import { LegalScreen, type LegalDoc } from '../screens/LegalScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';

/** What is known while the community status is not: the same as a build with no community, so only practising shows. */
const UNKNOWN: SocialStatus = { configured: false, signedIn: false, email: null, needsDocuments: false, hasProfile: false, suspendedUntil: null };
/** The welcome screen waits this long for the status; a slow answer never holds the first screen back. */
const STATUS_WAIT_MS = 3000;

/**
 * The first run, when this computer has no coach profile: welcome, then GitHub or e-mail through the community steps,
 * or no account at all, and last the coach setup. `firstRunStep` decides the screen; this only keeps the choice and
 * the community status. The coach setup ends it: saving the profile swaps this for the app.
 */
export function FirstRun() {
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [choice, setChoice] = useState<FirstRunChoice>('none');
  const [route] = useRoute();

  useEffect(() => {
    let alive = true;
    const giveUp = setTimeout(() => alive && setStatus((s) => s ?? UNKNOWN), STATUS_WAIT_MS);
    api().social.status().then(
      // A failure comes after the build is known to have a community (a build without one answers at once).
      (r) => alive && setStatus(r.ok ? r.data : { ...UNKNOWN, configured: true }),
      () => alive && setStatus({ ...UNKNOWN, configured: true }),
    );
    return () => {
      alive = false;
      clearTimeout(giveUp);
    };
  }, []);

  if (!status) return null;
  const step = firstRunStep(status, choice, false);

  if (step === 'coach') return <OnboardingScreen />;
  if (step === 'join') {
    // The rules open in full here too; "Back to joining" returns to the steps (the ticks are kept).
    if (route.name === 'legal') return <div className="first-run-legal"><LegalScreen doc={(route.sub ?? 'terms') as LegalDoc} /></div>;
    return (
      <JoinScreen embedded offerGitHub={choice !== 'email'} viaGitHub={choice === 'github'}
        onDone={() => setStatus((s) => ({ ...(s ?? UNKNOWN), configured: true, signedIn: true, needsDocuments: false, hasProfile: true }))}
        onBack={() => setChoice('none')}
        onSkip={() => setChoice('local')} />
    );
  }
  return (
    <WelcomeScreen configured={status.configured}
      onSignedIn={(next) => { setStatus(next); setChoice('github'); }}
      onEmail={() => setChoice('email')}
      onLocal={() => setChoice('local')} />
  );
}
