import {
  ELM_INIT_COMMANDS,
  VIN_COMMAND,
  parseCoolant,
  parseRpm,
  parseSpeed,
  parseVin,
  pidRequest,
  STANDARD_PIDS,
} from './protocol';
import type {
  ObdDevice,
  ObdReadingSnapshot,
  ObdTransport,
  ParsedPidValue,
  RawPidResponse,
  TransportKind,
  VinResult,
} from './types';
import { BleObdTransport } from './bleTransport';
import { ClassicObdTransport } from './classicTransport';
import { MockObdTransport } from './mockTransport';

export function createTransport(kind: TransportKind): ObdTransport {
  switch (kind) {
    case 'classic':
      return new ClassicObdTransport();
    case 'ble':
      return new BleObdTransport();
    case 'mock':
    default:
      return new MockObdTransport();
  }
}

/**
 * High-level OBD session: init ELM → VIN → standard PIDs.
 */
export class ObdSession {
  constructor(private transport: ObdTransport) {}

  get kind(): TransportKind {
    return this.transport.kind;
  }

  get availabilityNote(): string {
    return this.transport.availabilityNote;
  }

  isAvailable(): Promise<boolean> {
    return this.transport.isAvailable();
  }

  scan(onDevice: (device: ObdDevice) => void): Promise<void> {
    return this.transport.scan(onDevice);
  }

  stopScan(): Promise<void> {
    return this.transport.stopScan();
  }

  async connect(device: ObdDevice): Promise<void> {
    await this.transport.connect(device);
    await this.initAdapter();
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  private async initAdapter(): Promise<void> {
    for (const cmd of ELM_INIT_COMMANDS) {
      try {
        await this.transport.sendCommand(cmd, cmd === 'ATZ' ? 5000 : 3000);
      } catch {
        // Some clones ignore individual AT commands; continue
      }
    }
  }

  async readVin(): Promise<VinResult> {
    const raw = await this.transport.sendCommand(VIN_COMMAND, 10000);
    return parseVin(raw);
  }

  async readStandardPids(): Promise<{
    parsed: ParsedPidValue[];
    raw: RawPidResponse[];
    rpm: number | null;
    speedKmh: number | null;
    coolantTempC: number | null;
  }> {
    const raw: RawPidResponse[] = [];
    const parsed: ParsedPidValue[] = [];

    const rpmCmd = pidRequest(STANDARD_PIDS.rpm.mode, STANDARD_PIDS.rpm.pid);
    const speedCmd = pidRequest(STANDARD_PIDS.speed.mode, STANDARD_PIDS.speed.pid);
    const coolCmd = pidRequest(STANDARD_PIDS.coolant.mode, STANDARD_PIDS.coolant.pid);

    const rpmRaw = await this.transport.sendCommand(rpmCmd);
    raw.push({ pid: rpmCmd, command: rpmCmd, raw: rpmRaw, at: new Date().toISOString() });
    const rpmParsed = parseRpm(rpmRaw);
    parsed.push(rpmParsed);

    const speedRaw = await this.transport.sendCommand(speedCmd);
    raw.push({ pid: speedCmd, command: speedCmd, raw: speedRaw, at: new Date().toISOString() });
    const speedParsed = parseSpeed(speedRaw);
    parsed.push(speedParsed);

    const coolRaw = await this.transport.sendCommand(coolCmd);
    raw.push({ pid: coolCmd, command: coolCmd, raw: coolRaw, at: new Date().toISOString() });
    const coolParsed = parseCoolant(coolRaw);
    parsed.push(coolParsed);

    return {
      parsed,
      raw,
      rpm: typeof rpmParsed.value === 'number' ? rpmParsed.value : null,
      speedKmh: typeof speedParsed.value === 'number' ? speedParsed.value : null,
      coolantTempC: typeof coolParsed.value === 'number' ? coolParsed.value : null,
    };
  }

  async takeSnapshot(device: ObdDevice): Promise<ObdReadingSnapshot> {
    const vin = await this.readVin();
    const pids = await this.readStandardPids();
    return {
      recordedAt: new Date().toISOString(),
      vin: vin.vin,
      rpm: pids.rpm,
      speedKmh: pids.speedKmh,
      coolantTempC: pids.coolantTempC,
      rawPids: pids.raw,
      device: { id: device.id, name: device.name, transport: device.transport },
    };
  }
}
