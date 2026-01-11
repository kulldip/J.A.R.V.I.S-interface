
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
  { label: "POWER RESERVE", value: 43.2, unit: "TWh", max: 50 },
  { label: "NEURAL SYNC", value: 99.8, unit: "%", max: 100 },
];

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<SystemMetric[]>(INITIAL_METRICS);
  const [isJarvisSpeaking, setIsJarvisSpeaking] = useState(false);
  const [userVol, setUserVol] = useState(0);
  const [statusText, setStatusText] = useState("SYSTEM STANDBY");
  
  const audioCtxInRef = useRef<AudioContext | null>(null);
  const audioCtxOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((sender: LogEntry['sender'], text: string) => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      sender,
      text,
    };
    setLogs(prev => [...prev.slice(-30), entry]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Aesthetic metric fluctuation
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => prev.map(m => ({
        ...m,
        value: Math.max(0, Math.min(m.max, m.value + (Math.random() * 0.2 - 0.1)))
      })));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const startSession = async () => {
    try {
      setStatusText("ESTABLISHING NEURAL LINK...");
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
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
            addLog('SYSTEM', 'J.A.R.V.I.S. Online. All systems green.');
            
            const source = audioCtxIn.createMediaStreamSource(stream);
            const processor = audioCtxIn.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
              const rms = Math.sqrt(sum / input.length);
              setUserVol(rms * 10); // Scale for UI

              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: createBlob(input) });
              });
            };
            
            source.connect(processor);
            processor.connect(audioCtxIn.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              addLog('JARVIS', message.serverContent.outputTranscription.text);
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
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
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsJarvisSpeaking(false);
            }
          },
          onerror: () => setStatusText("LINK FAILURE"),
          onclose: () => {
            setIsActive(false);
            setStatusText("STANDBY");
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
      setStatusText("INIT FAILED");
    }
  };

  const stopSession = () => {
    sessionRef.current?.close();
    audioCtxInRef.current?.close();
    audioCtxOutRef.current?.close();
    setIsActive(false);
    setUserVol(0);
  };

  return (
    <div className="relative h-screen w-screen flex flex-col items-center justify-center p-8 overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] border border-cyan-500/20 rounded-full animate-rotate-slow"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] border border-dashed border-cyan-400/10 rounded-full animate-rotate-fast"></div>
        <div className="scanline"></div>
      </div>

      {/* Header HUD */}
      <header className="absolute top-8 left-8 right-8 flex justify-between z-10">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tighter text-cyan-400 flex items-center gap-3">
            <span className="w-1.5 h-8 bg-cyan-500"></span>
            J.A.R.V.I.S. <span className="text-cyan-800 text-lg">MARK_OS_4.0</span>
          </h1>
          <p className="text-[10px] text-cyan-600/60 uppercase tracking-[0.3em]">Neural Bridge / Interface Active</p>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold tracking-widest ${statusText === 'ONLINE' ? 'text-cyan-400' : 'text-amber-500'}`}>{statusText}</div>
          <div className="text-[8px] text-cyan-700 mt-1 uppercase">Stark Industries Secure Channel</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-7xl flex flex-1 items-center justify-between gap-12 z-10 px-4">
        
        {/* Left Side: System Health */}
        <aside className="w-64 space-y-4">
          <div className="glass p-5 border-l-2 border-l-cyan-500/50">
            <h3 className="text-[10px] text-cyan-500 mb-4 tracking-widest uppercase font-bold">System Status</h3>
            <div className="space-y-5">
              {metrics.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between text-[9px] text-cyan-400 uppercase font-bold">
                    <span>{m.label}</span>
                    <span>{m.value.toFixed(1)}{m.unit}</span>
                  </div>
                  <div className="h-0.5 bg-cyan-950/50 w-full overflow-hidden">
                    <div 
                      className="h-full bg-cyan-500 shadow-[0_0_10px_#22d3ee] transition-all duration-500"
                      style={{ width: `${(m.value / m.max) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="glass p-4 border-l-2 border-l-red-500/30">
            <h3 className="text-[9px] text-red-400 uppercase tracking-widest mb-1">Alert Matrix</h3>
            <p className="text-[10px] text-red-500/50">No immediate external threats identified. Perimeter secured.</p>
          </div>
        </aside>

        {/* Center: Arc Reactor UI */}
        <div className="flex flex-col items-center gap-12">
          <div className={`relative w-72 h-72 flex items-center justify-center transition-all duration-300 ${isJarvisSpeaking ? 'scale-105' : 'scale-100'}`}>
            
            {/* User Voice Pulse */}
            {isActive && (
              <div 
                className="absolute rounded-full border border-cyan-400/30 transition-all duration-75"
                style={{ 
                  inset: `-${20 + userVol * 40}px`, 
                  opacity: Math.min(0.6, userVol),
                  filter: `blur(${userVol * 10}px)`
                }}
              ></div>
            )}

            {/* Core Visual */}
            <div className="absolute inset-0 border border-cyan-500/20 rounded-full animate-rotate-slow"></div>
            <div className={`absolute inset-4 border-2 border-cyan-400/40 rounded-full ${isJarvisSpeaking ? 'animate-pulse' : ''}`}></div>
            
            <div className="w-40 h-40 glass rounded-full flex items-center justify-center relative shadow-[0_0_40px_rgba(34,211,238,0.2)]">
               <div className={`w-20 h-20 rounded-full bg-cyan-500 flex items-center justify-center shadow-[0_0_50px_rgba(34,211,238,0.8)] ${isJarvisSpeaking ? 'animate-pulse' : ''}`}>
                  <div className="w-10 h-10 rounded-full border-2 border-white/30"></div>
                  <div className="absolute inset-0 border-[1px] border-white/5 rounded-full animate-rotate-fast"></div>
               </div>
               {/* Detail lines */}
               {[0, 60, 120, 180, 240, 300].map(deg => (
                 <div key={deg} className="absolute w-full h-[1px] bg-cyan-500/10" style={{ transform: `rotate(${deg}deg)` }}></div>
               ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-6">
            {!isActive ? (
              <button 
                onClick={startSession}
                className="group relative px-12 py-4 bg-transparent text-cyan-400 font-bold tracking-[0.3em] overflow-hidden border border-cyan-500/40 hover:border-cyan-400 transition-all"
              >
                <div className="absolute inset-0 bg-cyan-500/10 group-hover:bg-cyan-500/20 transition-all"></div>
                <span className="relative z-10 uppercase text-xs">Initialize J.A.R.V.I.S.</span>
              </button>
            ) : (
              <button 
                onClick={stopSession}
                className="group relative px-10 py-3 bg-red-950/20 text-red-500 font-bold tracking-[0.3em] overflow-hidden border border-red-500/40 hover:bg-red-950/40 transition-all"
              >
                <span className="relative z-10 uppercase text-xs">Terminate Link</span>
              </button>
            )}
            
            {isActive && (
              <div className="flex items-center gap-3">
                 <div className="flex items-end gap-1 h-4">
                    {[...Array(6)].map((_, i) => (
                      <div 
                        key={i} 
                        className="w-1 bg-cyan-500 transition-all duration-100"
                        style={{ height: `${15 + (Math.random() * userVol * 85)}%` }}
                      ></div>
                    ))}
                 </div>
                 <span className="text-[10px] text-cyan-600 font-bold tracking-widest uppercase animate-pulse">Neural Active</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Logs */}
        <aside className="w-80 h-[65vh] glass flex flex-col border-r-2 border-r-cyan-500/50">
          <div className="p-4 border-b border-cyan-500/10 bg-cyan-500/5 flex justify-between items-center">
            <h3 className="text-[10px] text-cyan-400 tracking-[0.2em] uppercase font-bold">Mission Ledger</h3>
            <span className="text-[8px] text-cyan-800">BUFF_L: {logs.length}</span>
          </div>
          <div 
            ref={logRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
          >
            {logs.length === 0 && <p className="text-[10px] text-cyan-900 italic">Listening for user sequence...</p>}
            {logs.map(log => (
              <div key={log.id} className="group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[7px] text-cyan-800">{log.timestamp}</span>
                  <span className={`text-[9px] font-bold ${
                    log.sender === 'JARVIS' ? 'text-cyan-400' : log.sender === 'SYSTEM' ? 'text-amber-500' : 'text-slate-400'
                  }`}>[{log.sender}]</span>
                </div>
                <p className={`text-[11px] leading-relaxed ${log.sender === 'USER' ? 'text-slate-300' : 'text-cyan-100/90'}`}>
                  {log.text}
                </p>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-cyan-500/10 text-[7px] text-cyan-900 flex justify-between uppercase">
            <span>Encrypted Stream</span>
            <span>Alpha Priority</span>
          </div>
        </aside>
      </main>

      {/* Footer Status Bar */}
      <footer className="absolute bottom-8 left-8 right-8 flex items-center justify-between z-10 border-t border-cyan-500/10 pt-4">
        <div className="flex gap-8 text-[10px] text-cyan-800 uppercase tracking-widest">
          <div className="flex items-center gap-2">
             <span className={`w-1 h-1 rounded-full ${isActive ? 'bg-cyan-500 shadow-[0_0_5px_#22d3ee]' : 'bg-slate-700'}`}></span>
             Link: {isActive ? 'Established' : 'Offline'}
          </div>
          <div>Lat: 28ms</div>
          <div>B-Width: 1.2 GB/S</div>
        </div>
        <div className="text-[9px] text-cyan-600/40 tracking-[0.4em] uppercase font-bold">
          Stark Industries HUD Protocol v4.0.0
        </div>
      </footer>
    </div>
  );
};

export default App;
