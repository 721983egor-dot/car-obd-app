import { PermissionsAndroid, Platform } from 'react-native';
import type { ObdDevice, ObdTransport } from './types';

type BleManagerLike = {
  state: () => Promise<string>;
  startDeviceScan: (
    uuids: string[] | null,
    options: object | null,
    listener: (error: Error | null, device: BleDeviceLike | null) => void,
  ) => void;
  stopDeviceScan: () => void;
  connectToDevice: (id: string) => Promise<BleDeviceLike>;
  discoverAllServicesAndCharacteristicsForDevice: (id: string) => Promise<BleDeviceLike>;
  cancelDeviceConnection: (id: string) => Promise<void>;
  writeCharacteristicWithResponseForDevice: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ) => Promise<unknown>;
  monitorCharacteristicForDevice: (
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: Error | null, characteristic: { value?: string | null } | null) => void,
  ) => { remove: () => void };
  destroy?: () => void;
};

type BleDeviceLike = {
  id: string;
  name: string | null;
  localName?: string | null;
  rssi?: number | null;
  serviceUUIDs?: string[] | null;
};

/** Common ELM327 BLE UART service / RX / TX (FFF0 family and Nordic UART). */
const CANDIDATE_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

const CANDIDATE_WRITE = [
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
];

const CANDIDATE_NOTIFY = [
  '0000fff1-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
];

/**
 * BLE transport for adapters that expose a GATT serial bridge.
 * Многие «ELM327» с AliExpress — Classic SPP, не BLE. BLE-версии часто
 * имеют сервис FFF0/FFE0 или Nordic UART.
 */
export class BleObdTransport implements ObdTransport {
  readonly kind = 'ble' as const;
  readonly availabilityNote =
    'BLE: только адаптеры с GATT (не все ELM327). Нужен Dev Client + react-native-ble-plx. Expo Go не подходит.';

  private manager: BleManagerLike | null = null;
  private deviceId: string | null = null;
  private serviceUUID: string | null = null;
  private writeUUID: string | null = null;
  private notifyUUID: string | null = null;
  private subscription: { remove: () => void } | null = null;
  private buffer = '';
  private waiters: Array<{ resolve: (v: string) => void; reject: (e: Error) => void; started: number }> =
    [];

  private loadManager(): BleManagerLike | null {
    if (this.manager) return this.manager;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager() as BleManagerLike;
      return this.manager;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    const mgr = this.loadManager();
    if (!mgr) return false;
    try {
      await ensureBlePermissions();
      const state = await mgr.state();
      return state === 'PoweredOn';
    } catch {
      return false;
    }
  }

