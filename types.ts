
export interface LogEntry {
  id: string;
  timestamp: string;
  sender: 'JARVIS' | 'USER' | 'SYSTEM';
  text: string;
}

export interface SystemMetric {
  label: string;
  value: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
}
