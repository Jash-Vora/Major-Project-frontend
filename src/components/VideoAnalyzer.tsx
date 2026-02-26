import { useEffect, useMemo, useRef, useState } from 'react';

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

interface RealTimeResult {
  timestamp: number;
  answer: string;
  question: string;
}

interface VideoAnalyzerProps {
  onBack?: () => void;
}

// Headers sent with every fetch to the ngrok-tunnelled backend
const NGROK_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
};

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

  const recordedChunksRef = useRef<Blob[]>([]);

  // Unified real-time results (single source of truth — no Socket.IO)
  const [realTimeResults, setRealTimeResults] = useState<RealTimeResult[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string>('');

  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const streamingIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Prevent overlapping in-flight frame requests
  const frameInFlightRef = useRef<boolean>(false);

  // ── Persist API URL ───────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('apiUrl');
    setApiUrl(saved || 'http://localhost:5000');
  }, []);

  useEffect(() => {
    if (apiUrl) localStorage.setItem('apiUrl', apiUrl);
  }, [apiUrl]);

  // ── Camera preview sync ───────────────────────────────────
  useEffect(() => {
    const videoEl = cameraVideoRef.current;
    if (!videoEl || !mediaStream) return;
    if (videoEl.srcObject !== mediaStream) videoEl.srcObject = mediaStream;
    const tryPlay = async () => {
      try { await videoEl.play(); } catch (e) { console.warn('Camera play() failed:', e); }
    };
    if (videoEl.readyState >= 2) { void tryPlay(); }
    else { videoEl.onloadedmetadata = () => { void tryPlay(); }; }
    return () => { if (videoEl.onloadedmetadata) videoEl.onloadedmetadata = null; };
  }, [mediaStream, isCameraActive, isRecording]);

  // ── Summary text memo ─────────────────────────────────────
  const summaryText = useMemo(() => {
    if (!results?.results?.frame_analyses) return '';
    const frames = results.results.frame_analyses;
    let summary = `Total Frames Analyzed: ${frames.length}\n\n`;
    frames.forEach((frame: FrameAnalysis, idx: number) => {
      summary += `Frame ${idx + 1} (${frame.timestamp ?? '-'}):\n`;
      summary += `  Description: ${frame.description ?? 'N/A'}\n`;
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

  // ── File helpers ──────────────────────────────────────────
  const onDropZoneClick = () => fileInputRef.current?.click();

  const onFileChosen = (file: File) => {
    if (!file.type.startsWith('video/')) { alert('⚠️ Please select a valid video file'); return; }
    if (file.size > 500 * 1024 * 1024) {
      if (!confirm('⚠️ This file is large and may take long to process. Continue?')) return;
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
    const onDragOver = (e: DragEvent) => { e.preventDefault(); dz.classList.add('dragover'); };
    const onDragLeave = () => dz.classList.remove('dragover');
    const onDrop = (e: DragEvent) => {
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

  // ── Camera ────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      setMediaStream(stream);
      setIsCameraActive(true);
      setRealTimeResults([]);
      setStreamError('');
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        cameraVideoRef.current.onloadedmetadata = async () => {
          try { await cameraVideoRef.current!.play(); } catch (e) { console.warn(e); }
        };
      }
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
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }
    frameInFlightRef.current = false;
    setIsRecording(false);
    setIsStreaming(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const speakPrediction = (answer: string) => {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); // don't queue up
    const utterance = new SpeechSynthesisUtterance(`There is a ${answer} ahead. Watch out.`);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    speechSynthesis.speak(utterance);
  };

  // ── Pure HTTP frame streaming (no Socket.IO) ──────────────
  const startFrameStreaming = () => {
    if (!cameraVideoRef.current || !apiUrl) return;
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }
    frameInFlightRef.current = false;

    streamingIntervalRef.current = window.setInterval(async () => {
      if (frameInFlightRef.current) return; // skip if previous request still running

      const videoEl = cameraVideoRef.current;
      if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;

      // Set up canvas (un-mirror the CSS-mirrored preview)
      const canvas = captureCanvasRef.current ?? document.createElement('canvas');
      captureCanvasRef.current = canvas;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(videoEl, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.7);

      frameInFlightRef.current = true;
      setStreamError('');

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${apiUrl}/analyze/frame`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...NGROK_HEADERS,          // ← skip ngrok browser-warning page
          },
          body: JSON.stringify({
            data: jpegDataUrl,
            timestamp: Date.now(),
            question: 'what is in the picture',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
        }

        const result = await response.json();

        if (result.success && result.answer) {
          let answer = result.answer as string;
          if (answer === 'unanswerable' || answer === 'unsuitable') answer = 'object';

          const entry: RealTimeResult = {
            timestamp: Date.now(),
            answer,
            question: result.question || 'what is in the picture',
          };
          setRealTimeResults(prev => [...prev.slice(-19), entry]);
          speakPrediction(answer);
        } else if (result.error) {
          setStreamError(result.error);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setStreamError('Request timed out. Backend may be busy.');
        } else {
          setStreamError(err.message || 'Network error — check your ngrok URL and CORS settings.');
        }
      } finally {
        frameInFlightRef.current = false;
      }
    }, 2500); // 2.5s between frames
  };

  // ── Recording ─────────────────────────────────────────────
  const startRecording = () => {
    if (!mediaStream) { alert('⚠️ Please start camera first'); return; }
    const videoEl = cameraVideoRef.current;
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
      alert('⚠️ Camera is still starting. Please wait a second and try again.');
      return;
    }

    recordedChunksRef.current = [];

    let options: MediaRecorderOptions = {};
    for (const mt of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) {
      if (MediaRecorder.isTypeSupported(mt)) { options = { mimeType: mt }; break; }
    }

    try {
      const mr = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const mimeType = mr.mimeType || 'video/webm';
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size === 0) {
          alert('⚠️ Recording was empty. Please try again (record for at least 2 seconds).');
          return;
        }
        const fileName = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
        onFileChosen(new File([blob], fileName, { type: mimeType }));
      };

      mr.start(500);
      setIsRecording(true);
      setIsStreaming(true);
      setRecordingTime(0);
      setRealTimeResults([]);
      setStreamError('');

      startFrameStreaming();

      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
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
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
    if (streamingIntervalRef.current) { clearInterval(streamingIntervalRef.current); streamingIntervalRef.current = null; }
    frameInFlightRef.current = false;
  };

  useEffect(() => () => stopCamera(), []);

  // ── Status / progress helpers ─────────────────────────────
  const showStatus = (message: string, type: StatusType) => { setStatusMessage(message); setStatusType(type); };
  const showProgress = (pct: number, label?: string) => { setProgressVisible(true); setProgressPercent(pct); if (label) setProgressLabel(label); };
  const hideProgress = () => setProgressVisible(false);

  // ── Video upload + analysis ───────────────────────────────
  const analyzeVideo = async () => {
    if (!selectedFile) { alert('⚠️ Please select a video file first'); return; }
    const url = apiUrl.trim();
    if (!url) { alert('⚠️ Please enter your backend API URL'); return; }

    setResultsVisible(false);
    setResults(null);
    showStatus('⏳ Uploading video... This may take a few minutes.', 'loading');
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

    xhr.upload.addEventListener('loadend', () => {
      showProgress(50, 'Processing video frames...');
      showStatus('⏳ Processing video frames with AI models...', 'loading');
      let progress = 50;
      const iv = setInterval(() => {
        if (xhr.readyState === 4) { clearInterval(iv); }
        else { progress += 2; if (progress < 95) showProgress(progress, 'Analyzing frames...'); }
      }, 2000);
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
      showStatus('❌ Network error. Check your connection and ngrok URL.', 'error');
      hideProgress();
    });

    xhr.open('POST', `${url}/analyze/video`);
    // Set ngrok header on XHR too
    xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    xhr.send(formData);
  };

  const processingTime = useMemo(() => {
    if (!startTimeRef.current || !resultsVisible) return '-';
    return `${((Date.now() - startTimeRef.current) / 1000).toFixed(1)}s`;
  }, [resultsVisible]);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-400 to-purple-600 p-5">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 md:p-8">
          <div className="flex items-center justify-between gap-3">
            <button onClick={onBack} className="rounded-full px-4 py-2 bg-black/15 hover:bg-white/25 transition !text-black">
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
                  placeholder="https://xxxx.ngrok-free.app"
                  className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
                <small className="block mt-1 text-gray-500">
                  Since you're on Vercel, use your <strong>ngrok HTTPS URL</strong> — localhost won't work.
                </small>
              </div>
              <div className="bg-cyan-50 border-l-4 border-cyan-500 p-4 rounded">
                <strong className="block text-cyan-900 mb-1">💡 Examples:</strong>
                <div className="text-cyan-900 text-sm">
                  ✅ ngrok: https://xxxx-xx-xxx-xxx-xxx.ngrok-free.app<br />
                  ❌ Local (won't work from Vercel): http://localhost:5000
                </div>
              </div>
            </div>
          </div>

          {/* Upload / Record Section */}
          <div className="mb-8 p-6 rounded-xl bg-gray-50 border-l-4 border-indigo-500">
            <h2 className="text-2xl font-semibold text-indigo-600 mb-6">📹 Upload or Record Video</h2>

            {/* Camera */}
            <div className="mb-6 p-6 rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-300">
              <h3 className="text-xl font-semibold text-purple-700 mb-4">📷 Record from Camera</h3>

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
                  {/* Camera preview */}
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
                        📡 Live Analysis
                      </div>
                    )}
                  </div>

                  {/* Live predictions panel */}
                  <div className="p-4 rounded-xl bg-yellow-50 border-2 border-yellow-300 text-yellow-900">
                    <div className="font-semibold mb-2 flex items-center justify-between">
                      <span>Live Predictions</span>
                      {isStreaming && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                          {frameInFlightRef.current ? '⏳ Analysing…' : '✅ Ready'}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 max-h-[160px] overflow-y-auto">
                      {realTimeResults.length === 0 ? (
                        <div className="text-yellow-700 text-sm">
                          {isStreaming ? '⏳ Waiting for first frame result...' : 'Start recording to see predictions...'}
                        </div>
                      ) : (
                        [...realTimeResults].reverse().map((r, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <span className="text-xs text-yellow-600 shrink-0 mt-0.5">
                              {new Date(r.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="font-semibold">There is a {r.answer} ahead. Watch out.</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Error banner */}
                  {streamError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm">
                      ⚠️ {streamError}
                    </div>
                  )}

                  {/* Controls */}
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
                    {selectedFile.size < 1024 * 1024
                      ? `${(selectedFile.size / 1024).toFixed(2)} KB`
                      : `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`}
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
                <button onClick={clearVideo} className="rounded-full px-6 py-3 text-white bg-gradient-to-r from-gray-500 to-gray-700 shadow hover:shadow-lg">
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
              <div className={[
                'mt-4 rounded-xl p-4 font-semibold',
                statusType === 'loading' && 'bg-yellow-100 text-yellow-800 border-2 border-yellow-300',
                statusType === 'success' && 'bg-green-100 text-green-800 border-2 border-green-300',
                statusType === 'error'   && 'bg-red-100 text-red-800 border-2 border-red-300',
              ].filter(Boolean).join(' ')}>
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
                    { label: 'Total Frames Analyzed', value: videoInfo.analyzed_frames ?? '-' },
                    { label: 'Video Duration',         value: videoInfo.total_duration ?? '-' },
                    { label: 'Processing Time',        value: processingTime },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 border-l-4 border-indigo-500">
                      <div className="text-gray-600 text-sm">{label}</div>
                      <div className="text-2xl font-bold text-indigo-600">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 border-b border-gray-200 mb-4">
                {(['summary', 'frames', 'raw'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={['px-4 py-2 font-semibold border-b-2',
                      activeTab === tab ? 'text-indigo-600 border-indigo-600' : 'text-gray-600 border-transparent'
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
