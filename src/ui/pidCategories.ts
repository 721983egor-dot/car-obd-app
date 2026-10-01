import type { ParsedPidValue } from '../obd';

export type PidCategoryId =
  | 'core'
  | 'temps'
  | 'fuel'
  | 'intake'
  | 'ignition'
  | 'o2'
  | 'electrical'
  | 'diag'
  | 'other';

export interface PidCategory {
  id: PidCategoryId;
  title: string;
}

const CATEGORY_ORDER: PidCategory[] = [
  { id: 'core', title: 'Движение и нагрузка' },
  { id: 'temps', title: 'Температуры' },
  { id: 'fuel', title: 'Топливо' },
  { id: 'intake', title: 'Впуск и дроссель' },
  { id: 'ignition', title: 'Зажигание' },
  { id: 'o2', title: 'Датчики O₂' },
  { id: 'electrical', title: 'Электрика' },
  { id: 'diag', title: 'Диагностика' },
  { id: 'other', title: 'Прочее' },
];

const PID_CATEGORY: Record<string, PidCategoryId> = {
  '04': 'core',
  '0C': 'core',
  '0D': 'core',
  '1F': 'core',
  '43': 'core',
  '05': 'temps',
  '0F': 'temps',
  '46': 'temps',
  '5C': 'temps',
  '06': 'fuel',
  '07': 'fuel',
  '0A': 'fuel',
  '2F': 'fuel',
  '5E': 'fuel',
  '0B': 'intake',
  '10': 'intake',
  '11': 'intake',
  '45': 'intake',
  '47': 'intake',
  '49': 'intake',
  '4A': 'intake',
  '0E': 'ignition',
  '14': 'o2',
  '15': 'o2',
  '42': 'electrical',
  '21': 'diag',
  '30': 'diag',
  '31': 'diag',
  '33': 'diag',
};

function normalizePid(pid: string): string {
  const cleaned = pid.replace(/^01/i, '').toUpperCase();
  return cleaned.length === 1 ? `0${cleaned}` : cleaned.slice(-2);
}

export function categoryForPid(pid: string): PidCategoryId {
  return PID_CATEGORY[normalizePid(pid)] ?? 'other';
}

export function groupPidsByCategory(
  pids: ParsedPidValue[],
): Array<{ category: PidCategory; items: ParsedPidValue[] }> {
  const buckets = new Map<PidCategoryId, ParsedPidValue[]>();
  for (const p of pids) {
    const id = categoryForPid(p.pid);
    const list = buckets.get(id) ?? [];
    list.push(p);
    buckets.set(id, list);
  }
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: buckets.get(category.id) ?? [],
  })).filter((g) => g.items.length > 0);
}
