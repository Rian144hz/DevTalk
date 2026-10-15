/// <reference types="vite/client" />
// The nine default profile pictures (ipaslogo.com, see docs/design/mascots/SOURCE.md), bundled with the app.
import { MASCOTS, type MascotId } from '../../core/social/types';

const files = import.meta.glob<string>('../assets/mascots/*.webp', { eager: true, query: '?url', import: 'default' });

export const MASCOT_URLS = Object.fromEntries(
  MASCOTS.map((id) => [id, files[`../assets/mascots/${id}.webp`]!]),
) as Record<MascotId, string>;

export const MASCOT_NAMES: Record<MascotId, string> = {
  'duck-1': 'Rubber duck',
  'duck-2': 'Duck',
  'duck-3': 'Yellow duckling',
  'bear-1': 'Brown bear',
  'bear-2': 'Cream brown bear',
  'bear-3': 'Giant panda',
  'axolotl-1': 'Axolotl',
  'axolotl-2': 'Baby axolotl',
  'axolotl-3': 'Pink axolotl',
};
