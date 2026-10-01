import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  createTransport,
  ObdSession,
  type ObdDevice,
  type ObdReadingSnapshot,
  type ParsedPidValue,
  type TransportKind,
  type VinResult,
} from './src/obd';
import { readingsSync } from './src/sync/readingsSync';

type Step = 'transport' | 'scan' | 'connected' | 'results';

const TRANSPORTS: Array<{ kind: TransportKind; title: string; hint: string }> = [
  {
    kind: 'mock',
    title: 'Симулятор',
    hint: 'Без адаптера — проверка экранов (Expo Go ок)',
  },
  {
    kind: 'classic',
    title: 'Bluetooth Classic',
    hint: 'Типичный дешёвый ELM327 (SPP). Нужен Dev Client',
  },
  {
    kind: 'ble',
    title: 'Bluetooth LE',
    hint: 'Только BLE-адаптеры (FFF0/NUS). Нужен Dev Client',
  },
];

export default function App() {
  const [step, setStep] = useState<Step>('transport');
  const [kind, setKind] = useState<TransportKind>('mock');
  const [session, setSession] = useState<ObdSession | null>(null);
  const [devices, setDevices] = useState<ObdDevice[]>([]);
  const [selected, setSelected] = useState<ObdDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Выберите тип подключения');
  const [error, setError] = useState<string | null>(null);
  const [vin, setVin] = useState<VinResult | null>(null);
  const [pids, setPids] = useState<ParsedPidValue[]>([]);
  const [rawLog, setRawLog] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<ObdReadingSnapshot | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);

  const availability = useMemo(() => session?.availabilityNote ?? '', [session]);

  const startWithTransport = useCallback(async (next: TransportKind) => {
    setError(null);
    setKind(next);
    const transport = createTransport(next);
    const s = new ObdSession(transport);
    setSession(s);
    setDevices([]);
    setSelected(null);
    setStatus(transport.availabilityNote);
    setStep('scan');

    const available = await s.isAvailable();
    if (!available && next !== 'mock') {
      setError(
        'Транспорт недоступен: включите Bluetooth и соберите приложение через Expo Dev Client (не Expo Go). Можно продолжить с симулятором.',
      );
    }
  }, []);

  const scan = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setDevices([]);
    setStatus('Сканирование…');
    try {
      await session.scan((device) => {
        setDevices((prev) => {
          if (prev.some((d) => d.id === device.id)) return prev;
          return [...prev, device];
        });
      });
      // Classic discovery is one-shot; BLE keeps scanning until stop
      if (kind === 'classic' || kind === 'mock') {
        setStatus('Сканирование завершено. Выберите адаптер.');
      } else {
        setStatus('Идёт BLE-сканирование. Выберите устройство.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('Ошибка сканирования');
    } finally {
      setBusy(false);
    }
  }, [session, kind]);

  const connectAndRead = useCallback(
    async (device: ObdDevice) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      setSelected(device);
      setVin(null);
      setPids([]);
      setRawLog([]);
      setSnapshot(null);
      setQueuedId(null);
      setStep('connected');
      setStatus(`Подключение к ${device.name}…`);
      try {
        await session.stopScan();
        await session.connect(device);
        setStatus('Инициализация ELM327… VIN…');
        const vinResult = await session.readVin();
        setVin(vinResult);
        appendRaw(setRawLog, '0902', vinResult.raw);

        setStatus('Чтение PID (RPM, скорость, ОЖ)…');
        const pidResult = await session.readStandardPids();
        setPids(pidResult.parsed);
        pidResult.raw.forEach((r) => appendRaw(setRawLog, r.command, r.raw));

        const snap: ObdReadingSnapshot = {
          recordedAt: new Date().toISOString(),
          vin: vinResult.vin,
          rpm: pidResult.rpm,
          speedKmh: pidResult.speedKmh,
          coolantTempC: pidResult.coolantTempC,
          rawPids: pidResult.raw,
          device: { id: device.id, name: device.name, transport: device.transport },
        };
        setSnapshot(snap);

        const { queuedId: qid } = await readingsSync.enqueue('local-car-demo', snap);
        setQueuedId(qid);

        setStatus('Готово. Данные ниже (синхронизация — заглушка).');
        setStep('results');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('Ошибка чтения');
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const reread = useCallback(async () => {
    if (!session || !selected) return;
    setBusy(true);
    setError(null);
    setStatus('Повторное чтение…');
    try {
      const vinResult = await session.readVin();
      setVin(vinResult);
      appendRaw(setRawLog, '0902', vinResult.raw);
      const pidResult = await session.readStandardPids();
      setPids(pidResult.parsed);
      pidResult.raw.forEach((r) => appendRaw(setRawLog, r.command, r.raw));
      const snap: ObdReadingSnapshot = {
        recordedAt: new Date().toISOString(),
        vin: vinResult.vin,
        rpm: pidResult.rpm,
        speedKmh: pidResult.speedKmh,
        coolantTempC: pidResult.coolantTempC,
        rawPids: pidResult.raw,
        device: {
          id: selected.id,
          name: selected.name,
          transport: selected.transport,
        },
      };
      setSnapshot(snap);
      const { queuedId: qid } = await readingsSync.enqueue('local-car-demo', snap);
      setQueuedId(qid);
      setStatus('Готово (повтор).');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('Ошибка повторного чтения');
    } finally {
      setBusy(false);
    }
  }, [session, selected]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      await session?.stopScan();
      await session?.disconnect();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      setSession(null);
      setSelected(null);
      setDevices([]);
      setStep('transport');
      setStatus('Отключено. Выберите тип подключения.');
      setError(null);
    }
  }, [session]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.brand}>CAR</Text>
        <Text style={styles.subtitle}>OBD companion — тест</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.status}>{status}</Text>
        {availability ? <Text style={styles.hint}>{availability}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {step === 'transport' && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>1. Тип адаптера</Text>
            {TRANSPORTS.map((t) => (
              <Pressable
                key={t.kind}
                style={[styles.card, kind === t.kind && styles.cardActive]}
                onPress={() => startWithTransport(t.kind)}
              >
                <Text style={styles.cardTitle}>{t.title}</Text>
                <Text style={styles.cardHint}>{t.hint}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {step === 'scan' && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>2. Поиск адаптера</Text>
            <View style={styles.row}>
              <Btn label={busy ? '…' : 'Сканировать'} onPress={scan} disabled={busy} />
              <Btn label="Назад" onPress={disconnect} variant="ghost" />
            </View>
            {devices.length === 0 && !busy ? (
              <Text style={styles.hint}>Устройств пока нет. Нажмите «Сканировать».</Text>
            ) : null}
            {devices.map((d) => (
              <Pressable key={d.id} style={styles.card} onPress={() => connectAndRead(d)} disabled={busy}>
                <Text style={styles.cardTitle}>{d.name}</Text>
                <Text style={styles.cardHint}>
                  {d.address ?? d.id} · {d.transport}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {(step === 'connected' || step === 'results') && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>3. Сессия {selected ? `· ${selected.name}` : ''}</Text>
            {busy ? (
              <View style={styles.loading}>
                <ActivityIndicator color="#E8A317" />
                <Text style={styles.hint}>Обмен с адаптером…</Text>
              </View>
            ) : null}

            {vin && (
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>VIN (с OBD Mode 09)</Text>
                <Text style={styles.metricValue}>{vin.vin ?? 'нет данных'}</Text>
                {vin.note ? <Text style={styles.hint}>{vin.note}</Text> : null}
              </View>
            )}

            {pids.map((p) => (
              <View key={p.pid} style={styles.metric}>
                <Text style={styles.metricLabel}>
                  {p.label} ({p.pid})
                </Text>
                <Text style={styles.metricValue}>
                  {p.value === null || p.value === undefined ? '—' : `${p.value} ${p.unit}`}
                </Text>
              </View>
            ))}

            {rawLog.length > 0 && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Сырой ответ</Text>
                {rawLog.map((line, i) => (
                  <Text key={`${i}-${line.slice(0, 12)}`} style={styles.mono}>
                    {line}
                  </Text>
                ))}
              </View>
            )}

            {snapshot && (
              <Text style={styles.hint}>
                Снимок {snapshot.recordedAt}
                {queuedId ? ` · очередь sync: ${queuedId}` : ''}
              </Text>
            )}

            <View style={styles.row}>
              <Btn label="Отключить" onPress={disconnect} disabled={busy} />
              {step === 'results' && selected ? (
                <Btn label="Читать снова" onPress={() => reread()} disabled={busy} variant="ghost" />
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Classic SPP — основной путь для дешёвых ELM327. BLE — только если адаптер реально BLE.
            VIN с OBD ≠ расшифровка марки/модели (для этого внешние VIN API).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function appendRaw(
  setRawLog: Dispatch<SetStateAction<string[]>>,
  cmd: string,
  raw: string,
) {
  setRawLog((prev) => [...prev, `> ${cmd}\n${raw.trim()}`]);
}

function Btn({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        variant === 'ghost' && styles.btnGhost,
        disabled && styles.btnDisabled,
      ]}
    >
      <Text style={[styles.btnText, variant === 'ghost' && styles.btnTextGhost]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1C1F24' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2F36',
  },
  brand: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F2F3F5',
    letterSpacing: 2,
  },
  subtitle: { color: '#9AA0A6', marginTop: 2, fontSize: 14 },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  status: { color: '#F2F3F5', fontSize: 16, fontWeight: '600' },
  hint: { color: '#9AA0A6', fontSize: 13, lineHeight: 18 },
  error: {
    color: '#F87171',
    backgroundColor: '#3A2222',
    padding: 10,
    borderRadius: 8,
    overflow: 'hidden',
    fontSize: 13,
  },
  block: { gap: 10, marginTop: 8 },
  blockTitle: { color: '#E8A317', fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: '#2A2F36',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A4048',
  },
  cardActive: { borderColor: '#E8A317' },
  cardTitle: { color: '#F2F3F5', fontSize: 16, fontWeight: '600' },
  cardHint: { color: '#9AA0A6', marginTop: 4, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  btn: {
    backgroundColor: '#E8A317',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3A4048',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#1C1F24', fontWeight: '700' },
  btnTextGhost: { color: '#F2F3F5' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metric: {
    backgroundColor: '#2A2F36',
    padding: 12,
    borderRadius: 8,
  },
  metricLabel: { color: '#9AA0A6', fontSize: 12 },
  metricValue: {
    color: '#F2F3F5',
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  mono: {
    fontFamily: 'monospace',
    color: '#C5C8CE',
    fontSize: 11,
    backgroundColor: '#12151A',
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  footer: { marginTop: 24 },
  footerText: { color: '#6B7280', fontSize: 12, lineHeight: 17 },
});
