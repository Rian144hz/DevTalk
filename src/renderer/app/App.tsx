import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MODELS, type ProviderId } from '../../shared/providers';
import { routeForShortcut, shortcutLabel } from '../lib/nav';
import { useRoute } from '../lib/useRoute';
import { startTheme, useThemeEffect } from '../lib/useTheme';
import type { RouteName } from '../lib/router';
import { AppDataProvider, useAppData } from './AppData';
import { Rail } from './Rail';
import { FirstRun } from './FirstRun';
import { Splash } from './Splash';
import { CommandPalette } from './CommandPalette';
import type { Command } from '../lib/commands';
import { api } from '../lib/api';
import { Button, Notice } from '../design-system';
import type { Theme } from '../../core/ports';
import { ComponentsScreen } from '../screens/ComponentsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { PracticeScreen } from '../screens/PracticeScreen';
import { CheckScreen } from '../screens/CheckScreen';
import { FeedbackRoute } from '../screens/FeedbackScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { JoinScreen } from '../screens/JoinScreen';
import { LegalScreen, type LegalDoc } from '../screens/LegalScreen';
import { PeopleScreen } from '../screens/PeopleScreen';
import { ModerationScreen } from '../screens/ModerationScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { RoomsScreen } from '../screens/RoomsScreen';
import { unreadTotal } from '../lib/chat';

/** The component gallery ships only in dev builds (or a build made for screenshots). */
const GALLERY = import.meta.env.DEV || import.meta.env['VITE_COMPONENT_GALLERY'] === '1';

function Placeholder({ title }: { title: string }) {
  return (
    <main className="page">
      <h1>{title}</h1>
    </main>
  );
}

const SCREEN_TITLES: Record<RouteName, string> = {
  onboarding: 'Set up your coach', home: 'Today', practice: 'Practice', feedback: 'Feedback', review: 'Review',
  progress: 'Progress', settings: 'Settings', people: 'People', messages: 'Messages', rooms: 'Rooms', components: 'Components',
  join: 'Join the community', legal: 'Terms and privacy', moderation: 'Moderation', check: 'Check',
};

/** A palette row's shortcut hint, from the sidebar list (the same one Ctrl+digit follows). */
const hint = (route: RouteName) => shortcutLabel(route) ?? undefined;

