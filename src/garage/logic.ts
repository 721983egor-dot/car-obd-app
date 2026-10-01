import {
  DEFAULT_INTERVALS_KM,
  MAINTENANCE_TYPE_LABELS,
  SOON_THRESHOLD_KM,
  type Car,
  type DueStatus,
  type IntervalDue,
  type MaintenanceEvent,
  type MaintenanceType,
} from './types';

export function carTitle(car: Car): string {
  return `${car.make} ${car.model}`.trim();
}

export function carPassportLine(car: Car): string {
  const bits = [
    car.year ? String(car.year) : null,
    car.engine?.trim() || null,
    car.trim?.trim() || null,
  ].filter(Boolean);
  return bits.join(' · ');
}

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString('ru-RU')} км`;
}

export function formatMoney(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

export function formatDateRu(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastEventForType(
  events: MaintenanceEvent[],
  carId: string,
  type: MaintenanceType,
): MaintenanceEvent | null {
  const list = events
    .filter((e) => e.carId === carId && e.type === type)
    .sort((a, b) => {
      if (b.mileage !== a.mileage) return b.mileage - a.mileage;
      return b.doneAt.localeCompare(a.doneAt);
    });
  return list[0] ?? null;
}

export function computeDue(
  car: Car,
  events: MaintenanceEvent[],
  type: MaintenanceType,
): IntervalDue {
  const label = MAINTENANCE_TYPE_LABELS[type];
  const intervalKm =
    type === 'oil' || type === 'oil_filter'
      ? car.oilIntervalKm || DEFAULT_INTERVALS_KM.oil || 10_000
      : DEFAULT_INTERVALS_KM[type] ?? 10_000;

  const last = lastEventForType(events, car.id, type);
  if (!last) {
    return {
      type,
      label,
      lastMileage: null,
      lastDoneAt: null,
      intervalKm,
      nextDueMileage: null,
      remainingKm: null,
      status: 'unknown',
    };
  }

  const nextDueMileage = last.mileage + intervalKm;
  const remainingKm = nextDueMileage - car.currentMileage;
  let status: DueStatus = 'ok';
  if (remainingKm <= 0) status = 'overdue';
  else if (remainingKm <= SOON_THRESHOLD_KM) status = 'soon';

  return {
    type,
    label,
    lastMileage: last.mileage,
    lastDoneAt: last.doneAt,
    intervalKm,
    nextDueMileage,
    remainingKm,
    status,
  };
}

export function upcomingForCar(
  car: Car,
  events: MaintenanceEvent[],
  types: MaintenanceType[] = ['oil', 'oil_filter', 'air_filter', 'cabin_filter', 'spark_plugs'],
): IntervalDue[] {
  return types
    .map((t) => computeDue(car, events, t))
    .filter((d) => d.status !== 'unknown' || d.type === 'oil')
    .sort((a, b) => {
      const rank = (s: DueStatus) =>
        s === 'overdue' ? 0 : s === 'soon' ? 1 : s === 'ok' ? 2 : 3;
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      const ra = a.remainingKm ?? Number.POSITIVE_INFINITY;
      const rb = b.remainingKm ?? Number.POSITIVE_INFINITY;
      return ra - rb;
    });
}

export function primaryBadge(car: Car, events: MaintenanceEvent[]): {
  text: string;
  status: DueStatus;
} {
  const oil = computeDue(car, events, 'oil');
  if (oil.status === 'unknown') {
    return { text: 'нет записи масла', status: 'unknown' };
  }
  if (oil.status === 'overdue') {
    const over = Math.abs(oil.remainingKm ?? 0);
    return { text: `масло просрочено ${formatKm(over)}`, status: 'overdue' };
  }
  if (oil.status === 'soon') {
    return { text: `масло ~${formatKm(oil.remainingKm ?? 0)}`, status: 'soon' };
  }
  return { text: `масло через ${formatKm(oil.remainingKm ?? 0)}`, status: 'ok' };
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
