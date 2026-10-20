import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_MODELS, type ProviderId } from '../../shared/providers';
import { useRoute } from '../lib/useRoute';
import { useThemeEffect } from '../lib/useTheme';
import type { RouteName } from '../lib/router';
import { AppDataProvider, useAppData } from './AppData';
import { Rail } from './Rail';
import { CommandPalette } from './CommandPalette';
import type { Command } from '../lib/commands';
import { api } from '../lib/api';
import type { Theme } from '../../core/ports';
import { ComponentsScreen } from '../screens/ComponentsScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { PracticeScreen } from '../screens/PracticeScreen';
import { FeedbackRoute } from '../screens/FeedbackScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { LaterScreen } from '../screens/LaterScreen';
import { JoinScreen } from '../screens/JoinScreen';
import { LegalScreen, type LegalDoc } from '../screens/LegalScreen';
import { PeopleScreen } from '../screens/PeopleScreen';
import { ModerationScreen } from '../screens/ModerationScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
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
  join: 'Join the community', legal: 'Terms and privacy', moderation: 'Moderation',
};

/** Ctrl+1…Ctrl+8 follow the sidebar order. */
const SHORTCUT_ROUTES: RouteName[] = ['home', 'practice', 'review', 'people', 'messages', 'rooms', 'progress', 'settings'];

function Shell() {
  const { profile, dueCount, refresh, unread, setUnread } = useAppData();
  const [route, navigate] = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moderator, setModerator] = useState(false);
  useThemeEffect(profile?.theme ?? 'dark');

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
    const go = (name: RouteName) => () => navigate({ name });
    const theme = (t: Theme) => () => void api().settings.set({ theme: t }).then(() => refresh());
    return [
      { id: 'go-home', label: 'Go to Home', keywords: ['today'], shortcut: 'Ctrl 1', run: go('home') },
      { id: 'go-practice', label: 'Go to Practice', keywords: ['write', 'answer'], shortcut: 'Ctrl 2', run: go('practice') },
      { id: 'go-review', label: 'Go to Review', keywords: ['cards', 'expressions'], shortcut: 'Ctrl 3', run: go('review') },
      { id: 'go-people', label: 'Go to People', keywords: ['partners', 'members'], shortcut: 'Ctrl 4', run: go('people') },
      { id: 'go-messages', label: 'Go to Messages', keywords: ['chat', 'conversations', 'requests'], shortcut: 'Ctrl 5', run: go('messages') },
      { id: 'go-members', label: 'Go to Members', keywords: ['people', 'members', 'find', 'directory'], run: go('people') },
      { id: 'go-following', label: 'Go to Following', keywords: ['people', 'follow'], run: () => navigate({ name: 'people', sub: 'following' }) },
      { id: 'go-rooms', label: 'Go to Rooms', keywords: ['voice'], shortcut: 'Ctrl 6', run: go('rooms') },
      { id: 'go-progress', label: 'Go to Progress', keywords: ['history', 'stats'], shortcut: 'Ctrl 7', run: go('progress') },
      { id: 'go-settings', label: 'Go to Settings', keywords: ['preferences', 'key', 'model', 'coach'], shortcut: 'Ctrl 8', run: go('settings') },
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
      const n = Number(e.key);
      const target = SHORTCUT_ROUTES[n - 1];
      if (Number.isInteger(n) && target) {
        e.preventDefault();
        setPaletteOpen(false);
        navigate({ name: target });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    document.title = 'DevTalk';
  }, []);

  if (profile === undefined) return null;
  if (profile === null) return <OnboardingScreen />;

  const name: RouteName = route.name === 'onboarding' ? 'home' : route.name;
  const provider = profile.provider as ProviderId;
  return (
    <div className="app">
      <Rail active={name === 'join' ? 'people' : name} dueCount={dueCount} unread={unread} provider={provider} model={profile.model || DEFAULT_MODELS[provider]}
        moderator={moderator} onOpenPalette={() => setPaletteOpen(true)} />
      {name === 'components' && GALLERY ? <ComponentsScreen />
        : name === 'home' ? <HomeScreen key={route.id ?? 0} />
        : name === 'practice' ? <PracticeScreen />
        : name === 'feedback' && route.id ? <FeedbackRoute id={route.id} onNext={() => { window.location.hash = '#/practice'; }} />
        : name === 'review' ? <ReviewScreen />
        : name === 'progress' ? <ProgressScreen />
        : name === 'people' ? <PeopleScreen route={route} />
        : name === 'messages' ? <MessagesScreen route={route} />
        : name === 'join' ? <JoinScreen />
        : name === 'legal' ? <LegalScreen doc={(route.sub ?? 'terms') as LegalDoc} />
        : name === 'rooms' ? <LaterScreen which="rooms" />
        : name === 'moderation' ? <ModerationScreen />
        : name === 'settings' ? <SettingsScreen profile={profile} />
        : <Placeholder title={SCREEN_TITLES[name]} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

export function App() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  );
}
