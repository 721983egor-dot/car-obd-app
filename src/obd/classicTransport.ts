import type { ObdDevice, ObdTransport } from './types';

type RnBtDevice = { id?: string; address: string; name?: string; bonded?: boolean };

type RnBluetoothClassic = {
  isBluetoothEnabled: () => Promise<boolean>;
  requestBluetoothEnabled?: () => Promise<boolean>;
  getBondedDevices?: () => Promise<RnBtDevice[]>;
  startDiscovery: () => Promise<RnBtDevice[]>;
  cancelDiscovery: () => Promise<boolean>;
  connectToDevice: (address: string) => Promise<{ address: string; name?: string }>;
  disconnectFromDevice?: (address: string) => Promise<boolean>;
  onDeviceRead: (
    address: string,
  ) => { remove: () => void } & {
    // event emitter style varies by version — we also poll readFromDevice
  };
  writeToDevice: (address: string, data: string, encoding?: string) => Promise<boolean>;
  readFromDevice: (address: string) => Promise<string>;
  available?: (address: string) => Promise<number>;
};

/**
 * Bluetooth Classic / SPP — основной путь для дешёвых ELM327.
 * Нужен development build (не Expo Go): react-native-bluetooth-classic.
 */
export class ClassicObdTransport implements ObdTransport {
  readonly kind = 'classic' as const;
  readonly availabilityNote =
    'Bluetooth Classic (SPP): большинство дешёвых ELM327. Только Dev Client / prebuild, не Expo Go. На Android 12+ нужны BLUETOOTH_SCAN/CONNECT.';

  private module: RnBluetoothClassic | null = null;
  private address: string | null = null;
  private buffer = '';

  private loadModule(): RnBluetoothClassic | null {
    if (this.module) return this.module;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-bluetooth-classic');
      this.module = (mod.default ?? mod) as RnBluetoothClassic;
      return this.module;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    const bt = this.loadModule();
    if (!bt) return false;
    try {
      return await bt.isBluetoothEnabled();
    } catch {
      return false;
    }
  }

  async scan(onDevice: (device: ObdDevice) => void): Promise<void> {
    const bt = this.loadModule();
    if (!bt) {
      throw new Error(
        'Модуль Classic BT недоступен. Expo Go не умеет настоящий Bluetooth. Соберите Dev Client: npx expo prebuild && npx expo run:android',
      );
    }
    try {
      if (bt.requestBluetoothEnabled) {
        await bt.requestBluetoothEnabled();
      }

      const emit = (d: RnBtDevice, bonded: boolean) => {
        const name = d.name ?? d.address;
        const looksObd = /obd|elm|obdii|obd-ii|vgate|icar/i.test(name);
        onDevice({
          id: d.id ?? d.address,
          name: looksObd ? name : `${name} (BT)`,
          address: d.address,
          transport: 'classic',
          meta: { bonded },
        });
      };

      // Paired adapters first — typical ELM327 flow after phone Settings pairing
      if (bt.getBondedDevices) {
        try {
          const bonded = await bt.getBondedDevices();
          for (const d of bonded) emit(d, true);
        } catch {
          /* discovery below still helps */
        }
      }

      const devices = await bt.startDiscovery();
      for (const d of devices) {
        emit(d, Boolean(d.bonded));
      }
    } catch (e) {
      throw new Error(
        `Сканирование Classic не удалось: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async stopScan(): Promise<void> {
    const bt = this.loadModule();
    if (!bt) return;
    try {
      await bt.cancelDiscovery();
    } catch {
      /* ignore */
    }
  }

  async connect(device: ObdDevice): Promise<void> {
    const bt = this.loadModule();
    if (!bt) throw new Error('Модуль Classic BT недоступен');
    const address = device.address ?? device.id;
    await this.stopScan();
    await bt.connectToDevice(address);
    this.address = address;
    this.buffer = '';
  }

  async disconnect(): Promise<void> {
    const bt = this.loadModule();
    const address = this.address;
    this.address = null;
    this.buffer = '';
    if (!bt || !address) return;
    try {
      if (bt.disconnectFromDevice) {
        await bt.disconnectFromDevice(address);
      }
    } catch {
      /* ignore */
    }
  }

  async sendCommand(command: string, timeoutMs = 8000): Promise<string> {
    const bt = this.loadModule();
    if (!bt || !this.address) {
      throw new Error('Нет Classic-соединения');
    }
    const line = command.trim().endsWith('\r') ? command.trim() : `${command.trim()}\r`;
    this.buffer = '';
    await bt.writeToDevice(this.address, line, 'ascii');

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const chunk = await bt.readFromDevice(this.address);
        if (chunk) {
          this.buffer += chunk;
          if (this.buffer.includes('>')) {
            return this.buffer;
          }
        }
      } catch {
        /* empty read */
      }
      await sleep(80);
    }
    if (this.buffer) return this.buffer;
    throw new Error(`Таймаут ответа на ${command}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
