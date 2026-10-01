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
  type DtcCode,
  type DtcResult,
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
    kind: 'classic',
    title: 'Bluetooth Classic (основной)',
    hint: 'Типичный дешёвый ELM327 (SPP). Нужен Dev Client — Expo Go не умеет',
  },
  {
    kind: 'ble',
    title: 'Bluetooth LE',
    hint: 'Только если адаптер реально BLE (FFF0/NUS). Нужен Dev Client',
  },
  {
    kind: 'mock',
    title: 'Симулятор',
    hint: 'Без адаптера — проверка экранов (Expo Go ок)',
  },
];

export default function App() {
  const [step, setStep] = useState<Step>('transport');
  const [kind, setKind] = useState<TransportKind>('classic');
  const [session, setSession] = useState<ObdSession | null>(null);
  const [devices, setDevices] = useState<ObdDevice[]>([]);
  const [selected, setSelected] = useState<ObdDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Выберите тип подключения');
  const [error, setError] = useState<string | null>(null);
  const [vin, setVin] = useState<VinResult | null>(null);
  const [dtc, setDtc] = useState<DtcResult | null>(null);
  const [pids, setPids] = useState<ParsedPidValue[]>([]);
  const [supportedPids, setSupportedPids] = useState<string[]>([]);
  const [rawLog, setRawLog] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [expandedRawPid, setExpandedRawPid] = useState<string | null>(null);
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
        'Транспорт недоступен: включите Bluetooth и соберите приложение через npx expo run:android (Dev Client). Expo Go настоящий BT не умеет. Можно продолжить с симулятором.',
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

  const applyReadResults = useCallback(
    async (device: ObdDevice, s: ObdSession) => {
      setStatus('Инициализация… VIN…');
      const vinResult = await s.readVin();
      setVin(vinResult);
      appendRaw(setRawLog, '0902', vinResult.raw);

      setStatus('Чтение ошибок (DTC Mode 03)…');
      const dtcResult = await s.readDtcs();
      setDtc(dtcResult);
      appendRaw(setRawLog, '03', dtcResult.raw);

      setStatus('Опрос поддерживаемых PID и чтение параметров…');
      const pidResult = await s.readAllParameters();
      setPids(pidResult.parsed);
      setSupportedPids(pidResult.supportedPids);
      pidResult.raw.forEach((r) => appendRaw(setRawLog, r.command, r.raw));

      const snap: ObdReadingSnapshot = {
        recordedAt: new Date().toISOString(),
        vin: vinResult.vin,
        rpm: pidResult.rpm,
        speedKmh: pidResult.speedKmh,
        coolantTempC: pidResult.coolantTempC,
        batteryVoltage: pidResult.batteryVoltage,
        dtcs: dtcResult.codes,
        parameters: pidResult.parsed,
        supportedPids: pidResult.supportedPids,
        rawPids: pidResult.raw,
        device: { id: device.id, name: device.name, transport: device.transport },
      };
      setSnapshot(snap);

      const { queuedId: qid } = await readingsSync.enqueue('local-car-demo', snap);
      setQueuedId(qid);
      setStatus('Готово. Данные ниже (синхронизация — заглушка).');
      setStep('results');
    },
    [],
  );

  const connectAndRead = useCallback(
    async (device: ObdDevice) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      setSelected(device);
      setVin(null);
      setDtc(null);
      setPids([]);
      setSupportedPids([]);
      setRawLog([]);
      setShowRaw(false);
      setExpandedRawPid(null);
      setSnapshot(null);
      setQueuedId(null);
      setStep('connected');
      setStatus(`Подключение к ${device.name}…`);
      try {
        await session.stopScan();
        await session.connect(device);
        await applyReadResults(device, session);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('Ошибка чтения');
      } finally {
        setBusy(false);
      }
    },
    [session, applyReadResults],
  );

  const reread = useCallback(async () => {
    if (!session || !selected) return;
    setBusy(true);
    setError(null);
    setStatus('Повторное чтение…');
    setRawLog([]);
    try {
      await applyReadResults(selected, session);
      setStatus('Готово (повтор).');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('Ошибка повторного чтения');
    } finally {
      setBusy(false);
    }
  }, [session, selected, applyReadResults]);

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
            <Text style={styles.hint}>
              Для настоящей машины: Bluetooth Classic + сборка Dev Client. Симулятор — только демо в Expo Go.
            </Text>
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
                  {d.meta?.bonded ? ' · спарен' : ''}
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

            {dtc && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Ошибки Check Engine (DTC)</Text>
                {dtc.codes.length === 0 ? (
                  <Text style={styles.hint}>{dtc.note ?? 'Активных кодов нет.'}</Text>
                ) : (
                  dtc.codes.map((c) => <DtcRow key={c.code} item={c} />)
                )}
                {dtc.codes.length > 0 && dtc.note ? (
                  <Text style={styles.hint}>{dtc.note}</Text>
                ) : null}
              </View>
            )}

            {pids.length > 0 && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Параметры ({pids.length})</Text>
                {supportedPids.length > 0 ? (
                  <Text style={styles.hint}>
                    ЭБУ заявил поддержку: {supportedPids.length} PID · читаем те, что умеем разобрать
                  </Text>
                ) : null}
                {pids.map((p) => (
                  <Pressable
                    key={p.pid}
                    style={styles.metric}
                    onPress={() =>
                      setExpandedRawPid((cur) => (cur === p.pid ? null : p.pid))
                    }
                  >
                    <Text style={styles.metricLabel}>
                      {p.label} ({p.pid})
                    </Text>
                    <Text style={styles.metricValue}>
                      {p.value === null || p.value === undefined
                        ? '—'
                        : `${p.value}${p.unit ? ` ${p.unit}` : ''}`}
                    </Text>
                    {expandedRawPid === p.pid ? (
                      <Text style={styles.monoSmall}>{p.raw.trim() || '(пусто)'}</Text>
                    ) : (
                      <Text style={styles.tapHint}>нажмите — сырой ответ</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {rawLog.length > 0 && (
              <View style={styles.block}>
                <Pressable onPress={() => setShowRaw((v) => !v)}>
                  <Text style={styles.blockTitle}>
                    Сырой лог {showRaw ? '▾' : '▸'} ({rawLog.length})
                  </Text>
                </Pressable>
                {showRaw
                  ? rawLog.map((line, i) => (
                      <Text key={`${i}-${line.slice(0, 12)}`} style={styles.mono}>
                        {line}
                      </Text>
                    ))
                  : null}
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
            Classic SPP — основной путь для дешёвых ELM327. Expo Go = только симулятор. Живой адаптер:
            npx expo run:android (Dev Client). VIN с OBD ≠ расшифровка марки (для этого внешние API).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DtcRow({ item }: { item: DtcCode }) {
  return (
    <View style={styles.dtcRow}>
      <Text style={styles.dtcCode}>{item.code}</Text>
      <Text style={styles.dtcDesc}>{item.descriptionRu ?? 'описание не найдено — смотрите код'}</Text>
    </View>
  );
}

function appendRaw(
  setRawLog: Dispatch<SetStateAction<string[]>>,
  cmd: string,
  raw: string,
) {
  setRawLog((prev) => [...prev, `> ${cmd}\n${(raw || '').trim() || '(пусто)'}`]);
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
  tapHint: { color: '#6B7280', fontSize: 11, marginTop: 4 },
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
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  dtcRow: {
    backgroundColor: '#2A2F36',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F87171',
  },
  dtcCode: {
    color: '#F87171',
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dtcDesc: { color: '#C5C8CE', marginTop: 4, fontSize: 13 },
  mono: {
    fontFamily: 'monospace',
    color: '#C5C8CE',
    fontSize: 11,
    backgroundColor: '#12151A',
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  monoSmall: {
    fontFamily: 'monospace',
    color: '#9AA0A6',
    fontSize: 11,
    marginTop: 6,
  },
  footer: { marginTop: 24 },
  footerText: { color: '#6B7280', fontSize: 12, lineHeight: 17 },
});
