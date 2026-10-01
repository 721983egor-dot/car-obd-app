/**
 * Pure protocol checks (no native modules).
 * Run: npm run test:protocol
 */
import {
  parseCoolant,
  parseRpm,
  parseSpeed,
  parseVin,
  parseDtcs,
  parseSupportedPidBitmask,
  parseCatalogPid,
  parseBatteryVoltage,
  decodeDtcBytes,
  cleanElmResponse,
} from '../src/obd/protocol';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(cleanElmResponse('41 0C 0D 48\r\n>') === '410C0D48', 'clean spaces');
assert(parseRpm('410C0D48\r\n>').value === 850, 'rpm ~850');
assert(parseSpeed('410D2D\r\n>').value === 45, 'speed 45');
assert(parseCoolant('41055A\r\n>').value === 50, 'coolant 50C');

const vin = parseVin(
  '014\r\n0: 49 02 01 57 56 57 5A\r\n1: 5A 5A 31 4A 5A 58 57\r\n2: 30 30 30 30 30 31\r\n>',
);
assert(vin.vin === 'WVWZZZ1JZXW000001', `vin got ${vin.vin}`);

assert(parseRpm('NO DATA\r\n>').value === null, 'nodata rpm');

// DTC Mode 03
assert(decodeDtcBytes(0x03, 0x01) === 'P0301', 'decode P0301');
assert(decodeDtcBytes(0x04, 0x20) === 'P0420', 'decode P0420');
const dtc = parseDtcs('4303010420\r\n>');
assert(dtc.codes.length === 2, `dtc count ${dtc.codes.length}`);
assert(dtc.codes[0]!.code === 'P0301', 'first dtc');
assert(dtc.codes[0]!.descriptionRu?.includes('Пропуски'), 'ru hint P0301');
assert(dtc.codes[1]!.code === 'P0420', 'second dtc');

const emptyDtc = parseDtcs('NO DATA\r\n>');
assert(emptyDtc.codes.length === 0, 'empty dtc');

// Support bitmask 0100 BE1FB813 → includes 0C
const supported = parseSupportedPidBitmask('4100BE1FB813\r\n>', '00');
assert(supported.includes('0C'), 'support includes 0C');
assert(supported.includes('0D'), 'support includes 0D');
assert(supported.includes('05'), 'support includes 05');

// Catalog parsers
assert(parseCatalogPid('11', '411119\r\n>').value !== null, 'throttle');
assert(parseCatalogPid('0F', '410F3C\r\n>').value === 20, 'iat 20C');
assert(parseCatalogPid('10', '41100190\r\n>').value === 4, 'maf 4');
assert(parseCatalogPid('2F', '412F99\r\n>').value !== null, 'fuel level');

const bat = parseBatteryVoltage('12.6V\r\n>');
assert(bat.value === 12.6, `battery ${bat.value}`);

console.log('protocol tests: ok');
