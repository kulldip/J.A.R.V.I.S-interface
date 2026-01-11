
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LogEntry, SystemMetric } from './types';
import { decode, encode, decodeAudioData, createBlob } from './utils/audio';

const SYSTEM_INSTRUCTION = `You are J.A.R.V.I.S., Tony Stark's highly sophisticated AI assistant. 
Your tone is professional, efficient, slightly witty, and British. 
You should address the user as "Sir" or "Ma'am" or "Mr. Stark" if they prefer. 
Focus on system diagnostics, tactical information, and helpful problem-solving. 
Keep your responses concise and tailored for a high-stakes, fast-paced environment.`;

const MOCK_METRICS: SystemMetric[] = [
  { label: "ARC REACTOR OUTPUT", value: 98.4, unit: "%", trend: "stable" },
  { label: "MARK LXXXV INTEGRITY", value: 100, unit: "%", trend: "stable" },
  { label: "NEURAL INTERFACE", value: 4.2, unit: "ms", trend: "up" },
  { label: "ENVIRONMENTAL PSI", value: 14.7, unit: "psi", trend: "stable" },
];

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<SystemMetric[]>(MOCK_METRICS);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState<string>("SYSTEMS STANDBY");
  
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((sender: LogEntry['sender'], text: string) => {
    const newEntry: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      sender,
      text,
    };
    setLogs(prev => [...prev.slice(-49), newEntry]);
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Update metrics randomly for aesthetic effect
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => prev.map(m => ({
        ...m,
        value: m.label.includes("PSI") ? m.value : +(m.value + (Math.random() * 0.4 - 0.2)).toFixed(1)
      })));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      setStatus("INITIALIZING NEURAL LINK...");
      const ai = new GoogleGenAI({ apiKey: (process.env as any).API_KEY });
      
      const audioContextIn = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const audioContextOut = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextInRef.current = audioContextIn;
      audioContextOutRef.current = audioContextOut;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus("ONLINE");
            setIsActive(true);
            addLog('SYSTEM', 'Neural link established. Good morning, Sir.');
            
            const source = audioContextIn.createMediaStreamSource(stream);
            const scriptProcessor = audioContextIn.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextIn.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              addLog('JARVIS', text);
            }

            if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              setIsSpeaking(true);
              
              const audioCtx = audioContextOutRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                audioCtx,
                24000,
                1
              );
              
              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioCtx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const source of sourcesRef.current) {
                source.stop();
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (e) => {
            console.error(e);
            setStatus("CONNECTION ERROR");
            addLog('SYSTEM', 'Neural link failed. Attempting to reroute.');
          },
          onclose: () => {
            setIsActive(false);
            setStatus("SYSTEMS STANDBY");
            addLog('SYSTEM', 'Neural link terminated.');
          }
        },
        config: {
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
      console.error(err);
      setStatus("INITIALIZATION FAILED");
    }
  };

  const handleStop = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextInRef.current) audioContextInRef.current.close();
    if (audioContextOutRef.current) audioContextOutRef.current.close();
    setIsActive(false);
    setStatus("SYSTEMS STANDBY");
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col items-center justify-center p-6 bg-slate-950">
      {/* Background HUD Elements */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-cyan-500/30 rounded-full animate-rotate-slow"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-dashed border-cyan-400/20 rounded-full animate-rotate-fast"></div>
        <div className="scanline"></div>
      </div>

      {/* Header HUD */}
      <header className="absolute top-6 left-6 right-6 flex justify-between items-start z-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tighter text-cyan-400 flex items-center gap-3">
            <span className="w-2 h-6 bg-cyan-500 inline-block"></span>
            J.A.R.V.I.S. OS v4.2.1
          </h1>
          <p className="text-[10px] text-cyan-600 uppercase tracking-widest pl-5">
            Neural Interface System / Stark Industries
          </p>
        </div>
        <div className="text-right">
          <div className="text-cyan-400 text-sm font-bold">{status}</div>
          <div className="text-[10px] text-cyan-600">STARK_NET_SECURE_ENCRYPTION_AES256</div>
        </div>
      </header>

      {/* Main Center UI */}
      <main className="relative flex-1 w-full flex items-center justify-between gap-8 z-10 px-12">
        {/* Left Diagnostics */}
        <aside className="w-72 space-y-4">
          <div className="glass p-4 rounded-sm border-l-4 border-l-cyan-500">
            <h3 className="text-[10px] text-cyan-600 mb-3 tracking-widest uppercase font-bold">Diagnostics</h3>
            <div className="space-y-4">
              {metrics.map((m, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-[10px] text-cyan-500 font-bold uppercase">
                    <span>{m.label}</span>
                    <span>{m.value}{m.unit}</span>
                  </div>
                  <div className="h-1 bg-cyan-950 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-cyan-400 transition-all duration-1000" 
                      style={{ width: `${m.value}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass p-4 rounded-sm border-l-4 border-l-amber-500/50">
            <h3 className="text-[10px] text-amber-600 mb-3 tracking-widest uppercase font-bold">Threat Assessment</h3>
            <div className="text-xs text-amber-500/70">NO IMMEDIATE THREATS DETECTED WITHIN PERIMETER.</div>
          </div>
        </aside>

        {/* Center Reactor Core */}
        <div className="flex flex-col items-center gap-8">
          <div className={`relative w-64 h-64 rounded-full flex items-center justify-center transition-all duration-500 ${isSpeaking ? 'scale-110' : 'scale-100'}`}>
            {/* Outer rings */}
            <div className="absolute inset-0 rounded-full border border-cyan-500/20"></div>
            <div className={`absolute inset-4 rounded-full border-2 border-cyan-400/30 ${isSpeaking ? 'animate-pulse' : ''}`}></div>
            
            {/* Inner Core (ARC Reactor visual) */}
            <div className="w-32 h-32 rounded-full glass flex items-center justify-center relative shadow-[0_0_30px_rgba(34,211,238,0.2)]">
               <div className={`w-16 h-16 rounded-full bg-cyan-500 flex items-center justify-center shadow-[0_0_40px_rgba(34,211,238,0.6)] ${isSpeaking ? 'animate-pulse-cyan' : ''}`}>
                  <div className="w-8 h-8 rounded-full border-4 border-white/20"></div>
               </div>
               {/* Decorative Lines */}
               {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
                 <div key={deg} className="absolute w-full h-[1px] bg-cyan-500/20" style={{ transform: `rotate(${deg}deg)` }}></div>
               ))}
            </div>

            {/* Speaking visualizer rings */}
            {isSpeaking && (
              <>
                <div className="absolute inset-0 border-2 border-cyan-400 rounded-full animate-ping opacity-20"></div>
                <div className="absolute inset-0 border-2 border-cyan-400 rounded-full animate-ping opacity-10 [animation-delay:0.5s]"></div>
              </>
            )}
          </div>

          <div className="flex flex-col items-center gap-4">
            {!isActive ? (
              <button 
                onClick={handleStart}
                className="px-10 py-3 bg-cyan-950 border border-cyan-500 text-cyan-400 font-bold tracking-[0.2em] hover:bg-cyan-900 hover:text-white transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)] active:scale-95 uppercase text-sm"
              >
                Initiate Systems
              </button>
            ) : (
              <button 
                onClick={handleStop}
                className="px-10 py-3 bg-red-950/30 border border-red-500/50 text-red-500 font-bold tracking-[0.2em] hover:bg-red-950/50 hover:text-red-400 transition-all active:scale-95 uppercase text-sm"
              >
                Disconnect
              </button>
            )}
            {isActive && (
              <div className="flex items-center gap-2 text-[10px] text-cyan-600 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
                LISTENING...
              </div>
            )}
          </div>
        </div>

        {/* Right Interaction Log */}
        <aside className="w-80 h-[60vh] glass rounded-sm border-r-4 border-r-cyan-500 flex flex-col">
          <div className="p-3 border-b border-cyan-500/20 bg-cyan-500/5">
            <h3 className="text-[10px] text-cyan-400 tracking-widest uppercase font-bold">Mission Log / Transcript</h3>
          </div>
          <div 
            ref={logContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
          >
            {logs.length === 0 && (
              <div className="text-[10px] text-cyan-900 italic">Waiting for input...</div>
            )}
            {logs.map((log) => (
              <div key={log.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] text-cyan-700">{log.timestamp}</span>
                  <span className={`text-[9px] font-bold ${
                    log.sender === 'JARVIS' ? 'text-cyan-400' : 
                    log.sender === 'SYSTEM' ? 'text-amber-500' : 'text-slate-400'
                  }`}>[{log.sender}]</span>
                </div>
                <div className={`text-[11px] leading-relaxed ${log.sender === 'USER' ? 'text-slate-300' : 'text-cyan-100'}`}>
                  {log.text}
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-cyan-500/10 bg-black/20 flex justify-between text-[8px] text-cyan-800">
             <span>BUFFER: {logs.length}/50</span>
             <span>AUTO-ARCHIVE: ON</span>
          </div>
        </aside>
      </main>

      {/* Footer Status Bar */}
      <footer className="absolute bottom-6 left-6 right-6 flex items-center justify-between text-[10px] text-cyan-700 border-t border-cyan-500/10 pt-4 z-10">
        <div className="flex gap-6 uppercase">
          <div className="flex items-center gap-2">
             <span className="w-1 h-1 bg-cyan-500 rounded-full"></span>
             LATENCY: 42MS
          </div>
          <div className="flex items-center gap-2">
             <span className="w-1 h-1 bg-cyan-500 rounded-full"></span>
             ENCRYPTION: AES-256
          </div>
          <div className="flex items-center gap-2">
             <span className="w-1 h-1 bg-cyan-500 rounded-full"></span>
             PROTOCOL: JARVIS-L-04
          </div>
        </div>
        <div className="uppercase tracking-[0.2em] font-bold text-cyan-500/40">
          Integrated Artificial Intelligence System
        </div>
      </footer>
    </div>
  );
};

export default App;
