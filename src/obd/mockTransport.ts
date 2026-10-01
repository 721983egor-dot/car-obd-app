import type { ObdDevice, ObdTransport } from './types';

/**
 * In-memory mock ELM327 for UI flow without hardware / native modules.
 * Works in Expo Go.
 */
export class MockObdTransport implements ObdTransport {
  readonly kind = 'mock' as const;
  readonly availabilityNote =
    'Симулятор: без адаптера. Для проверки экранов в Expo Go.';

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
    await delay(120);
    const cmd = command.trim().toUpperCase().replace(/\s+/g, '');

    if (cmd === 'ATZ') return 'ELM327 v1.5\r\n>';
    if (cmd.startsWith('AT')) return 'OK\r\n>';
    if (cmd === '0902') {
      // Simulated multi-line VIN for WVWZZZ1JZXW000001-style (fake)
      return (
        '014\r\n0: 49 02 01 57 56 57 5A\r\n' +
        '1: 5A 5A 31 4A 5A 58 57\r\n' +
        '2: 30 30 30 30 30 31\r\n>'
      );
    }
    if (cmd === '010C') {
      // RPM ~ 850 → (850*4)=3400 → 0x0D48
      return '410C0D48\r\n>';
    }
    if (cmd === '010D') {
      return '410D00\r\n>'; // 0 km/h
    }
    if (cmd === '0105') {
      return '41055A\r\n>'; // 90-40 = 50°C → wait 0x5A = 90 → 50°C
    }
    return 'NO DATA\r\n>';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
