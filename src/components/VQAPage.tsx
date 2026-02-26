import { useEffect, useRef, useState, useCallback } from 'react';

interface VQAPageProps {
  onBack?: () => void;
}

type StatusPhase = 'idle' | 'camera' | 'listening' | 'thinking' | 'speaking' | 'error';

interface QAEntry {
  id: number;
  question: string;
  answer: string;
  timestamp: string;
  imageSnapshot?: string;
}

export default function VQAPage({ onBack }: VQAPageProps) {
  const [apiUrl, setApiUrl] = useState<string>('http://localhost:5000');
  const [phase, setPhase] = useState<StatusPhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [qaHistory, setQaHistory] = useState<QAEntry[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [isMicSupported, setIsMicSupported] = useState<boolean>(true);
  const [isRecognizing, setIsRecognizing] = useState<boolean>(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const entryIdRef = useRef<number>(0);
  const phaseRef = useRef<StatusPhase>('idle');

  // Keep phaseRef in sync
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Load saved API URL + check speech support
  useEffect(() => {
    const saved = localStorage.getItem('vqa_apiUrl');
    if (saved) setApiUrl(saved);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) setIsMicSupported(false);

    return () => { stopEverything(); };
  }, []);

  // ── KEY FIX: assign srcObject via useEffect whenever mediaStream changes ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !mediaStream) return;

    if (videoEl.srcObject !== mediaStream) {
      videoEl.srcObject = mediaStream;
    }

    const tryPlay = async () => {
      try {
        await videoEl.play();
      } catch (e) {
        console.warn('Camera play() failed:', e);
      }
    };

    if (videoEl.readyState >= 2) {
      void tryPlay();
    } else {
      videoEl.onloadedmetadata = () => void tryPlay();
    }

    return () => {
      if (videoEl.onloadedmetadata) videoEl.onloadedmetadata = null;
    };
  }, [mediaStream]);

  const stopEverything = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    setMediaStream(null);
    setIsRecognizing(false);
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setMediaStream(stream); // triggers useEffect above to assign srcObject
      setPhase('camera');
    } catch (err: any) {
      setErrorMsg(`Camera error: ${err.message}`);
      setPhase('error');
    }
  };

  const captureFrame = (): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const speakText = (text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      utterance.volume = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  };

  const sendVQARequest = async (imageData: string, question: string): Promise<string> => {
    const base64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
    const response = await fetch(`${apiUrl}/vqa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: base64, question }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const data = await response.json();
    return data.answer ?? data.result?.answer ?? 'I could not determine an answer.';
  };

  const handleQuestion = useCallback(async (question: string) => {
    if (!question.trim()) return;
    setCurrentTranscript(question);
    setPhase('thinking');

    const snapshot = captureFrame();

    try {
      const answer = await sendVQARequest(snapshot ?? '', question);
      setCurrentAnswer(answer);
      setPhase('speaking');

      entryIdRef.current += 1;
      const entry: QAEntry = {
        id: entryIdRef.current,
        question,
        answer,
        timestamp: new Date().toLocaleTimeString(),
        imageSnapshot: snapshot ?? undefined,
      };
      setQaHistory(prev => [entry, ...prev].slice(0, 20));

      await speakText(answer);
      setPhase('camera');
      setCurrentTranscript('');
      setCurrentAnswer('');
    } catch (err: any) {
      setErrorMsg(`VQA error: ${err.message}`);
      setPhase('error');
    }
  }, [apiUrl]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg('Speech recognition not supported. Use Chrome or Edge.');
      setPhase('error');
      return;
    }
    if (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') return;

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsRecognizing(true);
      setPhase('listening');
      setCurrentTranscript('');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      setCurrentTranscript(final || interim);
      if (final) {
        recognition.stop();
        handleQuestion(final.trim());
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        setPhase('camera');
        setIsRecognizing(false);
        return;
      }
      setErrorMsg(`Mic error: ${event.error}`);
      setPhase('error');
      setIsRecognizing(false);
    };

    recognition.onend = () => {
      setIsRecognizing(false);
      recognitionRef.current = null;
    };

    recognition.start();
  }, [handleQuestion]);

  const stopListening = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setPhase('camera');
    setIsRecognizing(false);
  };

  const handleStop = () => {
    stopEverything();
    setPhase('idle');
    setCurrentTranscript('');
    setCurrentAnswer('');
  };

  const phaseColors: Record<StatusPhase, string> = {
    idle: '#6366f1',
    camera: '#10b981',
    listening: '#f59e0b',
    thinking: '#8b5cf6',
    speaking: '#3b82f6',
    error: '#ef4444',
  };

  const phaseLabels: Record<StatusPhase, string> = {
    idle: 'Ready',
    camera: 'Camera Active — Press mic to ask',
    listening: 'Listening...',
    thinking: 'Thinking...',
    speaking: 'Speaking answer...',
    error: 'Error',
  };

  const phaseIcons: Record<StatusPhase, string> = {
    idle: '◎',
    camera: '●',
    listening: '🎤',
    thinking: '⟳',
    speaking: '🔊',
    error: '⚠',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e8e8f0', fontFamily: "'IBM Plex Mono', 'Courier New', monospace" }}>
      {/* Ambient background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `radial-gradient(ellipse 60% 40% at 20% 20%, rgba(99,102,241,0.08) 0%, transparent 70%),
                     radial-gradient(ellipse 50% 60% at 80% 80%, rgba(139,92,246,0.06) 0%, transparent 70%)`
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 20 }}>
          <button
            onClick={onBack}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#a0a0b8', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, letterSpacing: '0.05em' }}
          >
            ← BACK
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '0.08em', color: '#e8e8f0' }}>
              VOICE <span style={{ color: '#6366f1' }}>×</span> VISUAL QA
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: '#6060a0', letterSpacing: '0.12em', marginTop: 4 }}>
              ASK ANYTHING ABOUT WHAT YOU SEE
            </p>
          </div>
          {/* Status indicator */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: phaseColors[phase],
              boxShadow: `0 0 12px ${phaseColors[phase]}`,
              animation: ['listening', 'thinking'].includes(phase) ? 'pulse 1s infinite' : 'none'
            }} />
            <span style={{ fontSize: 12, color: '#8080b0', letterSpacing: '0.08em' }}>
              {phaseLabels[phase].toUpperCase()}
            </span>
          </div>
        </div>

        {/* API URL config */}
        <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: '#6060a0', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>API URL</label>
          <input
            type="text"
            value={apiUrl}
            onChange={e => { setApiUrl(e.target.value); localStorage.setItem('vqa_apiUrl', e.target.value); }}
            placeholder="http://localhost:5000"
            style={{
              flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#c8c8e8', padding: '8px 14px', borderRadius: 8, fontSize: 13,
              fontFamily: 'inherit', outline: 'none', maxWidth: 400
            }}
          />
        </div>

        {/* Main layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

          {/* Left: Camera + Controls */}
          <div>
            {/* Camera viewport */}
            <div style={{
              background: '#0d0d18', borderRadius: 16, overflow: 'hidden',
              border: `1px solid ${phase === 'idle' ? 'rgba(255,255,255,0.08)' : phaseColors[phase] + '44'}`,
              boxShadow: phase !== 'idle' ? `0 0 40px ${phaseColors[phase]}18` : 'none',
              transition: 'border-color 0.3s, box-shadow 0.3s',
              position: 'relative', aspectRatio: '16/9'
            }}>
              {phase === 'idle' ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                  <div style={{ fontSize: 48, opacity: 0.3 }}>◉</div>
                  <div style={{ fontSize: 13, color: '#4040a0', letterSpacing: '0.1em' }}>CAMERA OFFLINE</div>
                  <button
                    onClick={startCamera}
                    style={{
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      border: 'none', color: '#fff', padding: '12px 28px', borderRadius: 10,
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', letterSpacing: '0.08em', fontWeight: 600
                    }}
                  >
                    START CAMERA
                  </button>
                </div>
              ) : (
                <>
                  {/* Video always in DOM once camera starts so ref is ready when stream arrives */}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />

                  {/* Phase overlay — only shown when not in camera phase */}
                  {phase !== 'camera' && (
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(10,10,20,0.65)', backdropFilter: 'blur(2px)'
                    }}>
                      <div style={{
                        fontSize: 40, marginBottom: 12,
                        animation: phase === 'thinking' ? 'spin 1s linear infinite' : 'none'
                      }}>
                        {phaseIcons[phase]}
                      </div>
                      <div style={{ fontSize: 14, color: phaseColors[phase], letterSpacing: '0.1em', fontWeight: 700 }}>
                        {phaseLabels[phase].toUpperCase()}
                      </div>
                      {currentTranscript && (
                        <div style={{
                          marginTop: 16, padding: '10px 20px', background: 'rgba(255,255,255,0.07)',
                          borderRadius: 8, fontSize: 14, color: '#c0c0e0', maxWidth: '80%', textAlign: 'center',
                          border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                          "{currentTranscript}"
                        </div>
                      )}
                      {currentAnswer && phase === 'speaking' && (
                        <div style={{
                          marginTop: 12, padding: '10px 20px', background: 'rgba(59,130,246,0.15)',
                          borderRadius: 8, fontSize: 13, color: '#93c5fd', maxWidth: '80%', textAlign: 'center',
                          border: '1px solid rgba(59,130,246,0.3)'
                        }}>
                          {currentAnswer}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status badge */}
                  <div style={{
                    position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 8,
                    background: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '4px 12px'
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: phaseColors[phase], boxShadow: `0 0 8px ${phaseColors[phase]}` }} />
                    <span style={{ fontSize: 11, color: '#a0a0c0', letterSpacing: '0.1em' }}>
                      {phaseIcons[phase]} {phase.toUpperCase()}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Controls */}
            {phase !== 'idle' && (
              <div style={{ display: 'flex', gap: 14, marginTop: 20, justifyContent: 'center' }}>
                <button
                  onClick={isRecognizing ? stopListening : startListening}
                  disabled={phase === 'thinking' || phase === 'speaking'}
                  style={{
                    width: 80, height: 80, borderRadius: '50%',
                    background: isRecognizing
                      ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none',
                    cursor: (phase === 'thinking' || phase === 'speaking') ? 'not-allowed' : 'pointer',
                    fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isRecognizing ? '0 0 30px rgba(245,158,11,0.5)' : '0 0 20px rgba(99,102,241,0.35)',
                    opacity: (phase === 'thinking' || phase === 'speaking') ? 0.4 : 1,
                    transition: 'all 0.2s',
                    animation: isRecognizing ? 'ringPulse 1.5s ease-in-out infinite' : 'none'
                  }}
                >
                  🎤
                </button>

                <button
                  onClick={handleStop}
                  style={{
                    width: 52, height: 52, borderRadius: '50%', alignSelf: 'center',
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                    cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#ef4444', transition: 'all 0.2s'
                  }}
                >
                  ■
                </button>
              </div>
            )}

            {phase === 'camera' && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#4040a0', marginTop: 14, letterSpacing: '0.08em' }}>
                PRESS 🎤 AND SPEAK YOUR QUESTION — THE AI WILL ANSWER ALOUD
              </p>
            )}

            {phase === 'error' && (
              <div style={{
                marginTop: 16, padding: '12px 18px', background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
                fontSize: 13, color: '#fca5a5'
              }}>
                ⚠ {errorMsg}
                <button
                  onClick={() => { setPhase('idle'); setErrorMsg(''); }}
                  style={{ marginLeft: 12, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
                >
                  dismiss
                </button>
              </div>
            )}

            {!isMicSupported && (
              <div style={{
                marginTop: 16, padding: '12px 18px', background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10,
                fontSize: 12, color: '#fcd34d', letterSpacing: '0.05em'
              }}>
                ⚠ SPEECH RECOGNITION NOT SUPPORTED — USE CHROME OR EDGE
              </div>
            )}
          </div>

          {/* Right: Q&A History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, color: '#4040a0', letterSpacing: '0.12em', marginBottom: 4 }}>
              Q&A LOG — {qaHistory.length} ENTRIES
            </div>

            {qaHistory.length === 0 ? (
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '40px 20px', textAlign: 'center',
                color: '#3030a0', fontSize: 13, letterSpacing: '0.08em'
              }}>
                NO QUESTIONS YET
                <br />
                <span style={{ fontSize: 11, marginTop: 8, display: 'block', opacity: 0.6 }}>
                  START CAMERA AND ASK SOMETHING
                </span>
              </div>
            ) : (
              <div style={{ maxHeight: 620, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {qaHistory.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12, overflow: 'hidden', borderLeft: '3px solid #6366f1'
                    }}
                  >
                    {entry.imageSnapshot && (
                      <img
                        src={entry.imageSnapshot}
                        alt="snapshot"
                        style={{ width: '100%', height: 120, objectFit: 'cover', opacity: 0.7 }}
                      />
                    )}
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: '#4040a0', letterSpacing: '0.1em', marginBottom: 6 }}>
                        {entry.timestamp}
                      </div>
                      <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 6, letterSpacing: '0.05em' }}>
                        Q: {entry.question}
                      </div>
                      <div style={{ fontSize: 13, color: '#c0d8ff', lineHeight: 1.5 }}>
                        A: {entry.answer}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {qaHistory.length > 0 && (
              <button
                onClick={() => setQaHistory([])}
                style={{
                  background: 'none', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#4040a0', padding: '8px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 11, letterSpacing: '0.08em', fontFamily: 'inherit'
                }}
              >
                CLEAR LOG
              </button>
            )}
          </div>
        </div>

        {/* How to use */}
        <div style={{
          marginTop: 32, padding: '20px 24px',
          background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)',
          borderRadius: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16
        }}>
          {[
            { step: '01', label: 'START CAMERA', desc: 'Point at what you want to ask about' },
            { step: '02', label: 'PRESS 🎤', desc: 'Speak your question clearly' },
            { step: '03', label: 'AI ANALYZES', desc: 'Captures frame + processes with Florence-2' },
            { step: '04', label: 'HEAR ANSWER', desc: 'Response spoken aloud via TTS' },
          ].map(item => (
            <div key={item.step} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6366f1', letterSpacing: '0.15em', marginBottom: 4 }}>{item.step}</div>
              <div style={{ fontSize: 11, color: '#a0a0c0', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: '#4040a0' }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ringPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(245,158,11,0.4), 0 0 0 0 rgba(245,158,11,0.4); }
          50% { box-shadow: 0 0 30px rgba(245,158,11,0.6), 0 0 0 12px rgba(245,158,11,0); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 4px; }
      `}</style>
    </div>
  );
}