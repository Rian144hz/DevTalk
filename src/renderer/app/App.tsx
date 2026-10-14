import { useEffect, useState } from 'react';
import { DEFAULT_MODELS, type ProviderId } from '../../shared/providers';
import { useRoute } from '../lib/useRoute';
import { useThemeEffect } from '../lib/useTheme';
import type { RouteName } from '../lib/router';
import { AppDataProvider, useAppData } from './AppData';
import { Rail } from './Rail';
import { ComponentsScreen } from '../screens/ComponentsScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { PracticeScreen } from '../screens/PracticeScreen';
import { FeedbackRoute } from '../screens/FeedbackScreen';

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

function Shell() {
  const { profile, dueCount } = useAppData();
  const [route] = useRoute();
  const [, setPaletteOpen] = useState(false);
  useThemeEffect(profile?.theme ?? 'dark');

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
        : name === 'settings' ? <SettingsScreen profile={profile} />
        : <Placeholder title={SCREEN_TITLES[name]} />}
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
