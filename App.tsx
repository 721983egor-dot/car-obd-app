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
import { groupPidsByCategory } from './src/ui/pidCategories';
import { colors } from './src/ui/theme';
import { readingsSync } from './src/sync/readingsSync';

type Step = 'transport' | 'scan' | 'connected' | 'results';
type ReadPhase = 'idle' | 'connect' | 'vin' | 'dtc' | 'pids' | 'done';

const TRANSPORTS: Array<{
  kind: TransportKind;
  title: string;
  badge: string;
  badgeTone: 'primary' | 'demo' | 'alt';
  hint: string;
  recommended?: boolean;
}> = [
  {
    kind: 'classic',
    title: 'Bluetooth Classic',
    badge: 'Для машины',
    badgeTone: 'primary',
    hint: 'Обычный дешёвый ELM327 (SPP). Нужен Dev Client — в Expo Go не работает.',
    recommended: true,
  },
  {
    kind: 'mock',
    title: 'Симулятор',
    badge: 'Expo Go',
    badgeTone: 'demo',
    hint: 'Без адаптера: проверка экранов, DTC и параметров. Удобно до теста в машине.',
  },
  {
    kind: 'ble',
    title: 'Bluetooth LE',
    badge: 'Редко',
    badgeTone: 'alt',
    hint: 'Только если адаптер реально BLE (FFF0/NUS). Нужен Dev Client.',
  },
];

const READ_STEPS: Array<{ id: ReadPhase; label: string }> = [
  { id: 'connect', label: 'Подключение' },
  { id: 'vin', label: 'Читаем VIN…' },
  { id: 'dtc', label: 'Читаем ошибки…' },
  { id: 'pids', label: 'Читаем параметры…' },
  { id: 'done', label: 'Готово' },
];

const PHASE_RANK: Record<ReadPhase, number> = {
  idle: 0,
  connect: 1,
  vin: 2,
  dtc: 3,
  pids: 4,
  done: 5,
};

