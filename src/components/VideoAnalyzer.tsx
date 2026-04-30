import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type ApiResults = {
  success?: boolean;
  error?: string;
  results?: {
    video_processing_info?: {
      fps: number;
      total_duration: string;
      processed_duration: string;
      total_frames: number;
      analyzed_frames: number;
    };
    frame_analyses?: Array<{
      timestamp?: string;
      description?: string;
      navigation_description?: string;
      objects?: Array<{
        object: string;
        confidence: number;
      }>;
    }>;
  };
};

type FrameAnalysis = NonNullable<NonNullable<ApiResults['results']>['frame_analyses']>[number];
type DetectedObject = NonNullable<FrameAnalysis['objects']>[number];

type StatusType = 'loading' | 'success' | 'error' | null;

// ── TTS helpers ──────────────────────────────────────────────
// Priority-aware queue:
//   - danger      → cancel everything, speak immediately
//   - scene       → queue, medium urgency (NEW — doc-3 scene fix)
//   - alert       → queue unless already queued
//   - ambient     → drop if queue is backed up (>= 2 items)
//
// FIX (doc-3): queue cap lowered to 2 for ambient so stale messages
// never pile up. Danger still clears everything on arrival.
// FIX (doc-3 scene): "scene" tier treated like alert for queueing purposes.

const ttsQueue: Array<{ text: string; interrupt: boolean; rate: number; volume: number }> = [];
let ttsBusy = false;

function ttsFlush() {
  if (ttsBusy || ttsQueue.length === 0) return;
  const { text, rate, volume } = ttsQueue.shift()!;
  ttsBusy = true;
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US';
  utt.rate = rate;
  utt.volume = volume;
  utt.onend = () => {
    ttsBusy = false;
    ttsFlush();
  };
  utt.onerror = () => {
    ttsBusy = false;
    ttsFlush();
  };
  speechSynthesis.speak(utt);
}

function speakEvent(tier: string, text: string, interrupt: boolean, urgency: number) {
  if (!('speechSynthesis' in window)) return;

  if (interrupt) {
    // Danger — cancel everything and speak immediately
    speechSynthesis.cancel();
    ttsQueue.length = 0;
    ttsBusy = false;
  }

  // FIX: Drop duplicate messages already queued (any tier)
  if (ttsQueue.some((q) => q.text === text)) return;

  // FIX: Cap queue at 2 for ambient — stale navigation hints are useless
  if (ttsQueue.length >= 2 && tier === 'ambient') return;

  // FIX: Also cap alerts at 3 total to prevent pile-up on busy scenes
  if (ttsQueue.length >= 3 && tier === 'alert') return;

  // FIX (doc-3 scene): scene tier — treat like alert, cap at 3 total.
  // Scene changes are meaningful but should not pile up either.
  if (ttsQueue.length >= 3 && tier === 'scene') return;

  ttsQueue.push({
    text,
    interrupt,
    rate: 0.85 + urgency * 0.25, // danger ~1.1x, ambient ~0.85x
    volume: 0.7 + urgency * 0.3,  // danger 1.0, ambient 0.7
  });
  ttsFlush();
}

// ── Types ────────────────────────────────────────────────────

interface SpeechEvent {
  tier: string;
  text: string;
  urgency: number;
  interrupt: boolean;
}

interface VideoAnalyzerProps {
  onBack?: () => void;
}

