import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatIbanForDisplay } from "../epc/request";
import { useStrings } from "../i18n/context";
import { PAYEE_LIMIT, type PayeeBook } from "../settings/payee";
import { Button, Card, Header, Hint, Problem, Screen, TextAction } from "./kit";
import { useTheme } from "./theme";

interface PayeesScreenProps {
  book: PayeeBook;
  /** Makes a payee the one requests are built for. Rejects when it could not be saved. */
  onUse: (index: number) => Promise<void>;
  onEdit: (index: number) => void;
  onAdd: () => void;
  /** Where the list was opened from, named on the back link. */
  from: string;
  onBack: () => void;
}

/**
 * The payees on the device, with the active one marked. Requests are built
 * for the active payee; the others are a tap away, so requesting into a
 * personal account and a club account does not mean retyping an IBAN.
 */
export function PayeesScreen({ book, onUse, onEdit, onAdd, from, onBack }: PayeesScreenProps) {
  const [useFailedAt, setUseFailedAt] = useState<number | null>(null);
  const theme = useTheme();
  const strings = useStrings();
  const full = book.payees.length >= PAYEE_LIMIT;

  const use = async (index: number) => {
    setUseFailedAt(null);
    try {
      await onUse(index);
    } catch {
      setUseFailedAt(index);
    }
  };

  return (
    <Screen>
      <Header
        title={strings.payees.title}
        subtitle={strings.payees.subtitle}
        back={{ label: from, onPress: onBack }}
      />

      {book.payees.map((payee, index) => {
        const active = index === book.active;
        return (
          <Card key={index} tone={active ? "soft" : "surface"}>
            <View style={styles.row}>
              <View style={styles.text}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {payee.name}
                </Text>
                <Hint>{formatIbanForDisplay(payee.iban)}</Hint>
                {active ? (
                  <Text style={[styles.active, { color: theme.link }]}>{strings.payees.active}</Text>
                ) : null}
              </View>
              <View style={styles.actions}>
                {active ? null : (
                  <TextAction
                    label={strings.payees.use}
                    onPress={() => {
                      void use(index);
                    }}
                    accessibilityLabel={strings.payees.useA11y(payee.name)}
                  />
                )}
                <TextAction
                  label={strings.payees.edit}
                  onPress={() => onEdit(index)}
                  accessibilityLabel={strings.payees.editA11y(payee.name)}
                />
              </View>
            </View>
            {useFailedAt === index ? <Problem>{strings.payees.useFailed}</Problem> : null}
          </Card>
        );
      })}

      <View style={styles.add}>
        <Button label={strings.payees.add} variant="secondary" onPress={onAdd} disabled={full} />
        {full ? <Hint center>{strings.payees.limit(PAYEE_LIMIT)}</Hint> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 17,
    fontWeight: "600",
  },
  active: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  actions: {
    flexDirection: "row",
    gap: 16,
  },
  add: {
    gap: 8,
  },
});
