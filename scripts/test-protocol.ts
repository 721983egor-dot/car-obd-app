/**
 * Pure protocol checks (no native modules).
 * Run: npm run test:protocol
 */
import {
  parseCoolant,
  parseRpm,
  parseSpeed,
  parseVin,
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

console.log('protocol tests: ok');
