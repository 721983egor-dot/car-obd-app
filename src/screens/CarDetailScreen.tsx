import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  carPassportLine,
  carTitle,
  eventsForCar,
  formatDateRu,
  formatKm,
  formatMoney,
  loadGarage,
  MAINTENANCE_TYPE_LABELS,
  subscribeGarage,
  upcomingForCar,
  updateMileage,
  type GarageStore,
} from '../garage';
import { colors } from '../ui/theme';
import { Btn, DueBadge, ScreenHeader, StatusDot } from '../ui/components';

type Props = {
  carId: string;
  onBack: () => void;
  onAddMaintenance: () => void;
  onOpenObd: () => void;
};

export function CarDetailScreen({ carId, onBack, onAddMaintenance, onOpenObd }: Props) {
  const [store, setStore] = useState<GarageStore | null>(null);
  const [editingMileage, setEditingMileage] = useState(false);
  const [mileageDraft, setMileageDraft] = useState('');

  const refresh = useCallback(async () => {
    setStore(await loadGarage());
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeGarage(() => {
      void refresh();
    });
  }, [refresh]);

  const car = store?.cars.find((c) => c.id === carId) ?? null;
  const events = useMemo(
    () => (store && car ? eventsForCar(store, car.id) : []),
    [store, car],
  );
  const upcoming = useMemo(
    () => (car && store ? upcomingForCar(car, store.events).slice(0, 4) : []),
    [car, store],
  );

  const saveMileage = async () => {
    if (!car) return;
    const n = Number(String(mileageDraft).replace(/\s/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert('Пробег', 'Введите корректное число километров');
      return;
    }
    await updateMileage(car.id, Math.round(n));
    setEditingMileage(false);
  };

  if (!store || !car) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const passport = carPassportLine(car);

  return (
    <View style={styles.root}>
      <ScreenHeader title={carTitle(car)} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {passport ? <Text style={styles.passport}>{passport}</Text> : null}

        <View style={styles.mileageBlock}>
          <Text style={styles.eyebrow}>Пробег</Text>
          {editingMileage ? (
            <View style={styles.row}>
              <TextInput
                value={mileageDraft}
                onChangeText={setMileageDraft}
                keyboardType="number-pad"
                style={styles.mileageInput}
                placeholderTextColor={colors.textDim}
              />
              <Btn label="OK" onPress={() => void saveMileage()} />
              <Btn
                label="Отмена"
                variant="ghost"
                onPress={() => setEditingMileage(false)}
              />
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={styles.mileageValue}>{formatKm(car.currentMileage)}</Text>
              <Btn
                label="Обновить"
                variant="ghost"
                onPress={() => {
                  setMileageDraft(String(car.currentMileage));
                  setEditingMileage(true);
                }}
              />
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Скоро</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.hint}>Пока нет прогноза — запишите хотя бы замену масла.</Text>
        ) : (
          upcoming.map((d) => (
            <View key={d.type} style={styles.dueRow}>
              <StatusDot status={d.status} />
              <Text style={styles.dueLabel}>{d.label}</Text>
              <DueBadge
                status={d.status}
                text={
                  d.status === 'unknown'
                    ? 'нет записи'
                    : d.status === 'overdue'
                      ? `просрочено ${formatKm(Math.abs(d.remainingKm ?? 0))}`
                      : `~${formatKm(d.remainingKm ?? 0)}`
                }
              />
            </View>
          ))
        )}

        <View style={styles.ctaCol}>
          <Btn label="Записать ТО" onPress={onAddMaintenance} />
          <Btn label="Проверка OBD" variant="ghost" onPress={onOpenObd} />
        </View>

        <Text style={styles.sectionTitle}>История ТО</Text>
        {events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Пока пусто</Text>
            <Text style={styles.hint}>Первая запись сбросит интервал и даст прогноз.</Text>
          </View>
        ) : (
          events.map((e) => (
            <View key={e.id} style={styles.eventCard}>
              <View style={styles.eventTop}>
                <Text style={styles.eventType}>{MAINTENANCE_TYPE_LABELS[e.type]}</Text>
                <Text style={styles.eventDate}>{formatDateRu(e.doneAt)}</Text>
              </View>
              <Text style={styles.eventMeta}>
                {formatKm(e.mileage)}
                {e.cost != null ? ` · ${formatMoney(e.cost)}` : ''}
              </Text>
              {e.oilBrand ? <Text style={styles.hint}>{e.oilBrand}</Text> : null}
              {e.partNumber ? <Text style={styles.hint}>Арт. {e.partNumber}</Text> : null}
              {e.comment ? <Text style={styles.hint}>{e.comment}</Text> : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  passport: { color: colors.textMuted, fontSize: 14, marginTop: -4 },
  eyebrow: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  mileageBlock: { gap: 8, marginTop: 4 },
  mileageValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    flex: 1,
  },
  mileageInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 18,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  sectionTitle: { color: colors.accent, fontSize: 16, fontWeight: '700', marginTop: 8 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dueLabel: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600' },
  ctaCol: { gap: 10, marginTop: 4 },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSoft,
    padding: 14,
    gap: 6,
  },
  emptyTitle: { color: colors.text, fontWeight: '600', fontSize: 15 },
  eventCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    gap: 4,
  },
  eventTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  eventType: { color: colors.text, fontWeight: '700', fontSize: 15 },
  eventDate: { color: colors.textMuted, fontSize: 13 },
  eventMeta: {
    color: colors.text,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