/** `started`: the launch splash is over. The first screen also waits for the profile, whichever ends last. */
function Shell({ started }: { started: boolean }) {
  const { profile, loadFailed, dueCount, refresh, unread, setUnread, room } = useAppData();
  // Inside a voice room, every way to Rooms leads back to that room; only leaving the Rooms screen (or Leave) ends it.
  const roomRef = useRef(room);
  roomRef.current = room;
  const [route, navigate] = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moderator, setModerator] = useState(false);
  // Until a profile gives its own (and on the first run), the theme of the last run, else the system's.
  const [fallbackTheme] = useState(startTheme);
  useThemeEffect(profile?.theme ?? fallbackTheme, profile != null);

  // The Messages count: on navigation and on every live chat change. No community account means 0.
  useEffect(() => {
    if (!profile) return;
    let alive = true;
    const load = () => void api().chat.conversations().then((r) => alive && setUnread(r.ok ? unreadTotal(r.data) : 0));
    load();
    const off = api().chat.onEvent((e) => {
      if (e.kind !== 'offline') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [profile, route.name, route.conversationId, setUnread]);

  // Re-checked on navigation: signing in, out or deleting the account changes it.
  useEffect(() => {
    if (!profile) return;
    void api().moderation.isModerator().then((r) => setModerator(r.ok && r.data));
  }, [profile, route.name]);

  const commands = useMemo<Command[]>(() => {
    const go = (name: RouteName) => () => navigate(name === 'rooms' && roomRef.current ? { name, roomId: roomRef.current } : { name });
    const theme = (t: Theme) => () => void api().settings.set({ theme: t }).then(() => refresh());
    return [
      { id: 'go-home', label: 'Go to Home', keywords: ['today'], shortcut: hint('home'), run: go('home') },
      { id: 'go-practice', label: 'Go to Practice', keywords: ['write', 'answer'], shortcut: hint('practice'), run: go('practice') },
      { id: 'go-check', label: 'Go to Check', keywords: ['text', 'correct', 'email', 'slack', 'pull request', 'commit'], shortcut: hint('check'), run: go('check') },
      { id: 'go-review', label: 'Go to Review', keywords: ['cards', 'expressions'], shortcut: hint('review'), run: go('review') },
      { id: 'go-people', label: 'Go to People', keywords: ['partners', 'members'], shortcut: hint('people'), run: go('people') },
      { id: 'go-messages', label: 'Go to Messages', keywords: ['chat', 'conversations', 'requests'], shortcut: hint('messages'), run: go('messages') },
      { id: 'go-members', label: 'Go to Members', keywords: ['people', 'members', 'find', 'directory'], run: go('people') },
      { id: 'go-following', label: 'Go to Following', keywords: ['people', 'follow'], run: () => navigate({ name: 'people', sub: 'following' }) },
      { id: 'go-rooms', label: 'Go to Rooms', keywords: ['voice', 'talk', 'speak', 'call', 'audio'], shortcut: hint('rooms'), run: go('rooms') },
      { id: 'go-progress', label: 'Go to Progress', keywords: ['history', 'stats'], shortcut: hint('progress'), run: go('progress') },
      { id: 'go-settings', label: 'Go to Settings', keywords: ['preferences', 'key', 'model', 'coach'], shortcut: hint('settings'), run: go('settings') },
      { id: 'new-challenge', label: 'Get a new challenge', keywords: ['practice'], run: go('practice') },
      { id: 'start-review', label: 'Start review', keywords: ['cards'], run: go('review') },
      { id: 'theme-dark', label: 'Switch to dark theme', keywords: ['appearance'], run: theme('dark') },
      { id: 'theme-light', label: 'Switch to light theme', keywords: ['appearance'], run: theme('light') },
      { id: 'theme-system', label: 'Use the system theme', keywords: ['appearance', 'dark', 'light'], run: theme('system') },
      { id: 'edit-profile', label: 'Edit my profile', keywords: ['people', 'photo', 'stack'], run: () => navigate({ name: 'people', sub: 'edit' }) },
      ...(moderator ? [{ id: 'go-moderation', label: 'Go to Moderation', keywords: ['reports', 'safety'], run: go('moderation') }] : []),
    ];
  }, [navigate, refresh, moderator]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const target = routeForShortcut(e.key);
      if (target) {
        e.preventDefault();
        setPaletteOpen(false);
        navigate(target === 'rooms' && roomRef.current ? { name: target, roomId: roomRef.current } : { name: target });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    document.title = 'DevTalk';
  }, []);

  if (!started) return null;
  // The data failing to load never holds the splash; once it is over, the person can try again.
  if (profile === undefined) {
    return loadFailed
      ? <main className="page"><Notice tone="error" title="Could not load your data." action={<Button variant="secondary" onClick={() => void refresh().catch(() => undefined)}>Try again</Button>} /></main>
      : null;
  }
  // First run: no coach profile on this computer yet.
  if (profile === null) return <FirstRun />;

  const name: RouteName = route.name === 'onboarding' ? 'home' : route.name;
  const provider = profile.provider as ProviderId;
  return (
    <div className="app">
      <Rail active={name === 'join' ? 'people' : name} dueCount={dueCount} unread={unread} provider={provider} model={profile.model || DEFAULT_MODELS[provider]}
        moderator={moderator} room={room} onOpenPalette={() => setPaletteOpen(true)} />
      {name === 'components' && GALLERY ? <ComponentsScreen />
        : name === 'home' ? <HomeScreen key={route.id ?? 0} />
        : name === 'practice' ? <PracticeScreen daily={route.sub === 'daily'} />
        : name === 'check' ? <CheckScreen />
        : name === 'feedback' && route.id ? <FeedbackRoute id={route.id} onNext={() => { window.location.hash = '#/practice'; }} />
        : name === 'review' ? <ReviewScreen />
        : name === 'progress' ? <ProgressScreen />
        : name === 'people' ? <PeopleScreen route={route} />
        : name === 'messages' ? <MessagesScreen route={route} />
        : name === 'join' ? <JoinScreen />
        : name === 'legal' ? <LegalScreen doc={(route.sub ?? 'terms') as LegalDoc} />
        : name === 'rooms' ? <RoomsScreen />
        : name === 'moderation' ? <ModerationScreen />
        : name === 'settings' ? <SettingsScreen profile={profile} />
        : <Placeholder title={SCREEN_TITLES[name]} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

export function App() {
  // On every launch the splash goes first; the data loads underneath and never holds it up.
  const [splash, setSplash] = useState(true);
  const endSplash = useCallback(() => setSplash(false), []);
  return (
    <AppDataProvider>
      <Shell started={!splash} />
      {splash && <Splash onDone={endSplash} />}
    </AppDataProvider>
  );
}
