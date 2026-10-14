import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Level } from '../../core/domain/types';
import { AREAS, PROFILE_LIMITS, type Area, type AvailabilitySlot, type ProfileDraft } from '../../core/social/types';
import { ProfileDraftSchema, normalizeStackTags } from '../../core/social/validate';
import { Icon } from '../app/icons';
import { Avatar, Button, Notice, Segmented, Select, StackTag, TextArea, TextField } from '../design-system';
import { DAY_NAMES, halfHourTimes } from '../lib/format';
import { AvatarInputError, prepareAvatar } from '../lib/image';
import { browserAvatarDeps } from '../lib/image-browser';
import { KNOWN_STACKS } from '../lib/stack-icons';
import { ALL_LEVELS, AREA_LABELS, languageOptions } from './forms';

/** What happens to the photo when the form is saved. */
export type PhotoChange = { bytes: Uint8Array } | 'remove' | null;

const FIELD_MESSAGES: Partial<Record<keyof ProfileDraft, string>> = {
  displayName: 'Use 2 to 40 characters.',
  nativeLanguage: 'Choose a language.',
  timezone: 'Choose a time zone from the list.',
  stack: 'Use up to 10 technologies of up to 30 characters.',
  availability: 'Each time must start before it ends.',
  bio: 'Use at most 160 characters.',
};

/** Monday first, the way most calendars at work show the week. */
const WEEK: AvailabilitySlot['day'][] = [1, 2, 3, 4, 5, 6, 0];

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

