/**
 * ELM327 / OBD-II helpers: Mode 01 PIDs, Mode 03 DTC, ATRV.
 * Cheap adapters speak AT commands over SPP (Classic) or GATT (BLE).
 */

import type { DtcCode, DtcResult, ParsedPidValue, VinResult } from './types';

export const STANDARD_PIDS = {
  rpm: { mode: '01', pid: '0C', label: 'Обороты', unit: 'об/мин' },
  speed: { mode: '01', pid: '0D', label: 'Скорость', unit: 'км/ч' },
  coolant: { mode: '01', pid: '05', label: 'Темп. ОЖ', unit: '°C' },
} as const;

export type StandardPidKey = keyof typeof STANDARD_PIDS;

/** PID ranges that report which Mode 01 PIDs are supported. */
export const SUPPORT_PID_COMMANDS = ['0100', '0120', '0140', '0160'] as const;

type PidParser = (bytes: number[]) => number | string | null;

interface PidDef {
  pid: string; // e.g. "0C"
  label: string;
  unit: string;
  /** How many data bytes we need at minimum. */
  minBytes: number;
  parse: PidParser;
}

function tempC(a: number): number {
  return a - 40;
}

function percent(a: number): number {
  return Math.round((a * 1000) / 255) / 10;
}

function fuelTrim(a: number): number {
  return Math.round(((a - 128) * 1000) / 128) / 10;
}

function timingAdvance(a: number): number {
  return a / 2 - 64;
}

function maf(a: number, b: number): number {
  return Math.round(((a * 256 + b) / 100) * 100) / 100;
}

function o2Voltage(a: number): number {
  return Math.round((a / 200) * 1000) / 1000;
}

/**
 * Catalog of Mode 01 PIDs we know how to parse.
 * Only these are requested after support-bitmask discovery.
 */
