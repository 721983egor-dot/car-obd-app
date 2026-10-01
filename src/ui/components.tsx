import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from './theme';
import type { DueStatus } from '../garage/types';

export function Btn({
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

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  optional,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: TextInputProps['keyboardType'];
  multiline?: boolean;
  optional?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {optional ? <Text style={styles.optional}> · необяз.</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMulti]}
      />
    </View>
  );
}

export function StatusDot({ status }: { status: DueStatus }) {
  const tone =
    status === 'overdue'
      ? colors.danger
      : status === 'soon'
        ? colors.accent
        : status === 'ok'
          ? colors.success
          : colors.textDim;
  return <View style={[styles.dot, { backgroundColor: tone }]} />;
}

export function DueBadge({ text, status }: { text: string; status: DueStatus }) {
  const wrap =
    status === 'overdue'
      ? styles.badgeOverdue
      : status === 'soon'
        ? styles.badgeSoon
        : status === 'ok'
          ? styles.badgeOk
          : styles.badgeUnknown;
  const txt =
    status === 'overdue'
      ? styles.badgeTextOverdue
      : status === 'soon'
        ? styles.badgeTextSoon
        : status === 'ok'
          ? styles.badgeTextOk
          : styles.badgeTextUnknown;
  return (
    <View style={[styles.badge, wrap]}>
      <Text style={[styles.badgeText, txt]}>{text}</Text>
    </View>
  );
}

export function ScreenHeader({
  brand,
  title,
  right,
  onBack,
}: {
  brand?: string;
  title: string;
  right?: import('react').ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </Pressable>
        ) : null}
        <View>
          {brand ? <Text style={styles.brand}>{brand}</Text> : null}
          <Text style={[styles.title, brand ? styles.titleUnderBrand : null]}>{title}</Text>
        </View>
      </View>
      {right ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  field: { gap: 6 },
  fieldLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  optional: { color: colors.textDim, fontWeight: '400' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 16,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeSoon: { backgroundColor: colors.accentSoft, borderColor: colors.accentDim },
  badgeOverdue: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
  badgeOk: { backgroundColor: colors.successSoft, borderColor: colors.success },
  badgeUnknown: { backgroundColor: colors.monoBg, borderColor: colors.border },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextSoon: { color: colors.accent },
  badgeTextOverdue: { color: colors.danger },
  badgeTextOk: { color: colors.ok },
  badgeTextUnknown: { color: colors.textMuted },
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  backBtn: { paddingRight: 2, paddingVertical: 4 },
  backText: { color: colors.accent, fontSize: 22, fontWeight: '600' },
  brand: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 3,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  titleUnderBrand: { color: colors.textMuted, fontSize: 14, fontWeight: '500', marginTop: 2 },
});
