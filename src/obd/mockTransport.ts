import type { ObdDevice, ObdTransport } from './types';

/**
 * In-memory mock ELM327 for UI flow without hardware / native modules.
 * Works in Expo Go. Returns a rich demo: support bitmasks, DTCs, many Mode 01 PIDs, ATRV.
 */
export class MockObdTransport implements ObdTransport {
  readonly kind = 'mock' as const;
  readonly availabilityNote =
    'Симулятор: без адаптера. Для проверки экранов в Expo Go. Для живого ELM327 нужен Dev Client (Bluetooth Classic).';

  private connected = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async scan(onDevice: (device: ObdDevice) => void): Promise<void> {
    await this.stopScan();
    this.scanTimer = setTimeout(() => {
      onDevice({
        id: 'mock-elm327-1',
        name: 'ELM327 Mock',
        address: '00:11:22:33:44:55',
        transport: 'mock',
        meta: { simulated: true },
      });
      onDevice({
        id: 'mock-elm327-2',
        name: 'OBDII Sim BLE',
        address: 'AA:BB:CC:DD:EE:FF',
        transport: 'mock',
        meta: { simulated: true, style: 'ble' },
      });
    }, 400);
  }

  async stopScan(): Promise<void> {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async connect(_device: ObdDevice): Promise<void> {
    await delay(300);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async sendCommand(command: string, _timeoutMs = 5000): Promise<string> {
    if (!this.connected) {
      throw new Error('Нет соединения (mock)');
    }
    await delay(80);
    const cmd = command.trim().toUpperCase().replace(/\s+/g, '');

    if (cmd === 'ATZ') return 'ELM327 v1.5\r\n>';
    if (cmd === 'ATRV') return '12.6V\r\n>';
    if (cmd.startsWith('AT')) return 'OK\r\n>';

    if (cmd === '0902') {
      return (
        '014\r\n0: 49 02 01 57 56 57 5A\r\n' +
        '1: 5A 5A 31 4A 5A 58 57\r\n' +
        '2: 30 30 30 30 30 31\r\n>'
      );
    }

    // Mode 03 — demo DTCs: P0301 + P0420
    if (cmd === '03') {
      // 43 04 03 01 04 20 → count=4 bytes? Better: 43 03 01 04 20
      // P0301 = 03 01, P0420 = 04 20
      return '4303010420\r\n>';
    }

    // Support bitmasks — advertise a rich set of common PIDs
    if (cmd === '0100') {
      // 04,05,06,07,0A–11,14,15,1F + next-range bit 20
      return '4100BE1FB813\r\n>';
    }
    if (cmd === '0120') {
      // 21, 2F, 30, 31, 33 + next-range bit 40
      return '41208003A001\r\n>';
    }
    if (cmd === '0140') {
      // 42,43,45–47,49,4A,5C,5E + next-range bit 60
      return '41406EC00015\r\n>';
    }
    if (cmd === '0160') {
      return '416000000000\r\n>';
    }

    // Mode 01 live values (demo)
    const mode01: Record<string, string> = {
      '0104': '41043C', // load ~23.5%
      '0105': '41055A', // coolant 50°C
      '0106': '410680', // STFT 0%
      '0107': '41077A', // LTFT ~-4.7%
      '010A': '410A2D', // fuel pressure 135 kPa
      '010B': '410B64', // MAP 100 kPa
      '010C': '410C0D48', // RPM ~850
      '010D': '410D00', // speed 0
      '010E': '410E7C', // timing ~-2°
      '010F': '410F3C', // IAT 20°C
      '0110': '41100190', // MAF 4.00 g/s
      '0111': '411119', // throttle ~10%
      '0114': '411480', // O2 ~0.64 V
      '0115': '411570', // O2 ~0.56 V
      '011F': '411F0258', // runtime 600 s
      '0121': '41210000', // distance MIL 0
      '012F': '412F99', // fuel level ~60%
      '0130': '413005', // warm-ups 5
      '0131': '41311234', // distance since clear
      '0133': '413364', // baro 100 kPa
      '0142': '414230D4', // module voltage ~12.5 V
      '0143': '41430080', // abs load
      '0145': '41451A', // rel throttle
      '0146': '41463A', // ambient 18°C
      '0147': '414720', // throttle B
      '0149': '414915', // accel D
      '014A': '414A10', // accel E
      '015C': '415C5A', // oil 50°C
      '015E': '415E0014', // fuel rate 1.0 L/h
    };

    if (mode01[cmd]) {
      return `${mode01[cmd]}\r\n>`;
    }

    // Unsupported PID — graceful NO DATA
    if (cmd.startsWith('01')) {
      return 'NO DATA\r\n>';
    }

    return 'NO DATA\r\n>';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
