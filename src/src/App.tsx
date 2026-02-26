import { useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { DemoInterface } from './components/DemoInterface';

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'demo'>('landing');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {currentView === 'landing' ? (
        <LandingPage onNavigateToDemo={() => setCurrentView('demo')} />
      ) : (
        <DemoInterface onNavigateBack={() => setCurrentView('landing')} />
      )}
    </div>
  );
}
