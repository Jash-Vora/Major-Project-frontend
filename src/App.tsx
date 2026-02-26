import { useState } from 'react';
import { LandingPage } from './components/LandingPage';
import VideoAnalyzer from './components/VideoAnalyzer';
import VQAPage from './components/VQAPage';

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'analyzer' | 'vqa'>('landing');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {currentView === 'landing' ? (
        <LandingPage
          onNavigateToDemo={() => setCurrentView('analyzer')}
          onNavigateToVQA={() => setCurrentView('vqa')}
        />
      ) : currentView === 'analyzer' ? (
        <VideoAnalyzer onBack={() => setCurrentView('landing')} />
      ) : (
        <VQAPage onBack={() => setCurrentView('landing')} />
      )}
    </div>
  );
}