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
  const stopRequestedRef = useRef<boolean>(false);
  const forceStopTimeoutRef = useRef<number | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [realTimeAnalysis, setRealTimeAnalysis] = useState<any[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [livePredictions, setLivePredictions] = useState<string[]>([]);

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

  useEffect(() => {
    const saved = localStorage.getItem('apiUrl');
    if (saved) {
      setApiUrl(saved);
    } else {
      setApiUrl('http://localhost:5000');
    }
  }, []);

  useEffect(() => {
    if (apiUrl) {
      localStorage.setItem('apiUrl', apiUrl);
    }
  }, [apiUrl]);

  useEffect(() => {
    const videoEl = cameraVideoRef.current;
    if (!videoEl) return;
    if (!mediaStream) return;

    if (videoEl.srcObject !== mediaStream) {
      videoEl.srcObject = mediaStream;
    }

    const tryPlay = async () => {
      try {
        await videoEl.play();
      } catch (e) {
        console.warn('Camera preview play() failed:', e);
      }
    };

    if (videoEl.readyState >= 2) {
      void tryPlay();
    } else {
      videoEl.onloadedmetadata = () => {
        void tryPlay();
      };
    }

    return () => {
      if (videoEl.onloadedmetadata) {
        videoEl.onloadedmetadata = null;
      }
    };
  }, [mediaStream, isCameraActive, isRecording]);

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

  const onDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChosen = (file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('⚠️ Please select a valid video file');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      const cont = confirm('⚠️ This file is large and may take long to upload/process. Continue?');
      if (!cont) return;
    }
    setSelectedFile(file);
    setResultsVisible(false);
    if (previewVideoRef.current) {
      previewVideoRef.current.src = URL.createObjectURL(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileChosen(file);
  };

  useEffect(() => {
    const dz = dropZoneRef.current;
    if (!dz) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      dz.classList.add('dragover');
    };
    const onDragLeave = () => {
      dz.classList.remove('dragover');
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dz.classList.remove('dragover');
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

        const videoEl = cameraVideoRef.current;
        videoEl.onloadedmetadata = async () => {
          try {
            await videoEl.play();
          } catch (e) {
            console.warn('Camera preview play() failed:', e);
          }
        };
      }

      // Initialize Socket.IO connection for real-time streaming
      const newSocket = io(apiUrl || 'http://localhost:5000', {
        transports: ['polling'],
        upgrade: false,
      });
      newSocket.on('connect', () => {
        console.log('Connected to backend for streaming');
      });

      newSocket.on('analysis_result', (data) => {
        setRealTimeAnalysis((prev: any[]) => [...prev.slice(-4), data]); // Keep last 5 results
      });

      newSocket.on('stream_error', (data) => {
        console.error('Streaming error:', data.error);
      });

      setSocket(newSocket);
      socketRef.current = newSocket;
    } catch (err: any) {
      alert(`⚠️ Error accessing camera: ${err.message || 'Camera access denied'}`);
      console.error('Camera access error:', err);
    }
  };

  const stopCamera = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      setMediaStream(null);
      setIsCameraActive(false);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }
    }

    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }
    frameCounterRef.current = 0;

    // Disconnect socket
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setIsRecording(false);
    setIsStreaming(false);
    setRecordingTime(0);
    setRealTimeAnalysis([]);
    setLivePredictions([]);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const speakPrediction = (answer: string) => {
    if ('speechSynthesis' in window) {
      const text = `${answer} `;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;
      speechSynthesis.speak(utterance);
    }
  };

  const startFrameStreaming = () => {
    if (!cameraVideoRef.current || !apiUrl) return;

    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }

    frameCounterRef.current = 0;

    streamingIntervalRef.current = window.setInterval(async () => {
      const videoEl = cameraVideoRef.current;
      if (!videoEl) return;
      if (videoEl.readyState < 2) return;
      if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) return;

      const canvas = captureCanvasRef.current ?? document.createElement('canvas');
      captureCanvasRef.current = canvas;

      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.7);
      
      try {
        const response = await fetch(`${apiUrl}/analyze/frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: jpegDataUrl,
            timestamp: Date.now(),
            question: 'what is in the picture',
          }),
        });
        const result = await response.json();
        console.log('Frame analysis result:', result);
        
        if (result.success && result.answer) {
          let answer = result.answer;
          if (answer === 'unanswerable' || answer === 'unsuitable') {
            answer = 'object';
          }

          let combinedText = answer;
          let navList = result.navigation || [];
            if (navList.length > 0) {
              combinedText += ' and ' + navList.join(' and ');
            }

          console.log('🧭 Navigation Elements:', navList);
          console.log('📝 Combined Text:', combinedText);
          setLivePredictions((prev: string[]) => [...prev.slice(-4), combinedText]);
          
          // Speak the prediction
          speakPrediction(combinedText);
        } else {
          console.error('Frame analysis error:', result);
        }
      } catch (err) {
        console.error('Frame analysis error:', err);
      }
    }, 2000);
  };

  const startRecording = () => {
    if (!mediaStream) {
      alert('⚠️ Please start camera first');
      return;
    }

    const videoEl = cameraVideoRef.current;
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      alert('⚠️ Camera is still starting. Please wait a second and try again.');
      return;
    }

    const chunks: Blob[] = [];
    recordedChunksRef.current = chunks;
    setRecordedChunks(chunks);

    try {
      let options: MediaRecorderOptions = {};
      const mimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          options = { mimeType };
          break;
        }
      }

      const mediaRecorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size === 0) {
          alert('⚠️ Recording was empty. Please try again (record for at least 2 seconds).');
          return;
        }
        const fileName = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
        const file = new File([blob], fileName, { type: mimeType });
        onFileChosen(file);
      };

      // Use a timeslice so the first session produces early chunks.
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
      console.error('Recording error:', err);
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr || !isRecording) return;

    try {
      mr.requestData();
    } catch {}

    window.setTimeout(() => {
      try {
        mr.stop();
      } catch {}
    }, 200);

    setIsRecording(false);
    setIsStreaming(false);

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const showStatus = (message: string, type: StatusType) => {
    setStatusMessage(message);
    setStatusType(type);
  };

  const showProgress = (percent: number, label?: string) => {
    setProgressVisible(true);
    setProgressPercent(percent);
    if (label) setProgressLabel(label);
  };

  const hideProgress = () => {
    setProgressVisible(false);
  };

  const analyzeVideo = async () => {
    if (!selectedFile) {
      alert('⚠️ Please select a video file first');
      return;
    }
    const url = apiUrl.trim();
    if (!url) {
      alert('⚠️ Please enter your backend API URL (e.g., http://localhost:5000)');
      return;
    }

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
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 50;
          showProgress(percentComplete, 'Uploading video...');
        }
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
          try {
            errorMsg = (JSON.parse(xhr.responseText).error as string) || errorMsg;
          } catch {}
          showStatus(`❌ Error: ${errorMsg}`, 'error');
          hideProgress();
        }
      });

      xhr.addEventListener('error', () => {
        showStatus('❌ Network error occurred. Please check your connection and try again.', 'error');
        hideProgress();
      });

      xhr.upload.addEventListener('loadend', () => {
        showProgress(50, 'Processing video frames...');
        showStatus('⏳ Processing video frames with AI models... This may take several minutes.', 'loading');

        let progress = 50;
        const interval = setInterval(() => {
          if (xhr.readyState === 4) {
            clearInterval(interval);
          } else {
            progress += 2;
            if (progress < 95) {
              showProgress(progress, 'Analyzing frames...');
            }
          }
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
                  Local: http://localhost:5000
                  <br />
                  Ngrok: https://xxxx-xx-xxx-xxx-xxx.ngrok-free.app
                </div>
              </div>
            </div>
          </div>

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
                      style={{ transform: 'scaleX(-1)' }} // Mirror effect for natural camera view
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

                  {/* New Live Predictions Box */}
                  <div className="p-4 rounded-xl bg-yellow-50 border-2 border-yellow-300 text-yellow-900">
                    <div className="font-semibold mb-2">Live Predictions</div>
                    <div className="space-y-1 max-h-[140px] overflow-y-auto">
                      {livePredictions.length === 0 ? (
                        <div className="text-yellow-700 text-sm">Start recording to see predictions...</div>
                      ) : (
                        livePredictions.slice(-8).reverse().map((answer, idx) => (
                          <div key={idx} className="font-semibold">
                            {answer} ahead.
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {(() => {
                    const latest = realTimeAnalysis[realTimeAnalysis.length - 1];
                    if (!latest) return null;
                    if (latest.error) {
                      return (
                        <div className="p-4 rounded-xl bg-red-50 border-2 border-red-300 text-red-800 font-semibold">
                          {latest.error}
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Real-time Analysis Results */}
                  {realTimeAnalysis.length > 0 && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300">
                      <h4 className="text-lg font-semibold text-blue-700 mb-3">🔍 Real-time Analysis</h4>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {realTimeAnalysis.map((analysis, index) => (
                          <div key={index} className="p-3 bg-white rounded-lg border border-blue-200">
                            <div className="text-sm text-gray-600 mb-1">
                              {new Date(analysis.timestamp).toLocaleTimeString()}
                            </div>
                            {analysis.question && (
                              <div className="text-xs text-blue-700 font-semibold mb-1">Q: {analysis.question}</div>
                            )}
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

            {/* File Upload Section */}
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
                    {selectedFile.size < 1024
                      ? `${selectedFile.size} B`
                      : selectedFile.size < 1024 * 1024
                      ? `${(selectedFile.size / 1024).toFixed(2)} KB`
                      : selectedFile.size < 1024 * 1024 * 1024
                      ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                      : `${(selectedFile.size / (1024 * 1024 * 1024)).toFixed(2)} GB`}
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
                  type="number"
                  min={5}
                  max={300}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 focus:outline-none focus:border-indigo-500"
                  placeholder="Leave empty for full video"
                />
                <small className="block mt-1 text-gray-500">Leave empty to process entire video</small>
              </div>
              <div>
                <label className="block mb-2 font-semibold text-gray-700">Number of Frame Analyses</label>
                <input
                  type="number"
                  min={3}
                  max={50}
                  value={targetAnalyses}
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
                ) : (
                  'Analyze Video'
                )}
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
                  statusType === 'error' && 'bg-red-100 text-red-800 border-2 border-red-300',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {statusMessage}
              </div>
            )}
          </div>

          {resultsVisible && results && (
            <div className="rounded-xl border-2 border-indigo-500 p-6 bg-white shadow">
              <h3 className="text-2xl font-semibold text-indigo-600 mb-4 flex items-center gap-2">📊 Analysis Results</h3>

              {videoInfo && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 border-l-4 border-indigo-500">
                    <div className="text-gray-600 text-sm">Total Frames Analyzed</div>
                    <div className="text-2xl font-bold text-indigo-600">{videoInfo.analyzed_frames ?? '-'}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 border-l-4 border-indigo-500">
                    <div className="text-gray-600 text-sm">Video Duration</div>
                    <div className="text-2xl font-bold text-indigo-600">{videoInfo.total_duration ?? '-'}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 border-l-4 border-indigo-500">
                    <div className="text-gray-600 text-sm">Processing Time</div>
                    <div className="text-2xl font-bold text-indigo-600">{processingTime}</div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 border-b border-gray-200 mb-4">
                <button
                  onClick={() => setActiveTab('summary')}
                  className={[
                    'px-4 py-2 font-semibold border-b-2',
                    activeTab === 'summary' ? 'text-indigo-600 border-indigo-600' : 'text-gray-600 border-transparent',
                  ].join(' ')}
                >
                  📋 Summary
                </button>
                <button
                  onClick={() => setActiveTab('frames')}
                  className={[
                    'px-4 py-2 font-semibold border-b-2',
                    activeTab === 'frames' ? 'text-indigo-600 border-indigo-600' : 'text-gray-600 border-transparent',
                  ].join(' ')}
                >
                  🎞️ Frame Analysis
                </button>
                <button
                  onClick={() => setActiveTab('raw')}
                  className={[
                    'px-4 py-2 font-semibold border-b-2',
                    activeTab === 'raw' ? 'text-indigo-600 border-indigo-600' : 'text-gray-600 border-transparent',
                  ].join(' ')}
                >
                  📄 Raw Data
                </button>
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
