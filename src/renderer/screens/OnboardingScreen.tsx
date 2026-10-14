import { useState } from 'react';
import type { Level } from '../../core/domain/types';
import { DEFAULT_MODELS, type ProviderId } from '../../shared/providers';
import { Icon } from '../app/icons';
import { useAppData } from '../app/AppData';
import { AppErrorException, api, unwrap } from '../lib/api';
import { Button, Notice, PasswordField, Segmented, Select } from '../design-system';
import { CURRENT_LEVELS, KEY_LINKS, LANGUAGE_OPTIONS, PROVIDER_OPTIONS, TARGET_ERROR, TARGET_LEVELS, isTargetAbove } from './forms';

export function OnboardingScreen() {
  const { refresh } = useAppData();
  const [step, setStep] = useState(1);
  const [native, setNative] = useState('Portuguese (Brazil)');
  const [explainIn, setExplainIn] = useState<'native' | 'English'>('native');
  const [current, setCurrent] = useState<Level>('B1');
  const [target, setTarget] = useState<Level>('B2');
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levelOk = isTargetAbove(current, target);
  const link = KEY_LINKS[provider];

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      unwrap(await api().profile.save({
        nativeLanguage: native,
        explanationLanguage: explainIn === 'native' ? native : 'English',
        currentLevel: current,
        targetLevel: target,
        provider,
        model: DEFAULT_MODELS[provider],
        theme: 'dark',
      }));
      if (key.trim() && provider !== 'ollama') unwrap(await api().keys.set(key, provider));
      window.location.hash = '#/home';
      await refresh();
    } catch (e) {
      setError(e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
      setSaving(false);
    }
  }

  return (
    <main className="onboarding">
      <div className="onboarding-col">
        <div className="brand"><Icon name="pencil" size={18} />DevTalk</div>
        <h1>Set up your coach</h1>
        <p className="lede">Step {step} of 3. You can change all of this later in Settings.</p>

        {step === 1 && (
          <section className="onboarding-step" aria-labelledby="s1">
            <h2 id="s1">Your languages</h2>
            <Select label="Native language" value={native} options={LANGUAGE_OPTIONS} onChange={(e) => setNative(e.target.value)} />
            <Segmented label="Explanations in" value={explainIn}
              options={[{ value: 'native', label: native }, { value: 'English', label: 'English' }]} onChange={setExplainIn} />
            <div className="onboarding-actions"><Button variant="primary" onClick={() => setStep(2)}>Continue</Button></div>
          </section>
        )}

        {step === 2 && (
          <section className="onboarding-step" aria-labelledby="s2">
            <h2 id="s2">Your level</h2>
            <Segmented label="Current level" value={current} options={CURRENT_LEVELS.map((l) => ({ value: l, label: l }))} onChange={setCurrent} />
            <Segmented label="Target level" value={target} options={TARGET_LEVELS.map((l) => ({ value: l, label: l }))} onChange={setTarget} />
            {!levelOk && <p className="field-error" role="alert">{TARGET_ERROR}</p>}
            <div className="onboarding-actions">
              <Button variant="quiet" onClick={() => setStep(1)}>Back</Button>
              <Button variant="primary" disabled={!levelOk} onClick={() => setStep(3)}>Continue</Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-step" aria-labelledby="s3">
            <h2 id="s3">Your coach</h2>
            <Segmented label="Coach" value={provider} options={PROVIDER_OPTIONS} onChange={setProvider} />
            {provider === 'ollama' ? (
              <p className="muted">Ollama runs on your computer and needs no key. Install it from ollama.com first.</p>
            ) : (
              <>
                <PasswordField label="API key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key"
                  hint="Stored in your system keyring. You can add it later in Settings." />
                {link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}
              </>
            )}
            <p className="muted small">Your practice text is sent only to the coach you choose.</p>
            {error && <Notice tone="error" title={error} />}
            <div className="onboarding-actions">
              <Button variant="quiet" onClick={() => setStep(2)}>Back</Button>
              <Button variant="primary" busy={saving} onClick={finish}>Start practising</Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
