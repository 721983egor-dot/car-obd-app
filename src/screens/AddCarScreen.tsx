import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { newId, saveCar, todayIsoDate, type Car } from '../garage';
import { colors } from '../ui/theme';
import { Btn, Field, ScreenHeader } from '../ui/components';

type Props = {
  onBack: () => void;
  onSaved: (carId: string) => void;
};

export function AddCarScreen({ onBack, onSaved }: Props) {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [engine, setEngine] = useState('');
  const [trim, setTrim] = useState('');
  const [vin, setVin] = useState('');
  const [mileage, setMileage] = useState('');
  const [oilInterval, setOilInterval] = useState('10000');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const makeT = make.trim();
    const modelT = model.trim();
    const yearN = Number(year);
    const mileageN = Number(String(mileage).replace(/\s/g, ''));
    const intervalN = Number(String(oilInterval).replace(/\s/g, '')) || 10_000;

    if (!makeT || !modelT) {
      Alert.alert('Авто', 'Укажите марку и модель');
      return;
    }
    if (!Number.isFinite(yearN) || yearN < 1950 || yearN > 2100) {
      Alert.alert('Авто', 'Укажите корректный год');
      return;
    }
    if (!Number.isFinite(mileageN) || mileageN < 0) {
      Alert.alert('Авто', 'Укажите текущий пробег');
      return;
    }

    setBusy(true);
    try {
      const now = new Date().toISOString();
      const car: Car = {
        id: newId('car'),
        make: makeT,
        model: modelT,
        year: Math.round(yearN),
        engine: engine.trim() || undefined,
        trim: trim.trim() || undefined,
        vin: vin.trim() || undefined,
        currentMileage: Math.round(mileageN),
        mileageUpdatedAt: now,
        oilIntervalKm: Math.round(intervalN),
        createdAt: now,
      };
      await saveCar(car);
      onSaved(car.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Новое авто" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Паспорт (марка, модель, год, мотор, комплектация) пригодится для поиска по журналу позже.
          Сегодня достаточно для гаража и ТО.
        </Text>
        <Field label="Марка" value={make} onChangeText={setMake} placeholder="Skoda" />
        <Field label="Модель" value={model} onChangeText={setModel} placeholder="Octavia" />
        <Field
          label="Год"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          placeholder="2019"
        />
        <Field
          label="Двигатель"
          value={engine}
          onChangeText={setEngine}
          placeholder="1.4 TSI"
          optional
        />
        <Field
          label="Комплектация"
          value={trim}
          onChangeText={setTrim}
          placeholder="Style"
          optional
        />
        <Field label="VIN" value={vin} onChangeText={setVin} placeholder="опционально" optional />
        <Field
          label="Текущий пробег, км"
          value={mileage}
          onChangeText={setMileage}
          keyboardType="number-pad"
          placeholder="142300"
        />
        <Field
          label="Интервал масла, км"
          value={oilInterval}
          onChangeText={setOilInterval}
          keyboardType="number-pad"
          optional
        />
        <Text style={styles.meta}>Дата добавления: {todayIsoDate()}</Text>
        <Btn label={busy ? 'Сохраняем…' : 'Сохранить'} onPress={() => void save()} disabled={busy} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  lead: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  meta: { color: colors.textDim, fontSize: 12 },
});