export default function VideoAnalyzer({ onBack }: VideoAnalyzerProps) {
  const [apiUrl, setApiUrl] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<string>('20');
  const [targetAnalyses, setTargetAnalyses] = useState<string>('8');

  const [statusType, setStatusType] = useState<StatusType>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progressVisible, setProgressVisible] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressLabel, setProgressLabel] = useState<string>('Uploading video...');

  const [resultsVisible, setResultsVisible] = useState<boolean>(false);
  const [results, setResults] = useState<ApiResults | null>(null);

  const [activeTab, setActiveTab] = useState<'summary' | 'frames' | 'raw'>('summary');

  // Camera recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [realTimeAnalysis, setRealTimeAnalysis] = useState<any[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  // Live predictions show individual speech events
  const [livePredictions, setLivePredictions] = useState<
    Array<{ tier: string; text: string; ts: number }>
  >([]);

  const socketRef = useRef<Socket | null>(null);

  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const streamingIntervalRef = useRef<number | null>(null);
  const frameCounterRef = useRef<number>(0);
  const startTimeRef = useRef<number | null>(null);

  // FIX (doc-3): Track last speech time on the frontend too, so we never
  // fire TTS more often than MIN_SILENCE_GAP even if the backend slips.
  const lastSpeechTimeRef = useRef<number>(0);
  const MIN_SPEECH_GAP_MS = 2000; // matches backend MIN_SILENCE_GAP

  useEffect(() => {
    const saved = localStorage.getItem('apiUrl');
    setApiUrl(saved ?? 'http://localhost:5000');
  }, []);

  useEffect(() => {
    if (apiUrl) localStorage.setItem('apiUrl', apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    const videoEl = cameraVideoRef.current;
    if (!videoEl || !mediaStream) return;

    if (videoEl.srcObject !== mediaStream) videoEl.srcObject = mediaStream;

    const tryPlay = async () => {
      try { await videoEl.play(); } catch (e) { console.warn('Camera preview play() failed:', e); }
    };

    if (videoEl.readyState >= 2) void tryPlay();
    else videoEl.onloadedmetadata = () => void tryPlay();

    return () => { if (videoEl.onloadedmetadata) videoEl.onloadedmetadata = null; };
  }, [mediaStream, isCameraActive, isRecording]);

  const summaryText = useMemo(() => {
    if (!results?.results?.frame_analyses) return '';
    const frames = results.results.frame_analyses;
    let summary = `Total Frames Analyzed: ${frames.length}\n\n`;
    frames.forEach((frame: FrameAnalysis, idx: number) => {
      summary += `Frame ${idx + 1} (${frame.timestamp ?? '-'}):\n`;
      summary += `  Description: ${frame.description ?? 'N/A'}\n`;
      summary += `  Navigation: ${(frame as any).navigation_description ?? 'N/A'}\n`;
      if (frame.objects && frame.objects.length > 0) {
        summary += `  Objects Detected: ${frame.objects.length}\n`;
        frame.objects.slice(0, 3).forEach((obj: DetectedObject) => {
          summary += `    - ${obj.object} (${(obj.confidence * 100).toFixed(1)}%)\n`;
        });
      }
      summary += '\n';
    });
    return summary;
  }, [results]);

  const videoInfo = results?.results?.video_processing_info;

  const onDropZoneClick = () => fileInputRef.current?.click();

  const onFileChosen = (file: File) => {
    if (!file.type.startsWith('video/')) { alert('⚠️ Please select a valid video file'); return; }
    if (file.size > 500 * 1024 * 1024) {
      if (!confirm('⚠️ This file is large and may take long to upload/process. Continue?')) return;
    }
    setSelectedFile(file);
    setResultsVisible(false);
    if (previewVideoRef.current) previewVideoRef.current.src = URL.createObjectURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileChosen(file);
  };

  useEffect(() => {
    const dz = dropZoneRef.current;
    if (!dz) return;
    const onDragOver  = (e: DragEvent) => { e.preventDefault(); dz.classList.add('dragover'); };
    const onDragLeave = () => dz.classList.remove('dragover');
    const onDrop      = (e: DragEvent) => {
      e.preventDefault(); dz.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) onFileChosen(file);
    };
    dz.addEventListener('dragover', onDragOver);
    dz.addEventListener('dragleave', onDragLeave);
    dz.addEventListener('drop', onDrop);
    return () => {
      dz.removeEventListener('dragover', onDragOver);
      dz.removeEventListener('dragleave', onDragLeave);
      dz.removeEventListener('drop', onDrop);
    };
  }, []);

  const clearVideo = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (previewVideoRef.current) previewVideoRef.current.src = '';
    setResultsVisible(false);
    setStatusType(null);
    setStatusMessage('');
    setProgressVisible(false);
    setProgressPercent(0);
    stopCamera();
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      setMediaStream(stream);
      setIsCameraActive(true);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        cameraVideoRef.current.onloadedmetadata = async () => {
          try { await cameraVideoRef.current!.play(); } catch (e) { console.warn(e); }
        };
      }

      const newSocket = io(apiUrl || 'http://localhost:5000', { transports: ['polling'], upgrade: false });
      newSocket.on('connect', () => console.log('Connected to backend for streaming'));
      newSocket.on('analysis_result', (data) => {
        setRealTimeAnalysis((prev: any[]) => [...prev.slice(-4), data]);
      });
      newSocket.on('stream_error', (data) => console.error('Streaming error:', data.error));
      setSocket(newSocket);
      socketRef.current = newSocket;
    } catch (err: any) {
      alert(`⚠️ Error accessing camera: ${err.message || 'Camera access denied'}`);
    }
  };

  const stopCamera = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      setMediaStream(null);
      setIsCameraActive(false);
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    }
    if (streamingIntervalRef.current) { clearInterval(streamingIntervalRef.current); streamingIntervalRef.current = null; }
    frameCounterRef.current = 0;
    if (socket) { socket.disconnect(); setSocket(null); }
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    setIsRecording(false);
    setIsStreaming(false);
    setRecordingTime(0);
    setRealTimeAnalysis([]);
    setLivePredictions([]);
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    ttsQueue.length = 0;
    ttsBusy = false;
    lastSpeechTimeRef.current = 0;
  };

  // ── Frame streaming ──────────────────────────────────────────
  // FIX (doc-3): Send realtime:true so backend can apply scene sampling logic.
  // FIX (doc-3 scene): Backend now samples Florence-2 every ~5s even in
  // realtime mode, so scene_change events will arrive here naturally.
  // The frontend just needs to handle the new "scene" tier in speakEvent.
  const startFrameStreaming = () => {
    if (!cameraVideoRef.current || !apiUrl) return;
    if (streamingIntervalRef.current) { clearInterval(streamingIntervalRef.current); streamingIntervalRef.current = null; }
    frameCounterRef.current = 0;

    // Reset backend spatial memory for a fresh session
    fetch(`${apiUrl}/session/reset`, { method: 'POST' }).catch(() => {});

    streamingIntervalRef.current = window.setInterval(async () => {
      const videoEl = cameraVideoRef.current;
      if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;

      const canvas = captureCanvasRef.current ?? document.createElement('canvas');
      captureCanvasRef.current = canvas;
      canvas.width  = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      try {
        const response = await fetch(`${apiUrl}/analyze/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_data:  canvas.toDataURL('image/jpeg', 0.7).split(',')[1],
            mode:        'comprehensive',
            detail_level:'detailed',
            realtime:    true,  // FIX (doc-3 scene): tells backend to use sampled Florence-2
          }),
        });

        const data = await response.json();

        const events: SpeechEvent[] = data.speech_events ?? [];

        if (events.length > 0) {
          const now = Date.now();

          // FIX (doc-3): Client-side silence gap guard — mirrors backend MIN_SILENCE_GAP
          const gapOk = (now - lastSpeechTimeRef.current) >= MIN_SPEECH_GAP_MS;

          // Danger bypasses the gap check (it's already interrupt=true)
          // FIX (doc-3 scene): scene tier also bypasses gap — it fires rarely (every 5s+)
          const hasDanger = events.some((e) => e.tier === 'danger');
          const hasScene  = events.some((e) => e.tier === 'scene');

          if (hasDanger || hasScene || gapOk) {
            // Update the live predictions log
            setLivePredictions((prev) => [
              ...prev.slice(-9),
              ...events.map((e) => ({ tier: e.tier, text: e.text, ts: now })),
            ]);

            for (const evt of events) {
              speakEvent(evt.tier, evt.text, evt.interrupt, evt.urgency);
            }

            lastSpeechTimeRef.current = now;
          }
        }
      } catch (err) {
        console.error('Frame analysis error:', err);
      }
    }, 2000); // 2 s — polite to GPU and matches ALERT_DEBOUNCE
  };

  const startRecording = () => {
    if (!mediaStream) { alert('⚠️ Please start camera first'); return; }
    const videoEl = cameraVideoRef.current;
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
      alert('⚠️ Camera is still starting. Please wait a second and try again.'); return;
    }

    recordedChunksRef.current = [];
    setRecordedChunks([]);

    try {
      let options: MediaRecorderOptions = {};
      for (const mt of ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4']) {
        if (MediaRecorder.isTypeSupported(mt)) { options = { mimeType: mt }; break; }
      }

      const mediaRecorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const mimeType  = mediaRecorder.mimeType || 'video/webm';
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob      = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size === 0) { alert('⚠️ Recording was empty. Please try again.'); return; }
        const file = new File([blob], `recording-${Date.now()}.${extension}`, { type: mimeType });
        onFileChosen(file);
      };

      mediaRecorder.start(500);
      setIsRecording(true);
      setIsStreaming(true);
      setRecordingTime(0);
      startFrameStreaming();

      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime((prev: number) => prev + 1);
      }, 1000);
    } catch (err: any) {
      alert(`⚠️ Error starting recording: ${err.message || 'Recording failed'}`);
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr || !isRecording) return;
    try { mr.requestData(); } catch {}
    window.setTimeout(() => { try { mr.stop(); } catch {} }, 200);

    setIsRecording(false);
    setIsStreaming(false);
    if (recordingIntervalRef.current)  { clearInterval(recordingIntervalRef.current);  recordingIntervalRef.current = null; }
    if (streamingIntervalRef.current)  { clearInterval(streamingIntervalRef.current);  streamingIntervalRef.current = null; }
    if ('speechSynthesis' in window)   speechSynthesis.cancel();
    ttsQueue.length = 0;
    ttsBusy = false;
    lastSpeechTimeRef.current = 0;
  };

  useEffect(() => { return () => { stopCamera(); }; }, []);

  const showStatus   = (message: string, type: StatusType) => { setStatusMessage(message); setStatusType(type); };
  const showProgress = (percent: number, label?: string)   => { setProgressVisible(true); setProgressPercent(percent); if (label) setProgressLabel(label); };
  const hideProgress = () => setProgressVisible(false);

  const analyzeVideo = async () => {
    if (!selectedFile) { alert('⚠️ Please select a video file first'); return; }
    const url = apiUrl.trim();
    if (!url) { alert('⚠️ Please enter your backend API URL'); return; }

    try {
      setResultsVisible(false);
      setResults(null);
      showStatus('⏳ Uploading video... This may take a few minutes depending on file size.', 'loading');
      showProgress(0, 'Uploading video...');
      startTimeRef.current = Date.now();

      const formData = new FormData();
      formData.append('video', selectedFile);
      if (duration) formData.append('duration', duration);
      formData.append('target_analyses', targetAnalyses || '8');

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) showProgress((e.loaded / e.total) * 50, 'Uploading video...');
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          showProgress(100, 'Complete!');
          const data: ApiResults = JSON.parse(xhr.responseText);
          showStatus('✅ Video analysis complete!', 'success');
          setTimeout(() => hideProgress(), 1000);
          setResults(data);
          setResultsVisible(true);
        } else {
          let errorMsg = 'Unknown error';
          try { errorMsg = (JSON.parse(xhr.responseText).error as string) || errorMsg; } catch {}
          showStatus(`❌ Error: ${errorMsg}`, 'error');
          hideProgress();
        }
      });

      xhr.addEventListener('error', () => {
        showStatus('❌ Network error. Please check your connection and try again.', 'error');
        hideProgress();
      });

      xhr.upload.addEventListener('loadend', () => {
        showProgress(50, 'Processing video frames...');
        showStatus('⏳ Processing video frames with AI models... This may take several minutes.', 'loading');
        let progress = 50;
        const interval = setInterval(() => {
          if (xhr.readyState === 4) { clearInterval(interval); }
          else { progress += 2; if (progress < 95) showProgress(progress, 'Analyzing frames...'); }
        }, 2000);
      });

      xhr.open('POST', `${url}/analyze/video`);
      xhr.send(formData);
    } catch (err: any) {
      showStatus(`❌ Error: ${err?.message ?? 'Unknown error'}`, 'error');
      hideProgress();
    }
  };

  const processingTime = useMemo(() => {
    if (!startTimeRef.current || !resultsVisible) return '-';
    return `${((Date.now() - startTimeRef.current) / 1000).toFixed(1)}s`;
  }, [resultsVisible]);

  // ── Tier label helpers ────────────────────────────────────
  // FIX (doc-3 scene): added "scene" tier with its own colour + icon
  const tierColor = (tier: string) => {
    if (tier === 'danger')  return 'text-red-700 font-bold';
    if (tier === 'alert')   return 'text-orange-600 font-semibold';
    if (tier === 'scene')   return 'text-purple-700 font-semibold';  // NEW
    if (tier === 'ambient') return 'text-green-700';
    return 'text-blue-700';
  };
  const tierIcon = (tier: string) => {
    if (tier === 'danger')  return '🚨';
    if (tier === 'alert')   return '⚠️';
    if (tier === 'scene')   return '🏞️';  // NEW
    if (tier === 'ambient') return '🔵';
    return '💬';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-400 to-purple-600 p-5">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 md:p-8">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={onBack}
              className="rounded-full px-4 py-2 bg-black/15 hover:bg-white/25 transition !text-black"
            >
              ← Back
            </button>
            <div className="text-center flex-1">
              <h1 className="text-2xl md:text-3xl font-semibold">🎥 VLM Accessibility - Video Analyzer</h1>
              <p className="opacity-90 text-sm md:text-base">Upload and analyze local videos for accessibility insights</p>
            </div>
            <div className="w-[84px]" />
          </div>
        </div>

        <div className="p-6 md:p-10">
          {/* API Config */}
          <div className="mb-8 p-6 rounded-xl bg-gray-50 border-l-4 border-indigo-500">
            <h2 className="text-2xl font-semibold text-indigo-600 mb-4">⚙️ API Configuration</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block mb-2 font-semibold text-gray-700">Backend API URL</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:5000"
                  className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
                <small className="block mt-1 text-gray-500">
                  Defaults to your local Flask server. If you expose it (e.g. ngrok), paste that URL here.
                </small>
              </div>
              <div className="bg-cyan-50 border-l-4 border-cyan-500 p-4 rounded">
                <strong className="block text-cyan-900 mb-1">💡 Examples:</strong>
                <div className="text-cyan-900">
                  Local: http://localhost:5000<br />
                  Ngrok: https://xxxx-xx-xxx-xxx-xxx.ngrok-free.app
                </div>
              </div>
            </div>
          </div>

          {/* Camera + Upload Section */}
          <div className="mb-8 p-6 rounded-xl bg-gray-50 border-l-4 border-indigo-500">
            <h2 className="text-2xl font-semibold text-indigo-600 mb-6">📹 Upload or Record Video</h2>

            {/* Camera Recording Section */}
            <div className="mb-6 p-6 rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-300">
              <h3 className="text-xl font-semibold text-purple-700 mb-4 flex items-center gap-2">
                📷 Record from Camera
              </h3>

              {!isCameraActive && !isRecording && (
                <button
                  onClick={startCamera}
                  className="w-full md:w-auto rounded-full px-6 py-3 text-white bg-gradient-to-r from-purple-500 to-pink-600 shadow hover:shadow-lg transition"
                >
                  🎥 Start Camera
                </button>
              )}

              {isCameraActive && (
                <div className="space-y-4">
                  <div className="rounded-xl overflow-hidden shadow-lg bg-black relative">
                    <video
                      ref={cameraVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full max-h-[400px] block object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    {isRecording && (
                      <div className="absolute top-4 left-4 bg-red-600 text-white px-4 py-2 rounded-full flex items-center gap-2 font-semibold z-10">
                        <span className="w-3 h-3 bg-white rounded-full animate-pulse" />
                        Recording: {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                      </div>
                    )}
                    {isStreaming && (
                      <div className="absolute top-4 right-4 bg-green-600 text-white px-3 py-1 rounded-full text-sm font-semibold z-10">
                        📡 Live Streaming
                      </div>
                    )}
                  </div>

                  {/* Live Predictions */}
                  <div className="p-4 rounded-xl bg-yellow-50 border-2 border-yellow-300 text-yellow-900">
                    <div className="font-semibold mb-2 flex items-center gap-2">
                      Live Assistant
                      <span className="text-xs font-normal text-yellow-700">(only meaningful events are spoken)</span>
                    </div>
                    {/* FIX (doc-3 scene): Legend now includes "scene" tier */}
                    <div className="flex flex-wrap gap-3 mb-2 text-xs">
                      <span className="text-red-700 font-bold">🚨 danger</span>
                      <span className="text-purple-700 font-semibold">🏞️ scene change</span>
                      <span className="text-orange-600 font-semibold">⚠️ alert</span>
                      <span className="text-green-700">🔵 ambient</span>
                    </div>
                    <div className="space-y-1 max-h-[160px] overflow-y-auto">
                      {livePredictions.length === 0 ? (
                        <div className="text-yellow-700 text-sm">Start recording to see assistant events...</div>
                      ) : (
                        [...livePredictions].reverse().map((evt, idx) => (
                          <div key={idx} className={`text-sm flex items-start gap-2 ${tierColor(evt.tier)}`}>
                            <span>{tierIcon(evt.tier)}</span>
                            <span>{evt.text}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Real-time socket analysis (debugging) */}
                  {realTimeAnalysis.length > 0 && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300">
                      <h4 className="text-lg font-semibold text-blue-700 mb-3">🔍 Real-time Analysis</h4>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {realTimeAnalysis.map((analysis, index) => (
                          <div key={index} className="p-3 bg-white rounded-lg border border-blue-200">
                            <div className="text-sm text-gray-600 mb-1">
                              {new Date(analysis.timestamp).toLocaleTimeString()}
                            </div>
                            {analysis.answer && (
                              <div className="text-sm text-gray-900 font-semibold">A: {analysis.answer}</div>
                            )}
                            {analysis.error && (
                              <div className="text-xs text-red-700 mt-2">{analysis.error}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {!isRecording ? (
                      <>
                        <button
                          onClick={startRecording}
                          className="rounded-full px-6 py-3 text-black bg-white border-2 border-red-500 shadow hover:shadow-lg hover:bg-red-50 transition font-semibold"
                        >
                          🔴 Start Recording
                        </button>
                        <button
                          onClick={stopCamera}
                          className="rounded-full px-6 py-3 text-black bg-white border-2 border-gray-500 shadow hover:shadow-lg hover:bg-gray-50 transition font-semibold"
                        >
                          Stop Camera
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={stopRecording}
                        className="rounded-full px-6 py-3 text-black bg-white border-2 border-red-600 shadow hover:shadow-lg hover:bg-red-50 transition font-semibold"
                      >
                        ⏹️ Stop Recording
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* File Upload */}
            <div className="mb-4">
              <h3 className="text-xl font-semibold text-indigo-600 mb-4">📁 Or Upload Video File</h3>
              <div
                ref={dropZoneRef}
                onClick={onDropZoneClick}
                className="border-2 border-dashed border-indigo-500 rounded-xl p-10 text-center bg-white hover:bg-indigo-50 transition cursor-pointer"
              >
                <div className="text-5xl mb-2">🎬</div>
                <h3 className="text-indigo-600 font-semibold mb-1">Drop your video here or click to browse</h3>
                <p className="text-gray-600">Supported formats: MP4, AVI, MOV, WebM, MKV</p>
                <p className="text-gray-500 text-sm mt-2">Maximum recommended size: 500MB</p>
                <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileInputChange} />
              </div>
            </div>

            {selectedFile && (
              <div className="mt-4 rounded-lg border-2 border-green-500 bg-green-50 p-4">
                <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
                  <span className="font-semibold text-green-800">📄 File Name:</span>
                  <span className="text-green-800">{selectedFile.name}</span>
                  <span className="font-semibold text-green-800">💾 File Size:</span>
                  <span className="text-green-800">
                    {selectedFile.size < 1024 ? `${selectedFile.size} B`
                      : selectedFile.size < 1024 * 1024 ? `${(selectedFile.size / 1024).toFixed(2)} KB`
                      : selectedFile.size < 1024 ** 3 ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                      : `${(selectedFile.size / 1024 ** 3).toFixed(2)} GB`}
                  </span>
                  <span className="font-semibold text-green-800">🎞️ Format:</span>
                  <span className="text-green-800">{selectedFile.type.split('/')[1]?.toUpperCase() || '-'}</span>
                </div>
              </div>
            )}

            {selectedFile && (
              <div className="mt-4 rounded-xl overflow-hidden shadow">
                <video ref={previewVideoRef} controls className="w-full max-h-[400px] block" />
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <div>
                <label className="block mb-2 font-semibold text-gray-700">Duration to Process (seconds)</label>
                <input
                  type="number" min={5} max={300} value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 focus:outline-none focus:border-indigo-500"
                  placeholder="Leave empty for full video"
                />
                <small className="block mt-1 text-gray-500">Leave empty to process entire video</small>
              </div>
              <div>
                <label className="block mb-2 font-semibold text-gray-700">Number of Frame Analyses</label>
                <input
                  type="number" min={3} max={50} value={targetAnalyses}
                  onChange={(e) => setTargetAnalyses(e.target.value)}
                  className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
                <small className="block mt-1 text-gray-500">More analyses give more detail but take longer</small>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={analyzeVideo}
                disabled={!selectedFile}
                className="rounded-full px-6 py-3 text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow hover:shadow-lg disabled:opacity-60"
              >
                {statusType === 'loading' ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : 'Analyze Video'}
              </button>
              {selectedFile && (
                <button
                  onClick={clearVideo}
                  className="rounded-full px-6 py-3 text-white bg-gradient-to-r from-gray-500 to-gray-700 shadow hover:shadow-lg"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {progressVisible && (
              <div className="mt-4">
                <div className="font-semibold text-indigo-600 mb-2">{progressLabel}</div>
                <div className="w-full h-9 rounded-full bg-gray-200 overflow-hidden shadow-inner">
                  <div
                    className="h-full text-center text-white font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center transition-all"
                    style={{ width: `${Math.round(progressPercent)}%` }}
                  >
                    {Math.round(progressPercent)}%
                  </div>
                </div>
              </div>
            )}

            {statusType && (
              <div
                className={[
                  'mt-4 rounded-xl p-4 font-semibold',
                  statusType === 'loading' && 'bg-yellow-100 text-yellow-800 border-2 border-yellow-300',
                  statusType === 'success' && 'bg-green-100 text-green-800 border-2 border-green-300',
                  statusType === 'error'   && 'bg-red-100 text-red-800 border-2 border-red-300',
                ].filter(Boolean).join(' ')}
              >
                {statusMessage}
              </div>
            )}
          </div>

          {/* Results */}
          {resultsVisible && results && (
            <div className="rounded-xl border-2 border-indigo-500 p-6 bg-white shadow">
              <h3 className="text-2xl font-semibold text-indigo-600 mb-4">📊 Analysis Results</h3>

              {videoInfo && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  {[
                    ['Total Frames Analyzed', videoInfo.analyzed_frames ?? '-'],
                    ['Video Duration',         videoInfo.total_duration  ?? '-'],
                    ['Processing Time',        processingTime],
                  ].map(([label, value]) => (
                    <div key={label as string} className="p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 border-l-4 border-indigo-500">
                      <div className="text-gray-600 text-sm">{label}</div>
                      <div className="text-2xl font-bold text-indigo-600">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 border-b border-gray-200 mb-4">
                {(['summary', 'frames', 'raw'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={[
                      'px-4 py-2 font-semibold border-b-2',
                      activeTab === tab ? 'text-indigo-600 border-indigo-600' : 'text-gray-600 border-transparent',
                    ].join(' ')}
                  >
                    {tab === 'summary' ? '📋 Summary' : tab === 'frames' ? '🎞️ Frame Analysis' : '📄 Raw Data'}
                  </button>
                ))}
              </div>

              {activeTab === 'summary' && (
                <pre className="bg-gray-50 p-4 rounded-lg max-h-[500px] overflow-auto text-sm leading-6">{summaryText}</pre>
              )}
              {activeTab === 'frames' && (
                <pre className="bg-gray-50 p-4 rounded-lg max-h-[500px] overflow-auto text-sm leading-6">
                  {JSON.stringify(results.results?.frame_analyses ?? [], null, 2)}
                </pre>
              )}
              {activeTab === 'raw' && (
                <pre className="bg-gray-50 p-4 rounded-lg max-h-[500px] overflow-auto text-sm leading-6">
                  {JSON.stringify(results, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