export function toDataUrl(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/webp;base64,${btoa(s)}`;
}

export function ProfileForm({
  initial,
  initialAvatar,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ProfileDraft;
  initialAvatar: string | null;
  submitLabel: string;
  /** Resolves to an error message, or null when saved. */
  onSubmit(draft: ProfileDraft, photo: PhotoChange): Promise<string | null>;
  onCancel?(): void;
}) {
  const ids = { tz: useId(), stack: useId(), avail: useId() };
  const zones = useMemo(timeZones, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.displayName);
  const [language, setLanguage] = useState(initial.nativeLanguage);
  const [level, setLevel] = useState<Level>(initial.level);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [area, setArea] = useState<Area>(initial.area);
  const [stack, setStack] = useState<string[]>(initial.stack);
  const [stackText, setStackText] = useState('');
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initial.availability);
  const [bio, setBio] = useState(initial.bio);
  const [photo, setPhoto] = useState<PhotoChange>(null);
  const [preview, setPreview] = useState<string | null>(initialAvatar);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileDraft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addTag(raw: string) {
    const next = normalizeStackTags([...stack, raw]);
    setStack(next);
    setStackText('');
  }

  function onStackKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (stackText.trim()) addTag(stackText);
    } else if (e.key === 'Backspace' && !stackText && stack.length > 0) {
      setStack(stack.slice(0, -1));
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      const bytes = await prepareAvatar(file, browserAvatarDeps);
      setPhoto({ bytes });
      setPreview(toDataUrl(bytes));
    } catch (err) {
      setPhotoError(err instanceof AvatarInputError ? err.message : 'This image could not be read. Try another one.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removePhoto() {
    setPhoto(initialAvatar ? 'remove' : null);
    setPreview(null);
    setPhotoError(null);
  }

  const setSlot = (i: number, patch: Partial<AvailabilitySlot>) =>
    setSlots(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const draft: ProfileDraft = {
      displayName: name.trim(),
      nativeLanguage: language,
      level,
      timezone: timezone.trim(),
      area,
      stack: stackText.trim() ? normalizeStackTags([...stack, stackText]) : stack,
      availability: slots,
      bio: bio.trim(),
    };
    const parsed = ProfileDraftSchema.safeParse(draft);
    const found: Partial<Record<keyof ProfileDraft, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ProfileDraft;
        found[key] ??= FIELD_MESSAGES[key] ?? issue.message;
      }
    }
    if (zones.length > 0 && draft.timezone && !zones.includes(draft.timezone)) found.timezone = FIELD_MESSAGES.timezone;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const failure = await onSubmit(draft, photo);
    setBusy(false);
    if (failure) setFormError(failure);
  }

  return (
    <form className="profile-form" onSubmit={submit} noValidate>
      <div className="photo-row">
        <Avatar src={preview} name={name || '?'} size={72} />
        <div className="photo-actions">
          <span className="field-label">Photo (optional)</span>
          <div className="row-actions">
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>{preview ? 'Change photo' : 'Add photo'}</Button>
            {preview && <Button variant="quiet" onClick={removePhoto}>Remove photo</Button>}
          </div>
          <span className="field-hint">JPEG, PNG or WebP, up to 8 MB. It is cropped to a square.</span>
          {photoError && <span className="field-error" role="alert">{photoError}</span>}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={(e) => void choosePhoto(e.target.files?.[0])} />
        </div>
      </div>

      <div className="form-grid">
        <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={PROFILE_LIMITS.displayName.max}
          error={errors.displayName} hint="How other members see you." autoComplete="nickname" />
        <Select label="Native language" value={language} options={languageOptions(language)} onChange={(e) => setLanguage(e.target.value)} />
        <Segmented label="English level" value={level} options={ALL_LEVELS.map((l) => ({ value: l, label: l }))} onChange={setLevel} />
        <Select label="Area" value={area} options={AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))}
          onChange={(e) => setArea(e.target.value as Area)} />
        <TextField label="Time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)} list={ids.tz} spellCheck={false}
          error={errors.timezone} hint="Your available times use this time zone." />
        <datalist id={ids.tz}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={ids.stack}>Stack</label>
        {stack.length > 0 && (
          <ul className="stack-list editable">
            {stack.map((t) => (
              <li key={t}>
                <StackTag tag={t} />
                <button type="button" className="tag-remove" aria-label={`Remove ${t}`} onClick={() => setStack(stack.filter((x) => x !== t))}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input id={ids.stack} className="input" value={stackText} list={`${ids.stack}-list`} onChange={(e) => setStackText(e.target.value)}
          onKeyDown={onStackKey} disabled={stack.length >= PROFILE_LIMITS.stackTags} maxLength={PROFILE_LIMITS.stackTagLength}
          placeholder={stack.length >= PROFILE_LIMITS.stackTags ? 'You added 10. Remove one to add another.' : 'Python, React, Docker…'}
          aria-describedby={`${ids.stack}-hint`} spellCheck={false} />
        <datalist id={`${ids.stack}-list`}>{KNOWN_STACKS.map((s) => <option key={s} value={s} />)}</datalist>
        <span className="field-hint" id={`${ids.stack}-hint`}>Up to 10. Press Enter after each one.</span>
        {errors.stack && <span className="field-error" role="alert">{errors.stack}</span>}
      </div>

      <fieldset className="field slots">
        <legend className="field-label">Available times</legend>
        {slots.length === 0 && <p className="field-hint">No times yet. Add the times you could practise each week.</p>}
        {slots.length > 0 && (
          <ul className="slot-list">
            {slots.map((s, i) => (
              <li key={i} className="slot-row">
                <select className="select" aria-label={`Day for time ${i + 1}`} value={s.day}
                  onChange={(e) => setSlot(i, { day: Number(e.target.value) as AvailabilitySlot['day'] })}>
                  {WEEK.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                </select>
                <select className="select num" aria-label={`Start of time ${i + 1}`} value={s.from}
                  onChange={(e) => setSlot(i, { from: e.target.value })}>
                  {halfHourTimes(s.from).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="muted">to</span>
                <select className="select num" aria-label={`End of time ${i + 1}`} value={s.to}
                  onChange={(e) => setSlot(i, { to: e.target.value })}>
                  {halfHourTimes(s.to).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Button variant="quiet" aria-label={`Remove time ${i + 1}`} onClick={() => setSlots(slots.filter((_, k) => k !== i))}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="row-actions">
          <Button variant="secondary" disabled={slots.length >= PROFILE_LIMITS.availabilitySlots}
            onClick={() => setSlots([...slots, { day: 1, from: '19:00', to: '20:00' }])}>Add a time</Button>
        </div>
        {errors.availability && <span className="field-error" role="alert">{errors.availability}</span>}
      </fieldset>

      <TextArea label="About you (optional)" className="textarea-short" rows={3} value={bio} maxLength={PROFILE_LIMITS.bio}
        onChange={(e) => setBio(e.target.value)} error={errors.bio}
        hint={`What you work on, or what you want to practise. ${bio.length} of ${PROFILE_LIMITS.bio} characters.`} />

      {formError && <Notice tone="error" title={formError} />}
      <div className="form-actions">
        {onCancel && <Button variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button variant="primary" type="submit" busy={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
