import { useCallback, useEffect, useId, useState } from 'react';
import type { Level } from '../../core/domain/types';
import type { StoredProfile, Theme } from '../../core/ports';
import { DEFAULT_MODELS, PROVIDER_LABELS, type ProviderId } from '../../shared/providers';
import { useAppData } from '../app/AppData';
import { AppErrorException, api, unwrap } from '../lib/api';
import { setPlayAnimations, usePlayAnimationsSetting } from '../lib/motion';
import { Button, Notice, PasswordField, Segmented, Select, TextField } from '../design-system';
import { AccountSection } from './AccountSection';
import { DailySettings } from './DailySettings';
import { CURRENT_LEVELS, KEY_LINKS, PROVIDER_OPTIONS, languageOptions, TARGET_ERROR, TARGET_LEVELS, isTargetAbove } from './forms';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

function OllamaCheck() {
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-key">
      <p className="muted">Ollama runs on this computer and needs no key. Nothing you write leaves the machine.</p>
      <div className="settings-actions">
        <Button variant="secondary" busy={busy} onClick={async () => {
          setBusy(true);
          setResult(unwrap(await api().llmCheck()));
          setBusy(false);
        }}>Check connection</Button>
        {result && <span role="status" className={result.ok ? 'small' : 'small field-error'}>{result.detail}</span>}
      </div>
    </div>
  );
}

export function SettingsScreen({ profile }: { profile: StoredProfile }) {
  const { refresh } = useAppData();
  const provider = profile.provider as ProviderId;
  const ids = { motion: useId() };
  const playBanners = usePlayAnimationsSetting();

  // Profile form
  const [native, setNative] = useState(profile.nativeLanguage);
  const [explainIn, setExplainIn] = useState(profile.explanationLanguage === 'English' ? 'English' : 'native');
  const [current, setCurrent] = useState<Level>(profile.currentLevel);
  const [target, setTarget] = useState<Level>(profile.targetLevel);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Coach
  const [model, setModel] = useState(profile.model);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [coachError, setCoachError] = useState<string | null>(null);

  const loadKey = useCallback(async (p: ProviderId) => {
    setHasKey(unwrap(await api().keys.status(p)).hasKey);
  }, []);
  useEffect(() => {
    setModel(profile.model);
    void loadKey(provider);
  }, [profile.model, provider, loadKey]);

  async function saveProfile() {
    setProfileMsg(null);
    try {
      unwrap(await api().profile.save({
        nativeLanguage: native,
        explanationLanguage: explainIn === 'English' ? 'English' : native,
        currentLevel: current,
        targetLevel: target,
        provider,
        model: profile.model,
        theme: profile.theme,
      }));
      setProfileMsg('Saved.');
      await refresh();
    } catch (e) {
      setProfileMsg(message(e));
    }
  }

  async function setSettings(partial: { provider?: ProviderId; model?: string; theme?: Theme }) {
    setCoachError(null);
    try {
      unwrap(await api().settings.set(partial));
      await refresh();
    } catch (e) {
      setCoachError(message(e));
    }
  }

  async function saveKey() {
    setCoachError(null);
    try {
      setHasKey(unwrap(await api().keys.set(key, provider)).hasKey);
      setKey('');
    } catch (e) {
      setCoachError(message(e));
    }
  }

  async function removeKey() {
    setHasKey(unwrap(await api().keys.clear(provider)).hasKey);
  }

  const link = KEY_LINKS[provider];
  return (
    <main className="page settings">
      <header className="page-head"><h1>Settings</h1></header>

      <section aria-labelledby="set-profile">
        <h2 id="set-profile">Profile</h2>
        <div className="settings-grid">
          <Select label="Native language" value={native} options={languageOptions(profile.nativeLanguage)} onChange={(e) => setNative(e.target.value)} />
          <Segmented label="Explanations in" value={explainIn}
            options={[{ value: 'native', label: native }, { value: 'English', label: 'English' }]} onChange={setExplainIn} />
          <Segmented label="Current level" value={current} options={CURRENT_LEVELS.map((l) => ({ value: l, label: l }))} onChange={setCurrent} />
          <Segmented label="Target level" value={target} options={TARGET_LEVELS.map((l) => ({ value: l, label: l }))} onChange={setTarget} />
        </div>
        {!isTargetAbove(current, target) && <p className="field-error" role="alert">{TARGET_ERROR}</p>}
        <div className="settings-actions">
          <Button variant="secondary" disabled={!isTargetAbove(current, target)} onClick={saveProfile}>Save changes</Button>
          {profileMsg && <span className="muted small" role="status">{profileMsg}</span>}
        </div>
      </section>

      <section aria-labelledby="set-coach">
        <h2 id="set-coach">Coach</h2>
        <Segmented label="Provider" value={provider} options={PROVIDER_OPTIONS}
          onChange={(p) => void setSettings({ provider: p, model: DEFAULT_MODELS[p] })} />
        <div className="settings-field">
          <TextField label="Model" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false}
            hint={`Default: ${DEFAULT_MODELS[provider]}`} />
          <div className="settings-actions">
            <Button variant="secondary" disabled={!model.trim() || model === profile.model} onClick={() => void setSettings({ model: model.trim() })}>Save model</Button>
          </div>
        </div>
        {provider === 'ollama' ? (
          <OllamaCheck />
        ) : (
          <div className="settings-key">
            <p role="status">{hasKey === null ? '' : hasKey ? `Key saved for ${PROVIDER_LABELS[provider]}` : `No key saved for ${PROVIDER_LABELS[provider]}`}</p>
            <div className="settings-field">
              <PasswordField label="API key" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? 'Paste a new key to replace it' : 'Paste your key'} />
              <div className="settings-actions">
                <Button variant="secondary" disabled={!key.trim()} onClick={saveKey}>{hasKey ? 'Replace key' : 'Save key'}</Button>
                {hasKey && <Button variant="quiet" onClick={removeKey}>Remove key</Button>}
                {link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}
              </div>
            </div>
          </div>
        )}
        {coachError && <Notice tone="error" title={coachError} />}
      </section>

      <DailySettings />

      <section aria-labelledby="set-look">
        <h2 id="set-look">Appearance</h2>
        <Segmented<Theme> label="Theme" value={profile.theme}
          options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
          onChange={(t) => void setSettings({ theme: t })} />
        <div className="field">
          <label className="check-row" htmlFor={ids.motion}>
            <input id={ids.motion} type="checkbox" checked={playBanners} onChange={(e) => setPlayAnimations(e.target.checked)}
              aria-describedby={`${ids.motion}-hint`} />
            <span>Play animated banners</span>
          </label>
          <span className="field-hint" id={`${ids.motion}-hint`}>
            When off, or when your system asks to reduce motion, banners show their first frame and stay still.
          </span>
        </div>
      </section>

      <AccountSection />

      <p className="muted small settings-foot">Your practice stays on this computer, and the text you submit goes only to the coach you chose. In the community, only daily counts of answers and reviews are shared.</p>
    </main>
  );
}
