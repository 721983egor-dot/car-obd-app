/** Shared OBD types for companion (Car product, phase 2). */

export type TransportKind = 'classic' | 'ble' | 'mock';

export type ConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnected';

export interface ObdDevice {
  id: string;
  name: string;
  address?: string;
  transport: TransportKind;
  /** Extra (RSSI, paired, etc.) */
  meta?: Record<string, string | number | boolean>;
}

export interface RawPidResponse {
  pid: string;
  command: string;
  raw: string;
  at: string;
}

export interface ParsedPidValue {
  pid: string;
  label: string;
  unit: string;
  value: number | string | null;
  raw: string;
}

export interface VinResult {
  vin: string | null;
  raw: string;
  note?: string;
}

/** Diagnostic Trouble Code (Mode 03). */
export interface DtcCode {
  code: string;
  descriptionRu: string | null;
}

export interface DtcResult {
  codes: DtcCode[];
  raw: string;
  note?: string;
}

export interface ObdReadingSnapshot {
  recordedAt: string;
  vin: string | null;
  rpm: number | null;
  speedKmh: number | null;
  coolantTempC: number | null;
  batteryVoltage: number | null;
  dtcs: DtcCode[];
  parameters: ParsedPidValue[];
  supportedPids: string[];
  rawPids: RawPidResponse[];
  device?: Pick<ObdDevice, 'id' | 'name' | 'transport'>;
}

export interface ObdTransport {
  readonly kind: TransportKind;
  /** Human-readable availability note (e.g. Classic needs Dev Client). */
  readonly availabilityNote: string;
  isAvailable(): Promise<boolean>;
  scan(onDevice: (device: ObdDevice) => void): Promise<void>;
  stopScan(): Promise<void>;
  connect(device: ObdDevice): Promise<void>;
  disconnect(): Promise<void>;
  /** Send AT/OBD line (without trailing CR) and wait for response until prompt `>`. */
  sendCommand(command: string, timeoutMs?: number): Promise<string>;
}
