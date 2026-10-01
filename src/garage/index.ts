export { createSeedStore } from './seed';
export {
  loadGarage,
  saveCar,
  updateMileage,
  addMaintenanceEvent,
  resetGarageToSeed,
  eventsForCar,
  subscribeGarage,
  getGarageSnapshot,
} from './storage';
export {
  carTitle,
  carPassportLine,
  formatKm,
  formatMoney,
  formatDateRu,
  todayIsoDate,
  computeDue,
  upcomingForCar,
  primaryBadge,
  newId,
} from './logic';
export type {
  Car,
  MaintenanceEvent,
  MaintenanceType,
  GarageStore,
  IntervalDue,
  DueStatus,
} from './types';
export {
  MAINTENANCE_TYPE_LABELS,
  DEFAULT_INTERVALS_KM,
  SOON_THRESHOLD_KM,
} from './types';