export default function App() {
  const [step, setStep] = useState<Step>('transport');
  const [kind, setKind] = useState<TransportKind>('classic');
  const [session, setSession] = useState<ObdSession | null>(null);
  const [devices, setDevices] = useState<ObdDevice[]>([]);
  const [selected, setSelected] = useState<ObdDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Выберите, как подключаться');
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
  const [readPhase, setReadPhase] = useState<ReadPhase>('idle');

  const availability = useMemo(() => session?.availabilityNote ?? '', [session]);
  const pidGroups = useMemo(() => groupPidsByCategory(pids), [pids]);

  const highlightPids = useMemo(() => {
    const byPid = new Map(pids.map((p) => [normalizePidKey(p.pid), p]));
    return [
      byPid.get('0C'),
      byPid.get('0D'),
      byPid.get('05'),
      byPid.get('42'),
    ].filter((p): p is ParsedPidValue => Boolean(p));
  }, [pids]);

  const startWithTransport = useCallback(async (next: TransportKind) => {
    setError(null);
    setKind(next);
    const transport = createTransport(next);
    const s = new ObdSession(transport);
    setSession(s);
    setDevices([]);
    setSelected(null);
    setReadPhase('idle');
    setStatus(
      next === 'mock'
        ? 'Симулятор: нажмите «Сканировать», затем выберите устройство'
        : 'Поиск адаптера: включите Bluetooth и нажмите «Сканировать»',
    );
    setStep('scan');

    const available = await s.isAvailable();
    if (!available && next !== 'mock') {
      setError(
        'Bluetooth недоступен в Expo Go. Для живого адаптера соберите Dev Client: npx expo run:android. Пока можно вернуться и выбрать «Симулятор».',
      );
    }
  }, []);

  const scan = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setDevices([]);
    setStatus('Ищем адаптеры…');
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
        setStatus('BLE-сканирование идёт. Выберите устройство из списка.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('Не удалось просканировать');
    } finally {
      setBusy(false);
    }
  }, [session, kind]);

  const applyReadResults = useCallback(async (device: ObdDevice, s: ObdSession) => {
    setReadPhase('vin');
    setStatus('Читаем VIN…');
    const vinResult = await s.readVin();
    setVin(vinResult);
    appendRaw(setRawLog, '0902', vinResult.raw);

    setReadPhase('dtc');
    setStatus('Читаем ошибки…');
    const dtcResult = await s.readDtcs();
    setDtc(dtcResult);
    appendRaw(setRawLog, '03', dtcResult.raw);

    setReadPhase('pids');
    setStatus('Читаем параметры…');
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
    setReadPhase('done');
    setStatus('Готово. Данные с адаптера ниже.');
    setStep('results');
  }, []);

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
      setReadPhase('connect');
      setStatus(`Подключаемся к ${device.name}…`);
      try {
        await session.stopScan();
        await session.connect(device);
        await applyReadResults(device, session);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('Ошибка чтения');
        setReadPhase('idle');
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
    setReadPhase('vin');
    try {
      await applyReadResults(selected, session);
      setStatus('Готово (повторный опрос).');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('Ошибка повторного чтения');
      setReadPhase('idle');
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
      setVin(null);
      setDtc(null);
      setPids([]);
      setSupportedPids([]);
      setRawLog([]);
      setSnapshot(null);
      setQueuedId(null);
      setReadPhase('idle');
      setStep('transport');
      setStatus('Отключено. Выберите способ подключения.');
      setError(null);
    }
  }, [session]);

  const transportLabel =
    kind === 'classic' ? 'Classic' : kind === 'ble' ? 'BLE' : 'Симулятор';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>CAR</Text>
          <Text style={styles.subtitle}>OBD companion</Text>
        </View>
        {step !== 'transport' ? (
          <View style={styles.headerChip}>
            <Text style={styles.headerChipText}>{transportLabel}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <StatusBanner status={status} error={error} availability={availability} step={step} />

        {step === 'transport' && (
          <View style={styles.block}>
            <Text style={styles.sectionEyebrow}>Шаг 1</Text>
            <Text style={styles.blockTitle}>Как подключаемся?</Text>
            <Text style={styles.hint}>
              Завтра в машине — Classic + Dev Client. Сегодня без адаптера — Симулятор в Expo Go.
            </Text>
            {TRANSPORTS.map((t) => (
              <Pressable
                key={t.kind}
                style={[styles.card, t.recommended && styles.cardRecommended]}
                onPress={() => startWithTransport(t.kind)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{t.title}</Text>
                  <Badge label={t.badge} tone={t.badgeTone} />
                </View>
                <Text style={styles.cardHint}>{t.hint}</Text>
                {t.recommended ? (
                  <Text style={styles.cardCta}>Основной путь для ELM327 →</Text>
                ) : t.kind === 'mock' ? (
                  <Text style={styles.cardCtaDemo}>Открыть симулятор →</Text>
                ) : (
                  <Text style={styles.cardCtaMuted}>Выбрать BLE →</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {step === 'scan' && (
          <View style={styles.block}>
            <Text style={styles.sectionEyebrow}>Шаг 2</Text>
            <Text style={styles.blockTitle}>Поиск адаптера</Text>
            <View style={styles.row}>
              <Btn label={busy ? 'Ищем…' : 'Сканировать'} onPress={scan} disabled={busy} />
              <Btn label="Назад" onPress={disconnect} variant="ghost" disabled={busy} />
            </View>

            {busy && devices.length === 0 ? (
              <View style={styles.emptyBox}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.emptyTitle}>Сканирование</Text>
                <Text style={styles.hint}>Ждём ответ от Bluetooth…</Text>
              </View>
            ) : null}

            {!busy && devices.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>Пока пусто</Text>
                <Text style={styles.hint}>
                  {kind === 'mock'
                    ? 'Нажмите «Сканировать» — появится виртуальный адаптер.'
                    : 'Включите адаптер и телефонный Bluetooth, затем «Сканировать». Classic: устройство должно быть спарено в настройках Android.'}
                </Text>
              </View>
            ) : null}

            {devices.map((d) => (
              <Pressable
                key={d.id}
                style={styles.card}
                onPress={() => connectAndRead(d)}
                disabled={busy}
              >
                <Text style={styles.cardTitle}>{d.name}</Text>
                <Text style={styles.cardHint}>
                  {d.address ?? d.id}
                  {d.meta?.bonded ? ' · спарен' : ''}
                </Text>
                <Text style={styles.cardCta}>Подключить и прочитать →</Text>
              </Pressable>
            ))}
          </View>
        )}

        {(step === 'connected' || step === 'results') && (
          <View style={styles.block}>
            <Text style={styles.sectionEyebrow}>Шаг 3</Text>
            <Text style={styles.blockTitle}>
              Сессия{selected ? ` · ${selected.name}` : ''}
            </Text>

            {(busy || readPhase !== 'idle') && step === 'connected' ? (
              <ReadProgress phase={readPhase} />
            ) : null}

            {busy && step === 'connected' ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.hint}>{status}</Text>
              </View>
            ) : null}

            {!busy && step === 'results' && !vin && !dtc && pids.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>Нет данных</Text>
                <Text style={styles.hint}>Попробуйте «Читать снова» или смените адаптер.</Text>
              </View>
            ) : null}

            {vin && (
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>VIN</Text>
                <Text style={styles.metricValueMono}>{vin.vin ?? 'нет данных'}</Text>
                <Text style={styles.tapHint}>Mode 09 · с OBD, не расшифровка марки</Text>
                {vin.note ? <Text style={styles.hint}>{vin.note}</Text> : null}
              </View>
            )}

            {highlightPids.length > 0 ? (
              <View style={styles.highlightGrid}>
                {highlightPids.map((p) => (
                  <View key={`hi-${p.pid}`} style={styles.highlightCell}>
                    <Text style={styles.metricLabel}>{shortLabel(p)}</Text>
                    <Text style={styles.highlightValue}>
                      {formatValue(p)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {dtc && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHead}>
                  <Text style={styles.blockTitle}>Ошибки Check Engine</Text>
                  <View
                    style={[
                      styles.countChip,
                      dtc.codes.length === 0 ? styles.countChipOk : styles.countChipBad,
                    ]}
                  >
                    <Text
                      style={[
                        styles.countChipText,
                        dtc.codes.length === 0 ? styles.countChipTextOk : styles.countChipTextBad,
                      ]}
                    >
                      {dtc.codes.length === 0 ? 'чисто' : `${dtc.codes.length}`}
                    </Text>
                  </View>
                </View>
                {dtc.codes.length === 0 ? (
                  <View style={styles.emptyBoxOk}>
                    <Text style={styles.emptyTitleOk}>Активных DTC нет</Text>
                    <Text style={styles.hint}>{dtc.note ?? 'Mode 03 не вернул кодов.'}</Text>
                  </View>
                ) : (
                  dtc.codes.map((c) => <DtcRow key={c.code} item={c} />)
                )}
                {dtc.codes.length > 0 && dtc.note ? (
                  <Text style={styles.hint}>{dtc.note}</Text>
                ) : null}
              </View>
            )}

            {pids.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHead}>
                  <Text style={styles.blockTitle}>Параметры</Text>
                  <Text style={styles.countMuted}>{pids.length}</Text>
                </View>
                {supportedPids.length > 0 ? (
                  <Text style={styles.hint}>
                    ЭБУ заявил {supportedPids.length} PID · показываем разобранные
                  </Text>
                ) : null}

                {pidGroups.map(({ category, items }) => (
                  <View key={category.id} style={styles.categoryBlock}>
                    <Text style={styles.categoryTitle}>{category.title}</Text>
                    {items.map((p) => (
                      <Pressable
                        key={p.pid}
                        style={styles.paramRow}
                        onPress={() =>
                          setExpandedRawPid((cur) => (cur === p.pid ? null : p.pid))
                        }
                      >
                        <View style={styles.paramMain}>
                          <Text style={styles.paramLabel}>{p.label}</Text>
                          <Text style={styles.paramPid}>{p.pid}</Text>
                        </View>
                        <Text style={styles.paramValue}>{formatValue(p)}</Text>
                        {expandedRawPid === p.pid ? (
                          <Text style={styles.monoSmall}>{p.raw.trim() || '(пусто)'}</Text>
                        ) : (
                          <Text style={styles.tapHint}>сырой ответ</Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {rawLog.length > 0 && (
              <View style={styles.sectionBlock}>
                <Pressable onPress={() => setShowRaw((v) => !v)} style={styles.sectionHead}>
                  <Text style={styles.blockTitle}>Сырой лог</Text>
                  <Text style={styles.countMuted}>
                    {showRaw ? '▾' : '▸'} {rawLog.length}
                  </Text>
                </Pressable>
                {showRaw
                  ? rawLog.map((line, i) => (
                      <Text key={`${i}-${line.slice(0, 12)}`} style={styles.mono}>
                        {line}
                      </Text>
                    ))
                  : (
                    <Text style={styles.hint}>Нажмите, чтобы раскрыть обмен с ELM327.</Text>
                  )}
              </View>
            )}

            {snapshot && (
              <Text style={styles.hint}>
                Снимок {formatTime(snapshot.recordedAt)}
                {queuedId ? ` · sync: ${queuedId}` : ''}
              </Text>
            )}

            <View style={styles.row}>
              <Btn label="Отключить" onPress={disconnect} disabled={busy} />
              {step === 'results' && selected ? (
                <Btn
                  label="Читать снова"
                  onPress={() => reread()}
                  disabled={busy}
                  variant="ghost"
                />
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Classic SPP — основной путь для дешёвых ELM327. Expo Go = только симулятор. Живой
            адаптер: npx expo run:android. VIN с OBD ≠ марка/модель (нужны внешние справочники).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusBanner({
  status,
  error,
  availability,
  step,
}: {
  status: string;
  error: string | null;
  availability: string;
  step: Step;
}) {
  return (
    <View style={styles.statusBox}>
      <Text style={styles.status}>{status}</Text>
      {availability && step !== 'transport' ? (
        <Text style={styles.hint}>{availability}</Text>
      ) : null}
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Ошибка</Text>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ReadProgress({ phase }: { phase: ReadPhase }) {
  const current = PHASE_RANK[phase];
  return (
    <View style={styles.progressBox}>
      {READ_STEPS.filter((s) => s.id !== 'done' || phase === 'done').map((s) => {
        const rank = PHASE_RANK[s.id];
        const done = current > rank || (phase === 'done' && s.id === 'done');
        const active = phase === s.id;
        return (
          <View key={s.id} style={styles.progressRow}>
            <View
              style={[
                styles.progressDot,
                done && styles.progressDotDone,
                active && styles.progressDotActive,
              ]}
            />
            <Text
              style={[
                styles.progressLabel,
                (done || active) && styles.progressLabelActive,
              ]}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'primary' | 'demo' | 'alt';
}) {
  return (
    <View
      style={[
        styles.badge,
        tone === 'primary' && styles.badgePrimary,
        tone === 'demo' && styles.badgeDemo,
        tone === 'alt' && styles.badgeAlt,
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          tone === 'primary' && styles.badgeTextPrimary,
          tone === 'demo' && styles.badgeTextDemo,
          tone === 'alt' && styles.badgeTextAlt,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function DtcRow({ item }: { item: DtcCode }) {
  return (
    <View style={styles.dtcRow}>
      <Text style={styles.dtcCode}>{item.code}</Text>
      <Text style={styles.dtcDesc}>
        {item.descriptionRu ?? 'описание не найдено — смотрите код'}
      </Text>
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

function normalizePidKey(pid: string): string {
  const cleaned = pid.replace(/^01/i, '').toUpperCase();
  return cleaned.length === 1 ? `0${cleaned}` : cleaned.slice(-2);
}

function formatValue(p: ParsedPidValue): string {
  if (p.value === null || p.value === undefined) return '—';
  return `${p.value}${p.unit ? ` ${p.unit}` : ''}`;
}

function shortLabel(p: ParsedPidValue): string {
  const key = normalizePidKey(p.pid);
  if (key === '0C') return 'Обороты';
  if (key === '0D') return 'Скорость';
  if (key === '05') return 'ОЖ';
  if (key === '42') return 'Напряжение';
  return p.label;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
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
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 3,
  },
  subtitle: { color: colors.textMuted, marginTop: 2, fontSize: 13 },
  headerChip: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.accentDim,
  },
  headerChipText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  statusBox: { gap: 8 },
  status: { color: colors.text, fontSize: 17, fontWeight: '600', lineHeight: 22 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  tapHint: { color: colors.textDim, fontSize: 11, marginTop: 4 },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: 12,
    borderRadius: 8,
    gap: 4,
  },
  errorTitle: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  block: { gap: 10, marginTop: 4 },
  sectionBlock: { gap: 8, marginTop: 6 },
  sectionEyebrow: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  blockTitle: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  card: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  cardRecommended: {
    borderColor: colors.accent,
    backgroundColor: colors.bgElevated,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  cardHint: { color: colors.textMuted, marginTop: 2, fontSize: 13, lineHeight: 18 },
  cardCta: { color: colors.accent, marginTop: 8, fontSize: 13, fontWeight: '600' },
  cardCtaDemo: { color: colors.ok, marginTop: 8, fontSize: 13, fontWeight: '600' },
  cardCtaMuted: { color: colors.textMuted, marginTop: 8, fontSize: 13, fontWeight: '600' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgePrimary: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentDim,
  },
  badgeDemo: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  badgeAlt: {
    backgroundColor: colors.monoBg,
    borderColor: colors.border,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextPrimary: { color: colors.accent },
  badgeTextDemo: { color: colors.ok },
  badgeTextAlt: { color: colors.textMuted },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  btn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.bg, fontWeight: '700' },
  btnTextGhost: { color: colors.text },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderStyle: 'dashed',
    padding: 16,
    gap: 6,
    alignItems: 'flex-start',
  },
  emptyBoxOk: {
    backgroundColor: colors.successSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.success,
    padding: 14,
    gap: 4,
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  emptyTitleOk: { color: colors.ok, fontSize: 15, fontWeight: '600' },
  progressBox: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  progressDotDone: { backgroundColor: colors.success },
  progressDotActive: { backgroundColor: colors.accent },
  progressLabel: { color: colors.textDim, fontSize: 13 },
  progressLabelActive: { color: colors.text, fontWeight: '600' },
  metric: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  metricLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  metricValueMono: {
    color: colors.text,
    fontSize: 18,
    fontFamily: 'monospace',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  highlightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  highlightCell: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minWidth: '47%',
    flexGrow: 1,
  },
  highlightValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  countChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  countChipOk: { backgroundColor: colors.successSoft },
  countChipBad: { backgroundColor: colors.dangerSoft },
  countChipText: { fontSize: 12, fontWeight: '700' },
  countChipTextOk: { color: colors.ok },
  countChipTextBad: { color: colors.danger },
  countMuted: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  categoryBlock: { gap: 6, marginTop: 4 },
  categoryTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 2,
  },
  paramRow: {
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  paramMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  paramLabel: { color: colors.textMuted, fontSize: 13, flex: 1, lineHeight: 18 },
  paramPid: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  paramValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  dtcRow: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  dtcCode: {
    color: colors.danger,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dtcDesc: { color: '#C5C8CE', marginTop: 4, fontSize: 13, lineHeight: 18 },
  mono: {
    fontFamily: 'monospace',
    color: '#C5C8CE',
    fontSize: 11,
    backgroundColor: colors.monoBg,
    padding: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  monoSmall: {
    fontFamily: 'monospace',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  footer: { marginTop: 20 },
  footerText: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
});
