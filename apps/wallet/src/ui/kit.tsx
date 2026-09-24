import { useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { BRAND_BLUE, BRAND_BLUE_DEEP, BRAND_SKY, BRAND_SKY_DEEP, useTheme } from "./theme";

/**
 * The building blocks the screens are made of. Each one reads the theme
 * itself, so a screen composes them without passing colours around.
 */

/** The logo mark, drawn from the same shapes as assets/euvena.svg. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={(size * 210) / 180} viewBox="0 0 180 210" accessible={false}>
      <Defs>
        <LinearGradient id="dark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={BRAND_BLUE} />
          <Stop offset="1" stopColor={BRAND_BLUE_DEEP} />
        </LinearGradient>
        <LinearGradient id="light" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={BRAND_SKY} />
          <Stop offset="1" stopColor={BRAND_SKY_DEEP} />
        </LinearGradient>
      </Defs>
      <Rect x="22" y="22" width="46" height="46" rx="10" fill="url(#dark)" />
      <Rect x="80" y="24" width="76" height="44" rx="10" fill="url(#light)" />
      <Path
        fill="url(#dark)"
        d="M22 92A12 12 0 0 1 34 80H103A22 22 0 0 1 125 102V118A10 10 0 0 1 115 128H82A10 10 0 0 0 72 138V178A12 12 0 0 1 60 190H34A12 12 0 0 1 22 178Z"
      />
      <Rect x="82" y="140" width="74" height="46" rx="10" fill="url(#light)" />
    </Svg>
  );
}

/** A scrolling page. The page colour comes from the root, so this only lays out. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}

interface HeaderProps {
  title: string;
  subtitle?: string | undefined;
  action?: { label: string; onPress: () => void; disabled?: boolean | undefined } | undefined;
}

/** The screen title beside the logo mark, with an optional action on the right. */
export function Header({ title, subtitle, action }: HeaderProps) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitle}>
          <LogoMark size={26} />
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        </View>
        {action === undefined ? null : (
          <Pressable
            onPress={action.onPress}
            disabled={action.disabled === true}
            accessibilityRole="button"
            accessibilityState={{ disabled: action.disabled === true }}
            hitSlop={12}
          >
            {({ pressed }) => (
              <Text
                style={[
                  styles.headerAction,
                  { color: theme.link, opacity: pressed || action.disabled === true ? 0.5 : 1 },
                ]}
              >
                {action.label}
              </Text>
            )}
          </Pressable>
        )}
      </View>
      {subtitle === undefined ? null : (
        <Text style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text>
      )}
    </View>
  );
}

type CardTone = "surface" | "soft" | "danger";

interface CardProps {
  children: ReactNode;
  tone?: CardTone | undefined;
  style?: StyleProp<ViewStyle> | undefined;
}

/** A grouped block on the page. Soft cards are tinted, danger cards carry a rejection. */
export function Card({ children, tone = "surface", style }: CardProps) {
  const theme = useTheme();
  const background =
    tone === "soft" ? theme.primarySoft : tone === "danger" ? theme.dangerSoft : theme.surface;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: background, borderColor: tone === "surface" ? theme.border : background },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A heading inside a card. */
export function CardTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.cardTitle, { color: theme.text }]}>{children}</Text>;
}

/** Small capitals above a field or a group of rows. */
export function SectionLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.sectionLabel, { color: theme.muted }]}>{children}</Text>;
}

/** Body copy in the muted colour. */
export function Hint({ children, center = false }: { children: ReactNode; center?: boolean }) {
  const theme = useTheme();
  return (
    <Text style={[styles.hint, { color: theme.muted }, center ? styles.centered : null]}>
      {children}
    </Text>
  );
}

/** A problem, in the danger colour. */
export function Problem({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.problem, { color: theme.danger }]}>{children}</Text>;
}

interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string | undefined;
  error?: string | undefined;
}

/** A labelled input with its hint, or its error in place of the hint. */
export function Field({ label, children, hint, error }: FieldProps) {
  return (
    <View style={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      {children}
      {error !== undefined ? <Problem>{error}</Problem> : hint !== undefined ? <Hint>{hint}</Hint> : null}
    </View>
  );
}

/** A themed text input with a focus ring. */
export function Input({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      style={[
        styles.input,
        {
          backgroundColor: theme.well,
          borderColor: focused ? theme.focus : theme.border,
          color: theme.text,
        },
        props.multiline ? styles.multiline : null,
        style,
      ]}
      placeholderTextColor={theme.muted}
      selectionColor={theme.primary}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant | undefined;
  disabled?: boolean | undefined;
  /** Shown as disabled and announced as busy while an action runs. */
  busy?: boolean | undefined;
  accessibilityLabel?: string | undefined;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      style={({ pressed }) => [
        styles.button,
        variant === "primary"
          ? { backgroundColor: pressed ? theme.primaryPressed : theme.primary }
          : variant === "secondary"
            ? {
                backgroundColor: pressed ? theme.pressedSoft : "transparent",
                borderWidth: 1.5,
                borderColor: theme.link,
              }
            : { backgroundColor: pressed ? theme.pressedSoft : "transparent" },
        inactive ? styles.buttonInactive : null,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          { color: variant === "primary" ? theme.onPrimary : theme.link },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface SegmentedProps<K extends string> {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}

/** A choice between a few options, one always selected. */
export function Segmented<K extends string>({ options, value, onChange }: SegmentedProps<K>) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.well, borderColor: theme.border }]}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              styles.segment,
              selected ? { backgroundColor: theme.surface, borderColor: theme.border } : null,
            ]}
          >
            <Text
              style={[
                styles.segmentLabel,
                { color: selected ? theme.text : theme.muted },
                selected ? styles.segmentLabelSelected : null,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface RowItem {
  label: string;
  value: string;
  /** Rendered after the value, such as a copy action. */
  trailing?: ReactNode;
  /** Keeps a long value on one line, for rows that have a trailing action. */
  singleLine?: boolean;
}

/** Label and value pairs, one per line, divided by hairlines. */
export function Rows({ rows }: { rows: RowItem[] }) {
  const theme = useTheme();
  return (
    <View>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[
            styles.row,
            index === 0 ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
          ]}
        >
          <Text style={[styles.rowLabel, { color: theme.muted }]}>{row.label}</Text>
          <Text
            style={[styles.rowValue, { color: theme.text }]}
            {...(row.singleLine ? { numberOfLines: 1 } : {})}
          >
            {row.value}
          </Text>
          {row.trailing ?? null}
        </View>
      ))}
    </View>
  );
}

/** A small text action, such as Copy or Change, in the primary colour. */
export function TextAction({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string | undefined;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={12}
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
    >
      {({ pressed }) => (
        <Text style={[styles.textAction, { color: theme.link, opacity: pressed ? 0.6 : 1 }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  headerAction: {
    fontSize: 15,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  centered: {
    textAlign: "center",
  },
  problem: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  field: {
    gap: 8,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonInactive: {
    opacity: 0.45,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  segmented: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "transparent",
    paddingVertical: 8,
    alignItems: "center",
  },
  segmentLabel: {
    fontSize: 14,
  },
  segmentLabelSelected: {
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
  },
  rowLabel: {
    width: 88,
    fontSize: 13,
  },
  rowValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  textAction: {
    fontSize: 14,
    fontWeight: "600",
  },
});
