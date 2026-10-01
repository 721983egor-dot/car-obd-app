/**
 * ELM327 / OBD-II Mode 01 helpers.
 * Cheap adapters speak AT commands over SPP (Classic) or GATT (BLE).
 */

import type { ParsedPidValue, VinResult } from './types';

export const STANDARD_PIDS = {
  rpm: { mode: '01', pid: '0C', label: 'Обороты', unit: 'об/мин' },
  speed: { mode: '01', pid: '0D', label: 'Скорость', unit: 'км/ч' },
  coolant: { mode: '01', pid: '05', label: 'Темп. ОЖ', unit: '°C' },
} as const;

export type StandardPidKey = keyof typeof STANDARD_PIDS;

/** Build Mode 01 request, e.g. 010C */
export function pidRequest(mode: string, pid: string): string {
  return `${mode}${pid}`.toUpperCase();
}

/** Strip spaces, prompts, and echo noise from ELM responses. */
export function cleanElmResponse(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/>/g, '')
    .replace(/SEARCHING\.\.\./gi, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Parse Mode 01 response bytes.
 * Response format: 41 <PID> <data...>
 */
export function parseMode01(raw: string, expectedPid: string): number[] | null {
  const cleaned = cleanElmResponse(raw);
  if (!cleaned || cleaned.includes('NODATA') || cleaned.includes('ERROR') || cleaned.includes('UNABLE')) {
    return null;
  }

  const pid = expectedPid.toUpperCase();
  // Find 41 + PID (may be after echoed request)
  const marker = `41${pid}`;
  const idx = cleaned.lastIndexOf(marker);
  if (idx === -1) {
    // Some adapters return only data after echo of 01xx
    const alt = cleaned.match(new RegExp(`41${pid}([0-9A-F]+)`));
    if (!alt) return null;
    return hexToBytes(alt[1]);
  }
  const dataHex = cleaned.slice(idx + marker.length);
  return hexToBytes(dataHex);
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  const even = hex.length % 2 === 0 ? hex : hex.slice(0, -1);
  for (let i = 0; i + 1 < even.length; i += 2) {
    bytes.push(parseInt(even.slice(i, i + 2), 16));
  }
  return bytes;
}

export function parseRpm(raw: string): ParsedPidValue {
  const bytes = parseMode01(raw, '0C');
  let value: number | null = null;
  if (bytes && bytes.length >= 2) {
    value = Math.round(((bytes[0]! * 256) + bytes[1]!) / 4);
  }
  return {
    pid: '010C',
    label: STANDARD_PIDS.rpm.label,
    unit: STANDARD_PIDS.rpm.unit,
    value,
    raw,
  };
}

export function parseSpeed(raw: string): ParsedPidValue {
  const bytes = parseMode01(raw, '0D');
  const value = bytes && bytes.length >= 1 ? bytes[0]! : null;
  return {
    pid: '010D',
    label: STANDARD_PIDS.speed.label,
    unit: STANDARD_PIDS.speed.unit,
    value,
    raw,
  };
}

export function parseCoolant(raw: string): ParsedPidValue {
  const bytes = parseMode01(raw, '05');
  const value = bytes && bytes.length >= 1 ? bytes[0]! - 40 : null;
  return {
    pid: '0105',
    label: STANDARD_PIDS.coolant.label,
    unit: STANDARD_PIDS.coolant.unit,
    value,
    raw,
  };
}

/**
 * VIN via Mode 09 PID 02. Multi-frame ISO-TP / ELM lines vary by adapter;
 * best-effort ASCII extract after stripping frame indices (`0:`, `1:`, …).
 */
export function parseVin(raw: string): VinResult {
  const normalized = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+:\s*/, '')) // ISO-TP frame index from ELM
    .join('');

  const cleaned = cleanElmResponse(normalized);
  if (!cleaned || cleaned.includes('NODATA') || cleaned.includes('ERROR')) {
    return {
      vin: null,
      raw,
      note: 'ЭБУ не отдал VIN по OBD (часто на старых авто) или адаптер не собрал multi-frame.',
    };
  }

  let hex = cleaned.replace(/[^0-9A-F]/g, '');
  const idx = hex.indexOf('4902');
  if (idx !== -1) {
    hex = hex.slice(idx + 4);
  }

  const bytes = hexToBytes(hex);
  // First byte after 49 02 is often a message-count; skip non-printable
  const ascii = bytes
    .filter((b) => b >= 32 && b <= 126)
    .map((b) => String.fromCharCode(b))
    .join('')
    .replace(/[^A-HJ-NPR-Z0-9]/gi, '');

  const match = ascii.match(/[A-HJ-NPR-Z0-9]{17}/i);
  if (match) {
    return { vin: match[0]!.toUpperCase(), raw };
  }

  if (ascii.length >= 11) {
    return {
      vin: ascii.slice(0, 17).toUpperCase(),
      raw,
      note: 'VIN извлечён частично — проверьте на ЭБУ / другим софтом.',
    };
  }

  return {
    vin: null,
    raw,
    note: 'Не удалось разобрать VIN из ответа. Это нормально: не все ЭБУ отдают Mode 09.',
  };
}

/** Minimal AT init sequence for ELM327-compatible dongles. */
export const ELM_INIT_COMMANDS = [
  'ATZ', // reset
  'ATE0', // echo off
  'ATL0', // linefeeds off
  'ATS0', // spaces off
  'ATH0', // headers off (simpler Mode 01)
  'ATSP0', // automatic protocol
] as const;

export const VIN_COMMAND = '0902';