  async scan(onDevice: (device: ObdDevice) => void): Promise<void> {
    const mgr = this.loadManager();
    if (!mgr) {
      throw new Error(
        'Модуль BLE недоступен. Соберите Dev Client: npx expo prebuild && npx expo run:android',
      );
    }
    await ensureBlePermissions();
    await this.stopScan();

    const seen = new Set<string>();
    mgr.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error || !device) return;
      const name = device.name ?? device.localName ?? '';
      if (!name && !(device.rssi != null && device.rssi > -90)) return;
      if (seen.has(device.id)) return;
      seen.add(device.id);
      const looksObd = /obd|elm|obdii|vgate|icar|veepeak|ble/i.test(name);
      // Surface named devices; highlight likely OBD
      if (!name && !looksObd) return;
      onDevice({
        id: device.id,
        name: name || `BLE ${device.id.slice(0, 8)}`,
        address: device.id,
        transport: 'ble',
        meta: {
          rssi: device.rssi ?? 0,
          likelyObd: looksObd,
        },
      });
    });
  }

  async stopScan(): Promise<void> {
    const mgr = this.loadManager();
    if (!mgr) return;
    try {
      mgr.stopDeviceScan();
    } catch {
      /* ignore */
    }
  }

  async connect(device: ObdDevice): Promise<void> {
    const mgr = this.loadManager();
    if (!mgr) throw new Error('Модуль BLE недоступен');
    await this.stopScan();

    const connected = await mgr.connectToDevice(device.id);
    await mgr.discoverAllServicesAndCharacteristicsForDevice(connected.id);
    this.deviceId = connected.id;

    // Probe common UART characteristics; production should query services
    this.serviceUUID = CANDIDATE_SERVICES[0]!;
    this.writeUUID = CANDIDATE_WRITE[0]!;
    this.notifyUUID = CANDIDATE_NOTIFY[0]!;

    this.subscription = mgr.monitorCharacteristicForDevice(
      connected.id,
      this.notifyUUID,
      this.notifyUUID === this.writeUUID ? CANDIDATE_NOTIFY[0]! : this.notifyUUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) {
          // Try alternate notify UUIDs silently on first failures in real hardware
          return;
        }
        const chunk = base64ToAscii(characteristic.value);
        this.buffer += chunk;
        if (this.buffer.includes('>')) {
          const full = this.buffer;
          this.buffer = '';
          const waiter = this.waiters.shift();
          waiter?.resolve(full);
        }
      },
    );

    // Attempt notify on alternate UUIDs if primary fails — best-effort second monitor
    for (const svc of CANDIDATE_SERVICES) {
      for (const ntf of CANDIDATE_NOTIFY) {
        try {
          mgr.monitorCharacteristicForDevice(connected.id, svc, ntf, (error, characteristic) => {
            if (error || !characteristic?.value) return;
            this.serviceUUID = svc;
            this.notifyUUID = ntf;
            const chunk = base64ToAscii(characteristic.value);
            this.buffer += chunk;
            if (this.buffer.includes('>')) {
              const full = this.buffer;
              this.buffer = '';
              const waiter = this.waiters.shift();
              waiter?.resolve(full);
            }
          });
        } catch {
          /* characteristic may not exist */
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    const mgr = this.loadManager();
    const id = this.deviceId;
    this.subscription?.remove();
    this.subscription = null;
    this.deviceId = null;
    this.buffer = '';
    this.waiters.forEach((w) => w.reject(new Error('Отключено')));
    this.waiters = [];
    if (!mgr || !id) return;
    try {
      await mgr.cancelDeviceConnection(id);
    } catch {
      /* ignore */
    }
  }

  async sendCommand(command: string, timeoutMs = 8000): Promise<string> {
    const mgr = this.loadManager();
    if (!mgr || !this.deviceId || !this.serviceUUID || !this.writeUUID) {
      throw new Error('Нет BLE-соединения или не найден UART-характеристика');
    }
    const line = command.trim().endsWith('\r') ? command.trim() : `${command.trim()}\r`;
    this.buffer = '';

    const responsePromise = new Promise<string>((resolve, reject) => {
      this.waiters.push({ resolve, reject, started: Date.now() });
      setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
          if (this.buffer) resolve(this.buffer);
          else reject(new Error(`Таймаут BLE на ${command}`));
        }
      }, timeoutMs);
    });

    let written = false;
    for (const svc of CANDIDATE_SERVICES) {
      for (const wr of CANDIDATE_WRITE) {
        try {
          await mgr.writeCharacteristicWithResponseForDevice(
            this.deviceId,
            svc,
            wr,
            asciiToBase64(line),
          );
          this.serviceUUID = svc;
          this.writeUUID = wr;
          written = true;
          break;
        } catch {
          /* try next */
        }
      }
      if (written) break;
    }
    if (!written) {
      throw new Error('Не удалось записать в BLE UART (неизвестный сервис адаптера)');
    }

    return responsePromise;
  }
}

async function ensureBlePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (api >= 31) {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
  } else {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
  }
}

function asciiToBase64(value: string): string {
  // RN global
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  // Fallback
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  const bytes = Array.from(value).map((c) => c.charCodeAt(0));
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const bitmap = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    output += chars.charAt((bitmap >> 18) & 63);
    output += chars.charAt((bitmap >> 12) & 63);
    output += b === undefined ? '=' : chars.charAt((bitmap >> 6) & 63);
    output += c === undefined ? '=' : chars.charAt(bitmap & 63);
  }
  return output;
}

function base64ToAscii(value: string): string {
  if (typeof atob === 'function') {
    return atob(value);
  }
  // Minimal decode fallback
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/=+$/, '');
  let output = '';
  for (let i = 0; i < clean.length; i += 4) {
    const enc1 = chars.indexOf(clean.charAt(i));
    const enc2 = chars.indexOf(clean.charAt(i + 1));
    const enc3 = chars.indexOf(clean.charAt(i + 2));
    const enc4 = chars.indexOf(clean.charAt(i + 3));
    const bitmap = (enc1 << 18) | (enc2 << 12) | ((enc3 & 63) << 6) | (enc4 & 63);
    output += String.fromCharCode((bitmap >> 16) & 255);
    if (enc3 !== -1 && clean.charAt(i + 2) !== '') output += String.fromCharCode((bitmap >> 8) & 255);
    if (enc4 !== -1 && clean.charAt(i + 3) !== '') output += String.fromCharCode(bitmap & 255);
  }
  return output;
}
