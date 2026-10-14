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
  progress: 'Progress', settings: 'Settings', people: 'People', rooms: 'Rooms', components: 'Components',
};

/** Ctrl+1…Ctrl+7 follow the sidebar order. */
const SHORTCUT_ROUTES: RouteName[] = ['home', 'practice', 'review', 'people', 'rooms', 'progress', 'settings'];

function Shell() {
  const { profile, dueCount, refresh } = useAppData();
  const [route, navigate] = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useThemeEffect(profile?.theme ?? 'dark');

  const commands = useMemo<Command[]>(() => {
    const go = (name: RouteName) => () => navigate({ name });
    const theme = (t: Theme) => () => void api().settings.set({ theme: t }).then(() => refresh());
    return [
      { id: 'go-home', label: 'Go to Home', keywords: ['today'], shortcut: 'Ctrl 1', run: go('home') },
      { id: 'go-practice', label: 'Go to Practice', keywords: ['write', 'answer'], shortcut: 'Ctrl 2', run: go('practice') },
      { id: 'go-review', label: 'Go to Review', keywords: ['cards', 'expressions'], shortcut: 'Ctrl 3', run: go('review') },
      { id: 'go-people', label: 'Go to People', keywords: ['partners', 'chat'], shortcut: 'Ctrl 4', run: go('people') },
      { id: 'go-rooms', label: 'Go to Rooms', keywords: ['voice'], shortcut: 'Ctrl 5', run: go('rooms') },
      { id: 'go-progress', label: 'Go to Progress', keywords: ['history', 'stats'], shortcut: 'Ctrl 6', run: go('progress') },
      { id: 'go-settings', label: 'Go to Settings', keywords: ['preferences', 'key', 'model', 'coach'], shortcut: 'Ctrl 7', run: go('settings') },
      { id: 'new-challenge', label: 'Get a new challenge', keywords: ['practice'], run: go('practice') },
      { id: 'start-review', label: 'Start review', keywords: ['cards'], run: go('review') },
      { id: 'theme-dark', label: 'Switch to dark theme', keywords: ['appearance'], run: theme('dark') },
      { id: 'theme-light', label: 'Switch to light theme', keywords: ['appearance'], run: theme('light') },
      { id: 'theme-system', label: 'Use the system theme', keywords: ['appearance', 'dark', 'light'], run: theme('system') },
    ];
  }, [navigate, refresh]);

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
      <Rail active={name} dueCount={dueCount} provider={provider} model={profile.model || DEFAULT_MODELS[provider]}
        onOpenPalette={() => setPaletteOpen(true)} />
      {name === 'components' && GALLERY ? <ComponentsScreen />
        : name === 'home' ? <HomeScreen key={route.id ?? 0} />
        : name === 'practice' ? <PracticeScreen />
        : name === 'feedback' && route.id ? <FeedbackRoute id={route.id} onNext={() => { window.location.hash = '#/practice'; }} />
        : name === 'review' ? <ReviewScreen />
        : name === 'progress' ? <ProgressScreen />
        : name === 'people' || name === 'rooms' ? <LaterScreen which={name} />
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
