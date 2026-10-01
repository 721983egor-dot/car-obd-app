import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Car, GarageStore, MaintenanceEvent } from './types';
import { createSeedStore } from './seed';

const STORAGE_KEY = 'car.garage.v1';

let memoryCache: GarageStore | null = null;
let storageAvailable: boolean | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

async function canUseStorage(): Promise<boolean> {
  if (storageAvailable !== null) return storageAvailable;
  try {
    await AsyncStorage.getItem(STORAGE_KEY);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

export function subscribeGarage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadGarage(): Promise<GarageStore> {
  if (memoryCache) return memoryCache;
  if (await canUseStorage()) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as GarageStore;
        if (parsed?.version === 1 && Array.isArray(parsed.cars) && Array.isArray(parsed.events)) {
          memoryCache = parsed;
          return parsed;
        }
      }
    } catch {
      storageAvailable = false;
    }
  }
  const seed = createSeedStore();
  await persist(seed);
  return seed;
}

async function persist(store: GarageStore): Promise<void> {
  memoryCache = store;
  if (await canUseStorage()) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      storageAvailable = false;
    }
  }
  notify();
}

export async function getGarageSnapshot(): Promise<GarageStore> {
  return loadGarage();
}

export async function saveCar(car: Car): Promise<GarageStore> {
  const store = await loadGarage();
  const idx = store.cars.findIndex((c) => c.id === car.id);
  const cars =
    idx >= 0
      ? store.cars.map((c) => (c.id === car.id ? car : c))
      : [...store.cars, car];
  const next = { ...store, cars };
  await persist(next);
  return next;
}

export async function updateMileage(carId: string, mileage: number): Promise<GarageStore> {
  const store = await loadGarage();
  const cars = store.cars.map((c) =>
    c.id === carId
      ? { ...c, currentMileage: mileage, mileageUpdatedAt: new Date().toISOString() }
      : c,
  );
  const next = { ...store, cars };
  await persist(next);
  return next;
}

export async function addMaintenanceEvent(event: MaintenanceEvent): Promise<GarageStore> {
  const store = await loadGarage();
  let cars = store.cars;
  const car = cars.find((c) => c.id === event.carId);
  if (car && event.mileage > car.currentMileage) {
    cars = cars.map((c) =>
      c.id === event.carId
        ? {
            ...c,
            currentMileage: event.mileage,
            mileageUpdatedAt: new Date().toISOString(),
          }
        : c,
    );
  }
  const next = { ...store, cars, events: [event, ...store.events] };
  await persist(next);
  return next;
}

export async function resetGarageToSeed(): Promise<GarageStore> {
  const seed = createSeedStore();
  await persist(seed);
  return seed;
}

export function eventsForCar(store: GarageStore, carId: string): MaintenanceEvent[] {
  return store.events
    .filter((e) => e.carId === carId)
    .sort((a, b) => {
      const d = b.doneAt.localeCompare(a.doneAt);
      if (d !== 0) return d;
      return b.mileage - a.mileage;
    });
}