export const MODE01_PID_CATALOG: Record<string, PidDef> = {
  '04': {
    pid: '04',
    label: 'Нагрузка двигателя',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '05': {
    pid: '05',
    label: 'Темп. ОЖ',
    unit: '°C',
    minBytes: 1,
    parse: (b) => tempC(b[0]!),
  },
  '06': {
    pid: '06',
    label: 'Кратковр. коррекция топлива (банк 1)',
    unit: '%',
    minBytes: 1,
    parse: (b) => fuelTrim(b[0]!),
  },
  '07': {
    pid: '07',
    label: 'Долговрем. коррекция топлива (банк 1)',
    unit: '%',
    minBytes: 1,
    parse: (b) => fuelTrim(b[0]!),
  },
  '0A': {
    pid: '0A',
    label: 'Давление топлива',
    unit: 'кПа',
    minBytes: 1,
    parse: (b) => b[0]! * 3,
  },
  '0B': {
    pid: '0B',
    label: 'Давление во впускном коллекторе',
    unit: 'кПа',
    minBytes: 1,
    parse: (b) => b[0]!,
  },
  '0C': {
    pid: '0C',
    label: 'Обороты',
    unit: 'об/мин',
    minBytes: 2,
    parse: (b) => Math.round((b[0]! * 256 + b[1]!) / 4),
  },
  '0D': {
    pid: '0D',
    label: 'Скорость',
    unit: 'км/ч',
    minBytes: 1,
    parse: (b) => b[0]!,
  },
  '0E': {
    pid: '0E',
    label: 'Угол опережения зажигания',
    unit: '°',
    minBytes: 1,
    parse: (b) => timingAdvance(b[0]!),
  },
  '0F': {
    pid: '0F',
    label: 'Темп. воздуха на впуске (IAT)',
    unit: '°C',
    minBytes: 1,
    parse: (b) => tempC(b[0]!),
  },
  '10': {
    pid: '10',
    label: 'Массовый расход воздуха (MAF)',
    unit: 'г/с',
    minBytes: 2,
    parse: (b) => maf(b[0]!, b[1]!),
  },
  '11': {
    pid: '11',
    label: 'Положение дросселя',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '14': {
    pid: '14',
    label: 'Датчик O₂ B1S1',
    unit: 'В',
    minBytes: 1,
    parse: (b) => o2Voltage(b[0]!),
  },
  '15': {
    pid: '15',
    label: 'Датчик O₂ B1S2',
    unit: 'В',
    minBytes: 1,
    parse: (b) => o2Voltage(b[0]!),
  },
  '1F': {
    pid: '1F',
    label: 'Время работы двигателя',
    unit: 'с',
    minBytes: 2,
    parse: (b) => b[0]! * 256 + b[1]!,
  },
  '21': {
    pid: '21',
    label: 'Пробег с включённой лампой MIL',
    unit: 'км',
    minBytes: 2,
    parse: (b) => b[0]! * 256 + b[1]!,
  },
  '2F': {
    pid: '2F',
    label: 'Уровень топлива',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '30': {
    pid: '30',
    label: 'Прогревы с очистки кодов',
    unit: '',
    minBytes: 1,
    parse: (b) => b[0]!,
  },
  '31': {
    pid: '31',
    label: 'Пробег с очистки кодов',
    unit: 'км',
    minBytes: 2,
    parse: (b) => b[0]! * 256 + b[1]!,
  },
  '33': {
    pid: '33',
    label: 'Атмосферное давление',
    unit: 'кПа',
    minBytes: 1,
    parse: (b) => b[0]!,
  },
  '42': {
    pid: '42',
    label: 'Напряжение модуля управления',
    unit: 'В',
    minBytes: 2,
    parse: (b) => Math.round(((b[0]! * 256 + b[1]!) / 1000) * 100) / 100,
  },
  '43': {
    pid: '43',
    label: 'Абсолютная нагрузка',
    unit: '%',
    minBytes: 2,
    parse: (b) => Math.round(((b[0]! * 256 + b[1]!) * 1000) / 255) / 10,
  },
  '45': {
    pid: '45',
    label: 'Относит. положение дросселя',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '46': {
    pid: '46',
    label: 'Температура воздуха снаружи',
    unit: '°C',
    minBytes: 1,
    parse: (b) => tempC(b[0]!),
  },
  '47': {
    pid: '47',
    label: 'Абсолютное положение дросселя B',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '49': {
    pid: '49',
    label: 'Положение педали акселератора D',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '4A': {
    pid: '4A',
    label: 'Положение педали акселератора E',
    unit: '%',
    minBytes: 1,
    parse: (b) => percent(b[0]!),
  },
  '5C': {
    pid: '5C',
    label: 'Температура масла',
    unit: '°C',
    minBytes: 1,
    parse: (b) => tempC(b[0]!),
  },
  '5E': {
    pid: '5E',
    label: 'Расход топлива',
    unit: 'л/ч',
    minBytes: 2,
    parse: (b) => Math.round(((b[0]! * 256 + b[1]!) / 20) * 100) / 100,
  },
};

/** Short RU hints for common DTCs; unknown codes stay without description. */
export const DTC_RU_HINTS: Record<string, string> = {
  P0000: 'Нет кода / заглушка',
  P0100: 'Датчик массового расхода воздуха (MAF) — цепь',
  P0101: 'MAF — диапазон/производительность',
  P0102: 'MAF — низкий сигнал',
  P0171: 'Слишком бедная смесь (банк 1)',
  P0172: 'Слишком богатая смесь (банк 1)',
  P0174: 'Слишком бедная смесь (банк 2)',
  P0175: 'Слишком богатая смесь (банк 2)',
  P0300: 'Множественные пропуски зажигания',
  P0301: 'Пропуски зажигания, цилиндр 1',
  P0302: 'Пропуски зажигания, цилиндр 2',
  P0303: 'Пропуски зажигания, цилиндр 3',
  P0304: 'Пропуски зажигания, цилиндр 4',
  P0305: 'Пропуски зажигания, цилиндр 5',
  P0306: 'Пропуски зажигания, цилиндр 6',
  P0420: 'Эффективность катализатора ниже порога (банк 1)',
  P0430: 'Эффективность катализатора ниже порога (банк 2)',
  P0440: 'Система улавливания паров топлива (EVAP)',
  P0442: 'Небольшая утечка EVAP',
  P0455: 'Большая утечка EVAP',
  P0500: 'Датчик скорости автомобиля',
  P0505: 'Система холостого хода',
  P0506: 'Обороты ХХ ниже нормы',
  P0507: 'Обороты ХХ выше нормы',
  P0562: 'Низкое напряжение бортсети',
  P0563: 'Высокое напряжение бортсети',
  P0700: 'Неисправность системы управления АКПП',
  C0035: 'Датчик ABS колеса (левое переднее)',
  B0001: 'Подушка безопасности / SRS (общий)',
  U0100: 'Потеря связи с ЭБУ двигателя',
  U0121: 'Потеря связи с модулем ABS',
};

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
  const marker = `41${pid}`;
  const idx = cleaned.lastIndexOf(marker);
  if (idx === -1) {
    const alt = cleaned.match(new RegExp(`41${pid}([0-9A-F]+)`));
    if (!alt) return null;
    return hexToBytes(alt[1]!);
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

/**
 * Parse support bitmask from 0100 / 0120 / 0140 / 0160.
 * Returns PID hex strings like "0C", "0D" that are marked supported.
 */
export function parseSupportedPidBitmask(raw: string, basePid: string): string[] {
  const bytes = parseMode01(raw, basePid);
  if (!bytes || bytes.length < 4) return [];

  const base = parseInt(basePid, 16);
  const supported: string[] = [];
  for (let i = 0; i < 32; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = 7 - (i % 8);
    if ((bytes[byteIndex]! & (1 << bitIndex)) !== 0) {
      const pidNum = base + 1 + i;
      supported.push(pidNum.toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return supported;
}

/** Parse any catalog Mode 01 PID into a ParsedPidValue. */
export function parseCatalogPid(pidHex: string, raw: string): ParsedPidValue {
  const def = MODE01_PID_CATALOG[pidHex.toUpperCase()];
  const command = pidRequest('01', pidHex);
  if (!def) {
    return {
      pid: command,
      label: `PID ${pidHex.toUpperCase()}`,
      unit: '',
      value: null,
      raw,
    };
  }
  const bytes = parseMode01(raw, def.pid);
  let value: number | string | null = null;
  if (bytes && bytes.length >= def.minBytes) {
    try {
      value = def.parse(bytes);
    } catch {
      value = null;
    }
  }
  return {
    pid: command,
    label: def.label,
    unit: def.unit,
    value,
    raw,
  };
}

export function parseRpm(raw: string): ParsedPidValue {
  return parseCatalogPid('0C', raw);
}

export function parseSpeed(raw: string): ParsedPidValue {
  return parseCatalogPid('0D', raw);
}

export function parseCoolant(raw: string): ParsedPidValue {
  return parseCatalogPid('05', raw);
}

/**
 * Decode one DTC from two bytes (SAE J2012 encoding).
 */
export function decodeDtcBytes(a: number, b: number): string | null {
  if (a === 0 && b === 0) return null;
  const typeBits = (a >> 6) & 0x03;
  const typeChar = ['P', 'C', 'B', 'U'][typeBits]!;
  const d1 = (a >> 4) & 0x03;
  const d2 = a & 0x0f;
  const d3 = (b >> 4) & 0x0f;
  const d4 = b & 0x0f;
  return `${typeChar}${d1}${d2.toString(16).toUpperCase()}${d3.toString(16).toUpperCase()}${d4.toString(16).toUpperCase()}`;
}

/**
 * Mode 03 stored DTCs. Best-effort across adapters (with/without count byte).
 */
export function parseDtcs(raw: string): DtcResult {
  const cleaned = cleanElmResponse(raw);
  if (!cleaned || cleaned.includes('NODATA') || cleaned.includes('ERROR') || cleaned.includes('UNABLE')) {
    return {
      codes: [],
      raw,
      note: cleaned?.includes('NODATA')
        ? 'ЭБУ не отдал коды ошибок (NO DATA) — часто значит, что активных DTC нет.'
        : 'Не удалось прочитать DTC.',
    };
  }

  // Collect all hex after each "43" marker (multi-ECU / multi-frame)
  let hex = cleaned.replace(/[^0-9A-F]/g, '');
  const chunks: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = hex.indexOf('43', searchFrom);
    if (idx === -1) break;
    const dataHex = hex.slice(idx + 2);
    // Stop at next response mode if present (44, 41, etc.) — take until next 43 or end
    const next43 = dataHex.indexOf('43');
    const slice = next43 === -1 ? dataHex : dataHex.slice(0, next43);
    chunks.push(...hexToBytes(slice));
    searchFrom = idx + 2 + (next43 === -1 ? dataHex.length : next43);
  }

  if (chunks.length === 0) {
    return { codes: [], raw, note: 'В ответе нет маркера Mode 03 (43).' };
  }

  const codes: DtcCode[] = [];
  const seen = new Set<string>();

  // Some ECUs prepend a count byte; try both interpretations and keep valid codes.
  const candidates: number[][] = [chunks];
  if (chunks.length >= 1 && chunks[0]! <= 16 && chunks.length % 2 === 1) {
    candidates.push(chunks.slice(1));
  }

  for (const data of candidates) {
    for (let i = 0; i + 1 < data.length; i += 2) {
      const code = decodeDtcBytes(data[i]!, data[i + 1]!);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      codes.push({
        code,
        descriptionRu: DTC_RU_HINTS[code] ?? null,
      });
    }
  }

  if (codes.length === 0) {
    return {
      codes: [],
      raw,
      note: 'Активных кодов ошибок нет (или адаптер вернул пустой список).',
    };
  }

  return { codes, raw };
}

/** Parse ELM ATRV battery voltage, e.g. "12.6V". */
export function parseBatteryVoltage(raw: string): ParsedPidValue {
  const cleaned = raw.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/>/g, '').trim();
  const match = cleaned.match(/(\d+[.,]\d+)\s*V?/i);
  let value: number | null = null;
  if (match) {
    value = parseFloat(match[1]!.replace(',', '.'));
  }
  return {
    pid: 'ATRV',
    label: 'Напряжение бортсети (ELM)',
    unit: 'В',
    value: Number.isFinite(value) ? value : null,
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
    .map((line) => line.replace(/^\d+:\s*/, ''))
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
export const DTC_COMMAND = '03';
export const BATTERY_COMMAND = 'ATRV';
