
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LogEntry, SystemMetric } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio';

const SYSTEM_INSTRUCTION = `You are J.A.R.V.I.S., the highly advanced AI from Stark Industries. 
Tone: Sophisticated, British, efficient, witty, and loyal. 
Always refer to the user as "Sir" or "Ma'am" or "Mr. Stark".
Provide real-time data analysis, technical assistance, and system status updates. 
Keep your responses relatively brief but intelligent. If asked about status, refer to current arc reactor and suit integrity levels.`;

const INITIAL_METRICS: SystemMetric[] = [
  { label: "ARC REACTOR", value: 98.4, unit: "%", max: 100 },
  { label: "SUIT INTEGRITY", value: 100, unit: "%", max: 100 },
  { label: "OXYGEN LVL", value: 21.0, unit: "%", max: 21 },
  { label: "EXT TEMP", value: 22.0, unit: "°C", max: 100 },
];

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<SystemMetric[]>(INITIAL_METRICS);
  const [isJarvisSpeaking, setIsJarvisSpeaking] = useState(false);
  const [userVol, setUserVol] = useState(0);
  const [statusText, setStatusText] = useState("SYSTEM STANDBY");
  const [isConnecting, setIsConnecting] = useState(false);
  
  const audioCtxInRef = useRef<AudioContext | null>(null);
  const audioCtxOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((sender: LogEntry['sender'], text: string) => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      sender,
      text,
    };
    setLogs(prev => [...prev.slice(-30), entry]);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Aesthetic metric fluctuation
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => prev.map(m => {
        if (m.label === "ARC REACTOR") return { ...m, value: Math.max(98, Math.min(99, m.value + (Math.random() * 0.1 - 0.05))) };
        if (m.label === "EXT TEMP") return { ...m, value: Math.max(20, Math.min(25, m.value + (Math.random() * 0.4 - 0.2))) };
        return m;
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const startSession = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    setStatusText("CALIBRATING NEURAL LINK...");
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const audioCtxIn = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const audioCtxOut = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxInRef.current = audioCtxIn;
      audioCtxOutRef.current = audioCtxOut;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatusText("ONLINE");
            setIsActive(true);
            setIsConnecting(false);
            addLog('SYSTEM', 'J.A.R.V.I.S. Neural Bridge active. Systems nominal.');
            
            const source = audioCtxIn.createMediaStreamSource(stream);
            // ScriptProcessor is used for compatibility, ensure it's connected to destination
            const processor = audioCtxIn.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
              const rms = Math.sqrt(sum / input.length);
              setUserVol(Math.min(1, rms * 15));

              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: createBlob(input) });
              });
            };
            
            source.connect(processor);
            processor.connect(audioCtxIn.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle output transcription
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (text.trim()) {
                 addLog('JARVIS', text);
              }
            }

            // Handle audio output
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              setIsJarvisSpeaking(true);
              const audioCtx = audioCtxOutRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
              
              const buffer = await decodeAudioData(decode(audioData), audioCtx, 24000, 1);
              const source = audioCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(audioCtx.destination);
              
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsJarvisSpeaking(false);
              };
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => {
                try { s.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsJarvisSpeaking(false);
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setStatusText("LINK ERROR");
            addLog('SYSTEM', 'Neural link encountered an error. Check credentials.');
            stopSession();
          },
          onclose: () => {
            setIsActive(false);
            setIsConnecting(false);
            setStatusText("STANDBY");
            addLog('SYSTEM', 'Neural link terminated.');
          }
        },
        config: {
          // Fix: Use Modality enum instead of string literal to satisfy TypeScript requirements
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Init Error:", err);
      setStatusText("INIT FAILED");
      setIsConnecting(false);
      addLog('SYSTEM', 'Failed to initialize neural link.');
    }
  };

  const stopSession = () => {
    sessionRef.current?.close();
    audioCtxInRef.current?.close();
    audioCtxOutRef.current?.close();
    sessionRef.current = null;
    audioCtxInRef.current = null;
    audioCtxOutRef.current = null;
    setIsActive(false);
    setIsConnecting(false);
    setUserVol(0);
    setIsJarvisSpeaking(false);
  };

  return (
    <div className="relative h-screen w-screen flex flex-col items-center justify-center p-6 md:p-12 overflow-hidden text-cyan-400">
      
      {/* Background HUD Layers */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] h-[120vw] border border-cyan-500/10 rounded-full animate-rotate-slow"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] border border-dashed border-cyan-400/5 rounded-full animate-rotate-fast"></div>
        <div className="scanline"></div>
      </div>

      {/* Top HUD Bar */}
      <header className="absolute top-8 left-8 right-8 flex justify-between items-start z-20">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
             <div className="w-1.5 h-8 bg-cyan-500 shadow-[0_0_10px_#22d3ee]"></div>
             <h1 className="text-2xl md:text-3xl font-bold tracking-tighter uppercase">J.A.R.V.I.S.</h1>
          </div>
          <p className="text-[10px] text-cyan-700 uppercase tracking-[0.4em] pl-4">Neural Interface / OS_V4.2</p>
        </div>
        
        <div className="flex flex-col items-end gap-1">
          <div className={`px-4 py-1 border border-cyan-500/30 glass text-xs font-bold tracking-widest ${isActive ? 'text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'text-amber-500'}`}>
            {statusText}
          </div>
          <div className="text-[8px] text-cyan-800 uppercase mt-1">Stark Secure Link / AES-256</div>
        </div>
      </header>

      {/* Main Interface Layout */}
      <main className="w-full flex flex-1 items-center justify-between gap-6 md:gap-12 z-10">
        
        {/* Left Aside: System Diagnostics */}
        <aside className="hidden lg:flex flex-col gap-4 w-64">
          <div className="glass p-5 border-l-4 border-l-cyan-500 transition-all hover:bg-cyan-950/20">
            <h3 className="text-[10px] text-cyan-600 mb-4 tracking-widest uppercase font-bold border-b border-cyan-900 pb-2 flex justify-between">
              <span>Diagnostics</span>
              <span className="text-cyan-400 animate-pulse">LIVE</span>
            </h3>
            <div className="space-y-6">
              {metrics.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between text-[9px] text-cyan-400 uppercase font-bold tracking-tighter">
                    <span>{m.label}</span>
                    <span>{m.value.toFixed(1)}{m.unit}</span>
                  </div>
                  <div className="h-0.5 bg-cyan-950 w-full relative overflow-hidden">
                    <div 
                      className="h-full bg-cyan-500 shadow-[0_0_8px_#22d3ee] transition-all duration-1000"
                      style={{ width: `${(m.value / m.max) * 100}%` }}
                    ></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent animate-[shimmer_2s_infinite]"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="glass p-4 border-l-4 border-l-amber-500/40">
            <h3 className="text-[9px] text-amber-500 uppercase tracking-widest mb-2 font-bold">Threat Assessment</h3>
            <div className="text-[10px] text-amber-600/60 leading-tight">
              PERIMETER CLEAR. NO TARGETS IDENTIFIED IN CURRENT SECTOR.
            </div>
          </div>
        </aside>

        {/* Center: The ARC Reactor / Voice Visualizer */}
        <section className="flex-1 flex flex-col items-center justify-center gap-12">
          <div className={`relative transition-all duration-500 ${isJarvisSpeaking ? 'scale-110' : 'scale-100'}`}>
            
            {/* User Interaction Halo */}
            <div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/20 transition-all duration-100 pointer-events-none"
              style={{ 
                width: `${300 + userVol * 250}px`, 
                height: `${300 + userVol * 250}px`,
                opacity: Math.max(0.1, userVol),
                filter: `blur(${userVol * 15}px)`
              }}
            ></div>

            {/* Main Reactor Body */}
            <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center">
               {/* Decorative outer rings */}
               <div className="absolute inset-0 border border-cyan-500/20 rounded-full animate-[spin_20s_linear_infinite]"></div>
               <div className="absolute inset-6 border border-dashed border-cyan-400/30 rounded-full animate-[spin_10s_linear_infinite_reverse]"></div>
               
               {/* Core Visualizer */}
               <div className={`relative w-40 h-40 md:w-48 md:h-48 glass rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(34,211,238,0.15)] overflow-hidden transition-shadow duration-300 ${isJarvisSpeaking ? 'shadow-[0_0_80px_rgba(34,211,238,0.4)]' : ''}`}>
                  <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full bg-cyan-500/90 flex items-center justify-center relative transition-all duration-300 ${isJarvisSpeaking ? 'scale-110 shadow-[0_0_60px_#22d3ee]' : 'shadow-[0_0_20px_rgba(34,211,238,0.5)]'}`}>
                     <div className="w-12 h-12 border-4 border-white/20 rounded-full"></div>
                     <div className="absolute inset-0 border-[2px] border-white/5 rounded-full animate-spin"></div>
                  </div>
                  
                  {/* Internal detailing */}
                  {[0, 60, 120, 180, 240, 300].map(deg => (
                    <div key={deg} className="absolute w-full h-[1px] bg-cyan-400/10" style={{ transform: `rotate(${deg}deg)` }}></div>
                  ))}
               </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center gap-6">
            {!isActive ? (
              <button 
                onClick={startSession}
                disabled={isConnecting}
                className="group relative px-12 py-4 bg-transparent text-cyan-400 font-bold tracking-[0.4em] border border-cyan-500/40 hover:border-cyan-400 transition-all hover:shadow-[0_0_20px_rgba(34,211,238,0.3)] disabled:opacity-50"
              >
                <div className="absolute inset-0 bg-cyan-500/5 group-hover:bg-cyan-500/10 transition-all"></div>
                <span className="relative z-10 uppercase text-xs">Initialize System</span>
              </button>
            ) : (
              <button 
                onClick={stopSession}
                className="group relative px-10 py-3 bg-red-950/20 text-red-500 font-bold tracking-[0.3em] border border-red-500/30 hover:bg-red-950/40 transition-all hover:shadow-[0_0_15px_rgba(239,68,68,0.2)]"
              >
                <span className="relative z-10 uppercase text-xs">Terminate Neural Link</span>
              </button>
            )}
            
            {isActive && (
              <div className="flex items-center gap-4">
                 <div className="flex items-end gap-1 h-5 w-24">
                    {[...Array(8)].map((_, i) => (
                      <div 
                        key={i} 
                        className="flex-1 bg-cyan-500 transition-all duration-75"
                        style={{ height: `${20 + (Math.random() * userVol * 80)}%` }}
                      ></div>
                    ))}
                 </div>
                 <span className="text-[10px] text-cyan-500 font-bold tracking-widest uppercase animate-pulse">Neural Input Active</span>
              </div>
            )}
          </div>
        </section>

        {/* Right Aside: Interaction Logs */}
        <aside className="w-full max-w-sm h-[70vh] glass flex flex-col border-r-4 border-r-cyan-500/50 shadow-2xl">
          <div className="p-4 border-b border-cyan-500/10 bg-cyan-950/20 flex justify-between items-center">
            <h3 className="text-[10px] text-cyan-400 tracking-[0.2em] uppercase font-bold">Mission Log</h3>
            <div className="flex gap-2">
               <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></div>
               <span className="text-[8px] text-cyan-800">STREAM_V2.1</span>
            </div>
          </div>
          
          <div 
            ref={logRef}
            className="flex-1 overflow-y-auto p-5 space-y-5 scroll-smooth custom-scrollbar"
          >
            {logs.length === 0 && (
              <div className="text-[10px] text-cyan-900/50 italic text-center mt-10">System ready for biometric sequence...</div>
            )}
            {logs.map(log => (
              <div key={log.id} className="space-y-1.5 group animate-in fade-in slide-in-from-right-2 duration-300">
                <div className="flex items-center gap-2">
                  <span className="text-[7px] text-cyan-900 group-hover:text-cyan-700 transition-colors">{log.timestamp}</span>
                  <span className={`text-[9px] font-bold tracking-tighter uppercase ${
                    log.sender === 'JARVIS' ? 'text-cyan-400' : log.sender === 'SYSTEM' ? 'text-amber-500' : 'text-slate-500'
                  }`}>
                    {log.sender}
                  </span>
                </div>
                <p className={`text-[11px] leading-relaxed tracking-tight ${
                  log.sender === 'USER' ? 'text-slate-300 border-l border-slate-700 pl-3' : 'text-cyan-100/90 border-l border-cyan-900 pl-3'
                }`}>
                  {log.text}
                </p>
              </div>
            ))}
          </div>
          
          <div className="p-3 border-t border-cyan-500/5 bg-black/40 flex justify-between text-[8px] text-cyan-900 uppercase font-bold">
            <span>Buffer: {logs.length}/50</span>
            <span>Neural Sync: {isActive ? '99.9%' : '0.0%'}</span>
          </div>
        </aside>
      </main>

      {/* Bottom Footer HUD Bar */}
      <footer className="absolute bottom-8 left-8 right-8 flex flex-col md:flex-row items-center justify-between gap-4 z-20 border-t border-cyan-500/10 pt-6">
        <div className="flex flex-wrap gap-8 text-[9px] text-cyan-800 uppercase tracking-widest font-bold">
          <div className="flex items-center gap-2">
             <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-cyan-500 shadow-[0_0_10px_#22d3ee]' : 'bg-slate-800'}`}></div>
             Link Status: <span className={isActive ? 'text-cyan-600' : 'text-slate-700'}>{isActive ? 'Stable' : 'Offline'}</span>
          </div>
          <div>Location: Malibu, CA</div>
          <div>Encryption: AES-256-GCM</div>
          <div className="hidden md:block">Latency: {isActive ? '24ms' : '--'}</div>
        </div>
        
        <div className="text-[10px] text-cyan-600/30 tracking-[0.5em] uppercase font-black text-center">
          Integrated Stark AI Interface // 2025 Protocol
        </div>
      </footer>

      {/* Calibration Overlay */}
      {isConnecting && (
        <div className="absolute inset-0 z-50 glass flex flex-col items-center justify-center animate-in fade-in duration-500">
           <div className="w-64 h-1 bg-cyan-950 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-cyan-400 animate-[loading_2s_infinite]"></div>
           </div>
           <p className="text-xs font-bold tracking-[0.3em] uppercase animate-pulse">Syncing Neural Frequency...</p>
        </div>
      )}
    </div>
  );
};

export default App;
