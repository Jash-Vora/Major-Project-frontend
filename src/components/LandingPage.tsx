import { Eye, Brain, Volume2, Smartphone, Shield, Navigation, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface LandingPageProps {
  onNavigateToDemo: () => void;
  onNavigateToVQA: () => void;  // add this
}

export function LandingPage({ onNavigateToDemo, onNavigateToVQA }: LandingPageProps) {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-8 h-8 text-blue-600" />
            <span className="text-xl">VLM Vision Assist</span>
          </div>
          <Button onClick={onNavigateToDemo} className="bg-blue-600 hover:bg-blue-700">
            Try Demo <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-block px-4 py-2 bg-blue-100 text-blue-700 rounded-full mb-6">
              AI-Powered Accessibility
            </div>
            <h1 className="text-5xl mb-6">Navigate the World with Confidence</h1>
            <p className="text-xl text-gray-600 mb-8">
              Advanced AI vision technology that helps visually impaired individuals detect hazards, recognize objects, and navigate safely with real-time audio guidance.
            </p>
            <div className="flex gap-4">
              <Button onClick={onNavigateToDemo} size="lg" className="bg-blue-600 hover:bg-blue-700">
                Try Interactive Demo
              </Button>
              <Button variant="outline" size="lg" onClick={() => {
                document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
              }}>
                Learn More
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-400 rounded-2xl blur-3xl opacity-20"></div>
            <ImageWithFallback 
              src="https://images.unsplash.com/photo-1707325345108-82761c948d32?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aXN1YWxseSUyMGltcGFpcmVkJTIwYXNzaXN0YW5jZSUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzYyMjYyNjY1fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
              alt="Assistive technology"
              className="relative rounded-2xl shadow-2xl w-full"
            />
          </div>
        </div>
      </section>

      {/* Why It Matters */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center mb-16">
            <h2 className="text-4xl mb-6">Why VLM Vision Assist?</h2>
            <p className="text-xl text-gray-600">
              Traditional navigation tools provide limited context. Our AI-powered solution understands complex, dynamic scenes in real-time to enhance safety and independence.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <Card className="p-6 text-center hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="mb-3">Contextual Understanding</h3>
              <p className="text-gray-600">Goes beyond simple object detection to understand scenes and provide meaningful guidance</p>
            </Card>
            <Card className="p-6 text-center hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Navigation className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="mb-3">Real-Time Navigation</h3>
              <p className="text-gray-600">Instant hazard detection and navigation assistance in unfamiliar environments</p>
            </Card>
            <Card className="p-6 text-center hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-pink-600" />
              </div>
              <h3 className="mb-3">Increased Independence</h3>
              <p className="text-gray-600">Empowering users to navigate confidently without constant assistance</p>
            </Card>
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl mb-4 text-center">Powerful Features</h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Built with cutting-edge Vision-Language Models to deliver comprehensive accessibility solutions
          </p>
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <Card className="p-6 bg-white hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                <Brain className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="mb-4">Smart Object Recognition</h3>
              <p className="text-gray-600">
                Identifies obstacles, hazards, and important objects in real-time using advanced AI vision models.
              </p>
            </Card>
            <Card className="p-6 bg-white hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-6">
                <Volume2 className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="mb-4">Natural Audio Guidance</h3>
              <p className="text-gray-600">
                Clear, intuitive voice instructions that describe your surroundings and guide you safely.
              </p>
            </Card>
            <Card className="p-6 bg-white hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mb-6">
                <Smartphone className="w-8 h-8 text-pink-600" />
              </div>
              <h3 className="mb-4">Mobile-First Design</h3>
              <p className="text-gray-600">
                Works seamlessly on smartphones and edge devices for practical, on-the-go assistance.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="container mx-auto px-4 py-20">
        <h2 className="text-4xl mb-4 text-center">How It Works</h2>
        <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
          Our intelligent system processes visual information and delivers actionable guidance in four simple steps
        </p>
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center mb-12">
            <div>
              <ImageWithFallback 
                src="https://images.unsplash.com/photo-1696517170961-661e9dca962e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxBSSUyMHZpc2lvbiUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzYyMjYyNjY1fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                alt="AI Vision Technology"
                className="rounded-xl shadow-lg w-full"
              />
            </div>
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center">1</div>
                <div>
                  <h3 className="mb-2">Capture Your Environment</h3>
                  <p className="text-gray-600">Use your smartphone camera or wearable device to capture the scene around you</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-purple-600 text-white rounded-full flex items-center justify-center">2</div>
                <div>
                  <h3 className="mb-2">AI Vision Analysis</h3>
                  <p className="text-gray-600">Advanced vision-language models analyze the scene, identifying objects, hazards, and contextual information</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-pink-600 text-white rounded-full flex items-center justify-center">3</div>
                <div>
                  <h3 className="mb-2">Generate Guidance</h3>
                  <p className="text-gray-600">The system creates detailed descriptions and navigation instructions tailored to your surroundings</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center">4</div>
                <div>
                  <h3 className="mb-2">Receive Audio Instructions</h3>
                  <p className="text-gray-600">Clear, natural voice guidance helps you navigate safely with real-time alerts and directions</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-blue-600 to-purple-600 py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl text-white mb-6">See It In Action</h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Experience how AI-powered vision assistance can transform everyday navigation and enhance independence.
          </p>
          <div className="flex gap-4 justify-center">
            <Button onClick={onNavigateToDemo} size="lg" className="bg-white text-blue-600 hover:bg-gray-100">
              Try Live Demo <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button onClick={onNavigateToVQA} size="lg" className="bg-transparent border-2 border-white text-white hover:bg-white/10">
              Voice Q&A Demo <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Eye className="w-6 h-6 text-blue-400" />
            <span className="text-white">VLM Vision Assist</span>
          </div>
          <p>Empowering Independence Through AI Technology</p>
        </div>
      </footer>
    </div>
  );
}
