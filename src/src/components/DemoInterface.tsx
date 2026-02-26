import { useState, useRef, useCallback } from 'react';
import { ArrowLeft, Upload, Camera, Play, Pause, Volume2, VolumeX, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import { Progress } from './ui/progress';

interface DemoInterfaceProps {
  onNavigateBack: () => void;
}

interface DetectionResult {
  object: string;
  confidence: number;
  type: 'hazard' | 'object' | 'safe';
  position: { x: number; y: number };
}

interface AnalysisResult {
  detections: DetectionResult[];
  guidance: string;
  overallSafety: 'safe' | 'caution' | 'danger';
  description: string;
}

export function DemoInterface({ onNavigateBack }: DemoInterfaceProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mock VLM analysis - simulates real model output
  const analyzeImage = useCallback(async () => {
    setIsProcessing(true);
    setAnalysisResult(null);
    
    // Simulate API processing time
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Mock detection results
    const mockResults: AnalysisResult = {
      detections: [
        { object: 'Stairs ahead', confidence: 0.95, type: 'hazard', position: { x: 45, y: 30 } },
        { object: 'Handrail on right', confidence: 0.88, type: 'safe', position: { x: 75, y: 40 } },
        { object: 'Person walking', confidence: 0.92, type: 'object', position: { x: 30, y: 50 } },
        { object: 'Wet floor sign', confidence: 0.87, type: 'hazard', position: { x: 60, y: 60 } },
        { object: 'Open doorway', confidence: 0.91, type: 'object', position: { x: 50, y: 45 } },
      ],
      guidance: 'Caution: Stairs detected 3 meters ahead. Handrail available on your right side. A person is walking towards you from the left. Wet floor warning sign present. Proceed carefully and use the handrail for support.',
      overallSafety: 'caution',
      description: 'Indoor corridor with stairs. Handrail visible on the right side. One person present. Wet floor conditions indicated. Good lighting conditions.'
    };
    
    setAnalysisResult(mockResults);
    setIsProcessing(false);
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string);
        setAnalysisResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      setIsCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Unable to access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      setIsCameraActive(false);
    }
  };

  const captureFromCamera = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imageData = canvas.toDataURL('image/jpeg');
        setSelectedImage(imageData);
        setAnalysisResult(null);
        stopCamera();
      }
    }
  };

  const speakGuidance = () => {
    if (!analysisResult || isMuted) return;
    
    const utterance = new SpeechSynthesisUtterance(analysisResult.guidance);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    
    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  const getSafetyColor = (safety: string) => {
    switch (safety) {
      case 'safe': return 'text-green-600 bg-green-50 border-green-200';
      case 'caution': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'danger': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getDetectionColor = (type: string) => {
    switch (type) {
      case 'hazard': return 'destructive';
      case 'safe': return 'default';
      case 'object': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <nav className="border-b bg-white sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={onNavigateBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Button>
          <h1 className="text-xl">Interactive Demo</h1>
          <div className="w-32"></div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Instructions */}
          <Alert className="mb-8 bg-blue-50 border-blue-200">
            <Info className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              Upload an image or use your camera to test the VLM-based hazard detection system. The AI will analyze the scene and provide audio guidance.
            </AlertDescription>
          </Alert>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* Left Column - Image Input */}
            <div>
              <Card className="p-6">
                <h2 className="text-2xl mb-6">Image Input</h2>
                
                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="upload">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Image
                    </TabsTrigger>
                    <TabsTrigger value="camera">
                      <Camera className="w-4 h-4 mr-2" />
                      Use Camera
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="upload" className="space-y-4">
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
                    >
                      <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 mb-2">Click to upload an image</p>
                      <p className="text-sm text-gray-400">Supports JPG, PNG, JPEG</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </TabsContent>
                  
                  <TabsContent value="camera" className="space-y-4">
                    {!isCameraActive ? (
                      <div className="text-center py-12">
                        <Camera className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <Button onClick={startCamera} className="bg-blue-600 hover:bg-blue-700">
                          <Camera className="w-4 h-4 mr-2" />
                          Start Camera
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          className="w-full rounded-lg"
                        />
                        <div className="flex gap-2">
                          <Button onClick={captureFromCamera} className="flex-1 bg-blue-600 hover:bg-blue-700">
                            Capture Photo
                          </Button>
                          <Button onClick={stopCamera} variant="outline">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>

                {/* Preview */}
                {selectedImage && (
                  <div className="mt-6">
                    <h3 className="mb-4">Selected Image</h3>
                    <div className="relative">
                      <img 
                        src={selectedImage} 
                        alt="Selected" 
                        className="w-full rounded-lg shadow-md"
                      />
                      {analysisResult && (
                        <div className="absolute inset-0 rounded-lg overflow-hidden">
                          {analysisResult.detections.map((detection, index) => (
                            <div
                              key={index}
                              className={`absolute w-3 h-3 rounded-full ${
                                detection.type === 'hazard' ? 'bg-red-500' :
                                detection.type === 'safe' ? 'bg-green-500' :
                                'bg-blue-500'
                              } animate-pulse`}
                              style={{
                                left: `${detection.position.x}%`,
                                top: `${detection.position.y}%`,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <Button 
                      onClick={analyzeImage}
                      disabled={isProcessing}
                      className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
                    >
                      {isProcessing ? 'Analyzing...' : 'Analyze Scene'}
                    </Button>
                  </div>
                )}
              </Card>
            </div>

            {/* Right Column - Results */}
            <div className="space-y-6">
              {/* Processing Status */}
              {isProcessing && (
                <Card className="p-6">
                  <h3 className="mb-4">Processing...</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-gray-600">Vision Analysis</span>
                        <span className="text-sm text-gray-600">100%</span>
                      </div>
                      <Progress value={100} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-gray-600">Language Processing</span>
                        <span className="text-sm text-gray-600">75%</span>
                      </div>
                      <Progress value={75} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-gray-600">Generating Guidance</span>
                        <span className="text-sm text-gray-600">45%</span>
                      </div>
                      <Progress value={45} />
                    </div>
                  </div>
                </Card>
              )}

              {/* Analysis Results */}
              {analysisResult && (
                <>
                  {/* Safety Assessment */}
                  <Card className={`p-6 border-2 ${getSafetyColor(analysisResult.overallSafety)}`}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl">Safety Assessment</h3>
                      {analysisResult.overallSafety === 'safe' && <CheckCircle className="w-6 h-6" />}
                      {analysisResult.overallSafety === 'caution' && <AlertTriangle className="w-6 h-6" />}
                      {analysisResult.overallSafety === 'danger' && <AlertTriangle className="w-6 h-6" />}
                    </div>
                    <Badge className="text-lg px-4 py-2" variant={
                      analysisResult.overallSafety === 'danger' ? 'destructive' : 'default'
                    }>
                      {analysisResult.overallSafety.toUpperCase()}
                    </Badge>
                  </Card>

                  {/* Audio Guidance */}
                  <Card className="p-6 bg-gradient-to-br from-purple-50 to-pink-50">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl">Audio Guidance</h3>
                      <div className="flex gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => setIsMuted(!isMuted)}
                        >
                          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </Button>
                        <Button
                          onClick={isPlaying ? stopSpeaking : speakGuidance}
                          disabled={isMuted}
                          className="bg-purple-600 hover:bg-purple-700"
                        >
                          {isPlaying ? (
                            <>
                              <Pause className="w-4 h-4 mr-2" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" />
                              Play Audio
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <p className="text-gray-700 leading-relaxed">{analysisResult.guidance}</p>
                  </Card>

                  {/* Scene Description */}
                  <Card className="p-6">
                    <h3 className="mb-4">Scene Description</h3>
                    <p className="text-gray-700">{analysisResult.description}</p>
                  </Card>

                  {/* Detected Objects */}
                  <Card className="p-6">
                    <h3 className="mb-4">Detected Objects & Hazards</h3>
                    <div className="space-y-3">
                      {analysisResult.detections.map((detection, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <Badge variant={getDetectionColor(detection.type) as any}>
                              {detection.type}
                            </Badge>
                            <span>{detection.object}</span>
                          </div>
                          <span className="text-sm text-gray-600">
                            {(detection.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              )}

              {/* Empty State */}
              {!selectedImage && !isProcessing && !analysisResult && (
                <Card className="p-12 text-center">
                  <Camera className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-xl mb-2 text-gray-500">No Image Selected</h3>
                  <p className="text-gray-400">Upload an image or use your camera to start analysis</p>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden canvas for camera capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
