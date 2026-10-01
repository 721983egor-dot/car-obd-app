import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  addMaintenanceEvent,
  loadGarage,
  MAINTENANCE_TYPE_LABELS,
  newId,
  todayIsoDate,
  type MaintenanceType,
} from '../garage';
import { colors } from '../ui/theme';
import { Btn, Field, ScreenHeader } from '../ui/components';

const TYPES: MaintenanceType[] = [
  'oil',
  'oil_filter',
  'air_filter',
  'cabin_filter',
  'spark_plugs',
  'other',
];

type Props = {
  carId: string;
  onBack: () => void;
  onSaved: () => void;
};

export function AddMaintenanceScreen({ carId, onBack, onSaved }: Props) {
  const [type, setType] = useState<MaintenanceType>('oil');
  const [date, setDate] = useState(todayIsoDate());
  const [mileage, setMileage] = useState('');
  const [oilBrand, setOilBrand] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [cost, setCost] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const store = await loadGarage();
      const car = store.cars.find((c) => c.id === carId);
      if (car) setMileage(String(car.currentMileage));
    })();
  }, [carId]);

  const save = async () => {
    const mileageN = Number(String(mileage).replace(/\s/g, ''));
    if (!Number.isFinite(mileageN) || mileageN < 0) {
      Alert.alert('ТО', 'Укажите пробег');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert('ТО', 'Дата в формате ГГГГ-ММ-ДД');
      return;
    }
    const costRaw = cost.trim();
    let costN: number | undefined;
    if (costRaw) {
      costN = Number(costRaw.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(costN) || costN < 0) {
        Alert.alert('ТО', 'Сумма должна быть числом');
        return;
      }
    }

    setBusy(true);
    try {
      await addMaintenanceEvent({
        id: newId('evt'),
        carId,
        type,
        doneAt: date.trim(),
        mileage: Math.round(mileageN),
        oilBrand: oilBrand.trim() || undefined,
        partNumber: partNumber.trim() || undefined,
        comment: comment.trim() || undefined,
        cost: costN != null ? Math.round(costN) : undefined,
        createdAt: new Date().toISOString(),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const showOilFields = type === 'oil' || type === 'oil_filter';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Новое ТО" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Тип</Text>
        <View style={styles.chips}>
          {TYPES.map((t) => {
            const active = type === t;
            return (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {MAINTENANCE_TYPE_LABELS[t]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          label="Дата"
          value={date}
          onChangeText={setDate}
          placeholder="2026-10-01"
        />
        <Field
          label="Пробег, км"
          value={mileage}
          onChangeText={setMileage}
          keyboardType="number-pad"
        />
        {showOilFields ? (
          <Field
            label="Марка масла"
            value={oilBrand}
            onChangeText={setOilBrand}
            placeholder="Motul 5W-40"
            optional
          />
        ) : null}
        <Field
          label="Артикул"
          value={partNumber}
          onChangeText={setPartNumber}
          placeholder="фильтр / свечи…"
          optional
        />
        <Field
          label="Сумма, ₽"
          value={cost}
          onChangeText={setCost}
          keyboardType="number-pad"
          placeholder="для будущих расходов"
          optional
        />
        <Field
          label="Комментарий"
          value={comment}
          onChangeText={setComment}
          multiline
          optional
        />

        <Btn label={busy ? 'Сохраняем…' : 'Сохранить'} onPress={() => void save()} disabled={busy} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.accent },
});
