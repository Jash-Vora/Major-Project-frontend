# VLM Vision Assist

AI-powered navigation assistance system for visually impaired individuals using Vision-Language Models.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone or download this project

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to:
```
http://localhost:5173
```

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` folder.

## 📁 Project Structure

```
vlm-vision-assist/
├── src/
│   ├── components/
│   │   ├── ui/              # Reusable UI components
│   │   ├── LandingPage.tsx  # Main landing page
│   │   ├── DemoInterface.tsx # Interactive demo
│   │   └── ImageWithFallback.tsx
│   ├── lib/
│   │   └── utils.ts         # Utility functions
│   ├── styles/
│   │   └── globals.css      # Global styles
│   ├── App.tsx              # Main app component
│   └── main.tsx             # Entry point
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 🎯 Features

- **Smart Object Recognition**: Real-time hazard and object detection
- **Audio Guidance**: Text-to-speech navigation instructions
- **Mobile Support**: Camera integration for on-the-go use
- **Interactive Demo**: Upload images or use webcam for testing

## 🛠️ Technologies Used

- React 18
- TypeScript
- Tailwind CSS v4
- Vite
- Lucide React (icons)

## 📝 Notes

- The demo uses mock data to simulate VLM responses
- To integrate real AI models, replace the `analyzeImage` function in `DemoInterface.tsx`
- Camera access requires HTTPS in production

## 🔧 Troubleshooting

If you encounter errors:

1. Delete `node_modules` folder and `package-lock.json`
2. Run `npm install` again
3. Clear your browser cache
4. Try `npm run dev` again

## 📄 License

This project is for educational purposes.
