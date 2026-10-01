import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  carPassportLine,
  carTitle,
  formatKm,
  loadGarage,
  primaryBadge,
  subscribeGarage,
  type GarageStore,
} from '../garage';
import { colors } from '../ui/theme';
import { Btn, DueBadge, ScreenHeader, StatusDot } from '../ui/components';

type Props = {
  onOpenCar: (carId: string) => void;
  onAddCar: () => void;
  onOpenObd: () => void;
};

export function GarageScreen({ onOpenCar, onAddCar, onOpenObd }: Props) {
  const [store, setStore] = useState<GarageStore | null>(null);

  const refresh = useCallback(async () => {
    setStore(await loadGarage());
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeGarage(() => {
      void refresh();
    });
  }, [refresh]);

  if (!store) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.hint}>Загружаем гараж…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        brand="CAR"
        title="Гараж"
        right={
          <Pressable onPress={onOpenObd} style={styles.obdChip}>
            <Text style={styles.obdChipText}>OBD</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>Машины и ближайшее ТО. Паспорт авто — для учёта и будущего журнала.</Text>

        {store.cars.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Гараж пуст</Text>
            <Text style={styles.hint}>Добавьте первое авто — марка, модель, год и пробег.</Text>
            <Btn label="+ Добавить авто" onPress={onAddCar} />
          </View>
        ) : (
          store.cars.map((car) => {
            const badge = primaryBadge(car, store.events);
            const passport = carPassportLine(car);
            return (
              <Pressable key={car.id} style={styles.card} onPress={() => onOpenCar(car.id)}>
                <View style={styles.cardRow}>
                  <StatusDot status={badge.status} />
                  <View style={styles.cardMain}>
                    <Text style={styles.cardTitle}>{carTitle(car)}</Text>
                    {passport ? <Text style={styles.passport}>{passport}</Text> : null}
                    <Text style={styles.mileage}>{formatKm(car.currentMileage)}</Text>
                    <DueBadge text={badge.text} status={badge.status} />
                  </View>
                </View>
              </Pressable>
            );
          })
        )}

        {store.cars.length > 0 ? (
          <Btn label="+ Добавить авто" onPress={onAddCar} variant="ghost" />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  lead: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderStyle: 'dashed',
    padding: 18,
    gap: 10,
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  cardRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardMain: { flex: 1, gap: 4 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  passport: { color: colors.textMuted, fontSize: 13 },
  mileage: {
    color: colors.text,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    marginTop: 2,
  },
  obdChip: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentDim,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  obdChipText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});
