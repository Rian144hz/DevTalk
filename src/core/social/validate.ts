import { z } from 'zod';
import { LEVELS } from '../domain/types';
import { AREAS, PROFILE_LIMITS } from './types';
import type { AvailabilitySlot, ProfileDraft } from './types';

const L = PROFILE_LIMITS;

/** Lowercase, trim, collapse inner spaces, drop empties and duplicates, keep the first 10. */
export function normalizeStackTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, L.stackTags);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(TIME);

const SlotSchema = z
  .object({ day: z.number().int().min(0).max(6), from: time, to: time })
  .refine((s) => !TIME.test(s.from) || !TIME.test(s.to) || s.from < s.to, { message: 'A time slot must start before it ends.' }) as unknown as z.ZodType<AvailabilitySlot>;

export const ProfileDraftSchema = z.object({
  displayName: z.string().trim().min(L.displayName.min).max(L.displayName.max),
  nativeLanguage: z.string().trim().min(L.nativeLanguage.min).max(L.nativeLanguage.max),
  level: z.enum(LEVELS),
  timezone: z.string().trim().min(1).max(64),
  area: z.enum(AREAS),
  stack: z.array(z.string().min(1).max(L.stackTagLength)).max(L.stackTags),
  availability: z.array(SlotSchema).max(L.availabilitySlots),
  bio: z.string().max(L.bio),
}) satisfies z.ZodType<ProfileDraft>;
