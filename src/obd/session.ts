import {
  BATTERY_COMMAND,
  DTC_COMMAND,
  ELM_INIT_COMMANDS,
  MODE01_PID_CATALOG,
  SUPPORT_PID_COMMANDS,
  VIN_COMMAND,
  parseBatteryVoltage,
  parseCatalogPid,
  parseCoolant,
  parseDtcs,
  parseRpm,
  parseSpeed,
  parseSupportedPidBitmask,
  parseVin,
  pidRequest,
  STANDARD_PIDS,
} from './protocol';
import type {
  DtcResult,
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
 * High-level OBD session: init ELM → support PIDs → VIN → DTC → Mode 01 → ATRV.
 * Every command is try/catch — unsupported / failing PIDs are skipped, never crash the session.
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

  /** Safe send: returns null on timeout / adapter throw — never crashes the session. */
  private async safeSend(
    command: string,
    timeoutMs = 8000,
  ): Promise<{ raw: string } | null> {
    try {
      const raw = await this.transport.sendCommand(command, timeoutMs);
      return { raw };
    } catch {
      return null;
    }
  }

  async readVin(): Promise<VinResult> {
    const res = await this.safeSend(VIN_COMMAND, 10000);
    if (!res) {
      return {
        vin: null,
        raw: '',
        note: 'Таймаут / ошибка при чтении VIN.',
      };
    }
    return parseVin(res.raw);
  }

  async readDtcs(): Promise<DtcResult> {
    const res = await this.safeSend(DTC_COMMAND, 10000);
    if (!res) {
      return {
        codes: [],
        raw: '',
        note: 'Не удалось запросить DTC (таймаут или адаптер не ответил).',
      };
    }
    return parseDtcs(res.raw);
  }

  /**
   * Query 0100 / 0120 / 0140 / 0160 and return supported PID hex list
   * (e.g. ["04","05","0C",...]). Always includes core PIDs we care about as fallback.
   */
  async discoverSupportedPids(): Promise<{
    supported: string[];
    raw: RawPidResponse[];
  }> {
    const raw: RawPidResponse[] = [];
    const supported = new Set<string>();

    for (const cmd of SUPPORT_PID_COMMANDS) {
      const pid = cmd.slice(2);
      const res = await this.safeSend(cmd, 6000);
      if (!res) continue;
      raw.push({
        pid: cmd,
        command: cmd,
        raw: res.raw,
        at: new Date().toISOString(),
      });
      for (const p of parseSupportedPidBitmask(res.raw, pid)) {
        supported.add(p);
      }
    }

    // Fallback: if bitmask completely failed, still try common catalog PIDs
    if (supported.size === 0) {
      for (const p of Object.keys(MODE01_PID_CATALOG)) {
        supported.add(p);
      }
    }

    return { supported: [...supported].sort(), raw };
  }

  /**
   * Read all supported Mode 01 PIDs we can parse + ATRV battery.
   */
  async readAllParameters(supportedPids?: string[]): Promise<{
    parsed: ParsedPidValue[];
    raw: RawPidResponse[];
    rpm: number | null;
    speedKmh: number | null;
    coolantTempC: number | null;
    batteryVoltage: number | null;
    supportedPids: string[];
  }> {
    const raw: RawPidResponse[] = [];
    const parsed: ParsedPidValue[] = [];

    let supported = supportedPids;
    if (!supported) {
      const disc = await this.discoverSupportedPids();
      supported = disc.supported;
      raw.push(...disc.raw);
    }

    // Only request PIDs we know how to parse, and that ECU claims to support
    // (or fallback list when discovery empty — already handled above).
    const toRead = Object.keys(MODE01_PID_CATALOG).filter((p) => supported!.includes(p));

    // Ensure core trio always attempted even if bitmask odd
    for (const core of ['0C', '0D', '05']) {
      if (!toRead.includes(core)) toRead.unshift(core);
    }

    // Dedupe while preserving order
    const unique = [...new Set(toRead)];

    for (const pidHex of unique) {
      const cmd = pidRequest('01', pidHex);
      const res = await this.safeSend(cmd, 5000);
      if (!res) {
        parsed.push({
          pid: cmd,
          label: MODE01_PID_CATALOG[pidHex]?.label ?? `PID ${pidHex}`,
          unit: MODE01_PID_CATALOG[pidHex]?.unit ?? '',
          value: null,
          raw: '(нет ответа)',
        });
        continue;
      }
      raw.push({
        pid: cmd,
        command: cmd,
        raw: res.raw,
        at: new Date().toISOString(),
      });
      const value = parseCatalogPid(pidHex, res.raw);
      // Skip parameters that are clearly unsupported (null + NO DATA)
      if (value.value === null && /NO\s*DATA|ERROR|UNABLE/i.test(res.raw)) {
        continue;
      }
      parsed.push(value);
    }

    // Battery via ELM ATRV (not a Mode 01 PID)
    let batteryVoltage: number | null = null;
    const bat = await this.safeSend(BATTERY_COMMAND, 4000);
    if (bat) {
      raw.push({
        pid: BATTERY_COMMAND,
        command: BATTERY_COMMAND,
        raw: bat.raw,
        at: new Date().toISOString(),
      });
      const batParsed = parseBatteryVoltage(bat.raw);
      if (batParsed.value !== null) {
        parsed.push(batParsed);
        batteryVoltage = typeof batParsed.value === 'number' ? batParsed.value : null;
      }
    }

    const rpmEntry = parsed.find((p) => p.pid === '010C');
    const speedEntry = parsed.find((p) => p.pid === '010D');
    const coolEntry = parsed.find((p) => p.pid === '0105');

    return {
      parsed,
      raw,
      rpm: typeof rpmEntry?.value === 'number' ? rpmEntry.value : null,
      speedKmh: typeof speedEntry?.value === 'number' ? speedEntry.value : null,
      coolantTempC: typeof coolEntry?.value === 'number' ? coolEntry.value : null,
      batteryVoltage,
      supportedPids: supported,
    };
  }

  /** @deprecated Prefer readAllParameters — kept for callers / tests. */
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

    const rpmRes = await this.safeSend(rpmCmd);
    if (rpmRes) {
      raw.push({ pid: rpmCmd, command: rpmCmd, raw: rpmRes.raw, at: new Date().toISOString() });
      parsed.push(parseRpm(rpmRes.raw));
    }

    const speedRes = await this.safeSend(speedCmd);
    if (speedRes) {
      raw.push({ pid: speedCmd, command: speedCmd, raw: speedRes.raw, at: new Date().toISOString() });
      parsed.push(parseSpeed(speedRes.raw));
    }

    const coolRes = await this.safeSend(coolCmd);
    if (coolRes) {
      raw.push({ pid: coolCmd, command: coolCmd, raw: coolRes.raw, at: new Date().toISOString() });
      parsed.push(parseCoolant(coolRes.raw));
    }

    return {
      parsed,
      raw,
      rpm: typeof parsed.find((p) => p.pid === '010C')?.value === 'number'
        ? (parsed.find((p) => p.pid === '010C')!.value as number)
        : null,
      speedKmh: typeof parsed.find((p) => p.pid === '010D')?.value === 'number'
        ? (parsed.find((p) => p.pid === '010D')!.value as number)
        : null,
      coolantTempC: typeof parsed.find((p) => p.pid === '0105')?.value === 'number'
        ? (parsed.find((p) => p.pid === '0105')!.value as number)
        : null,
    };
  }

  /**
   * Full read: VIN → DTC → supported PIDs → all parseable parameters.
   */
  async takeSnapshot(device: ObdDevice): Promise<ObdReadingSnapshot> {
    const vin = await this.readVin();
    const dtc = await this.readDtcs();
    const params = await this.readAllParameters();
    return {
      recordedAt: new Date().toISOString(),
      vin: vin.vin,
      rpm: params.rpm,
      speedKmh: params.speedKmh,
      coolantTempC: params.coolantTempC,
      batteryVoltage: params.batteryVoltage,
      dtcs: dtc.codes,
      parameters: params.parsed,
      supportedPids: params.supportedPids,
      rawPids: params.raw,
      device: { id: device.id, name: device.name, transport: device.transport },
    };
  }
}
