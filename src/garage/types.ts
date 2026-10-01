/** Passport + maintenance model for Car companion (local-first). */

export type MaintenanceType =
  | 'oil'
  | 'oil_filter'
  | 'air_filter'
  | 'cabin_filter'
  | 'spark_plugs'
  | 'other';

/** Seed for future journal search by vehicle type — not a separate «база опыта». */
export type Car = {
  id: string;
  make: string;
  model: string;
  year: number;
  /** e.g. 1.4 TSI, 2.0 TDI */
  engine?: string;
  /** trim / package / configuration */
  trim?: string;
  vin?: string;
  plate?: string;
  currentMileage: number;
  mileageUpdatedAt: string;
  /** Default oil interval, km */
  oilIntervalKm: number;
  notes?: string;
  createdAt: string;
};

export type MaintenanceEvent = {
  id: string;
  carId: string;
  type: MaintenanceType;
  doneAt: string;
  mileage: number;
  oilBrand?: string;
  partNumber?: string;
  comment?: string;
  /** Optional spend — seed for future finances module */
  cost?: number;
  createdAt: string;
};

export type GarageStore = {
  version: 1;
  cars: Car[];
  events: MaintenanceEvent[];
};

export type DueStatus = 'ok' | 'soon' | 'overdue' | 'unknown';

export type IntervalDue = {
  type: MaintenanceType;
  label: string;
  lastMileage: number | null;
  lastDoneAt: string | null;
  intervalKm: number;
  nextDueMileage: number | null;
  remainingKm: number | null;
  status: DueStatus;
};

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  oil: 'Масло',
  oil_filter: 'Масляный фильтр',
  air_filter: 'Воздушный фильтр',
  cabin_filter: 'Салонный фильтр',
  spark_plugs: 'Свечи',
  other: 'Другое',
};

export const DEFAULT_INTERVALS_KM: Partial<Record<MaintenanceType, number>> = {
  oil: 10_000,
  oil_filter: 10_000,
  air_filter: 20_000,
  cabin_filter: 15_000,
  spark_plugs: 30_000,
};

export const SOON_THRESHOLD_KM = 2_000;
