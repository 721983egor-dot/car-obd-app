import type { Car, GarageStore, MaintenanceEvent } from './types';
import { newId } from './logic';

/** Demo seed so Expo Go looks alive on first open. */
export function createSeedStore(): GarageStore {
  const now = new Date().toISOString();
  const octaviaId = newId('car');
  const poloId = newId('car');

  const cars: Car[] = [
    {
      id: octaviaId,
      make: 'Skoda',
      model: 'Octavia',
      year: 2019,
      engine: '1.4 TSI',
      trim: 'Style',
      currentMileage: 142_300,
      mileageUpdatedAt: now,
      oilIntervalKm: 10_000,
      createdAt: now,
    },
    {
      id: poloId,
      make: 'Volkswagen',
      model: 'Polo',
      year: 2014,
      engine: '1.6 MPI',
      trim: 'Highline',
      currentMileage: 98_100,
      mileageUpdatedAt: now,
      oilIntervalKm: 10_000,
      createdAt: now,
    },
  ];

  const events: MaintenanceEvent[] = [
    {
      id: newId('evt'),
      carId: octaviaId,
      type: 'oil',
      doneAt: '2025-11-12',
      mileage: 134_500,
      oilBrand: 'Motul 5W-40',
      partNumber: '108222',
      comment: 'Дилер, оригинал фильтр',
      cost: 7800,
      createdAt: now,
    },
    {
      id: newId('evt'),
      carId: octaviaId,
      type: 'oil_filter',
      doneAt: '2025-11-12',
      mileage: 134_500,
      partNumber: '04E115561H',
      cost: 900,
      createdAt: now,
    },
    {
      id: newId('evt'),
      carId: octaviaId,
      type: 'air_filter',
      doneAt: '2025-06-01',
      mileage: 128_000,
      cost: 1500,
      createdAt: now,
    },
    {
      id: newId('evt'),
      carId: poloId,
      type: 'oil',
      doneAt: '2026-02-20',
      mileage: 92_000,
      oilBrand: 'Castrol Magnatec 5W-30',
      cost: 4500,
      createdAt: now,
    },
    {
      id: newId('evt'),
      carId: poloId,
      type: 'cabin_filter',
      doneAt: '2025-09-10',
      mileage: 88_400,
      cost: 1200,
      createdAt: now,
    },
  ];

  return { version: 1, cars, events };
}
