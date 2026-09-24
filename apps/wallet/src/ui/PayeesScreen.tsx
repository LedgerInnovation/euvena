import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatIbanForDisplay } from "../epc/request";
import { PAYEE_LIMIT, type PayeeBook } from "../settings/payee";
import { Button, Card, Header, Hint, Problem, Screen, TextAction } from "./kit";
import { useTheme } from "./theme";

const USE_FAILED = "The choice could not be saved to this device.";

interface PayeesScreenProps {
  book: PayeeBook;
  /** Makes a payee the one requests are built for. Rejects when it could not be saved. */
  onUse: (index: number) => Promise<void>;
  onEdit: (index: number) => void;
  onAdd: () => void;
  onBack: () => void;
}

/**
 * The payees on the device, with the active one marked. Requests are built
 * for the active payee; the others are a tap away, so requesting into a
 * personal account and a club account does not mean retyping an IBAN.
 */
export function PayeesScreen({ book, onUse, onEdit, onAdd, onBack }: PayeesScreenProps) {
  const [useFailedAt, setUseFailedAt] = useState<number | null>(null);
  const theme = useTheme();
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
        title="Payees"
        subtitle="Requests are built for the active payee. All of them stay on this device."
        action={{ label: "Request money", onPress: onBack }}
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
                {active ? <Text style={[styles.active, { color: theme.link }]}>Active</Text> : null}
              </View>
              <View style={styles.actions}>
                {active ? null : (
                  <TextAction
                    label="Use"
                    onPress={() => {
                      void use(index);
                    }}
                    accessibilityLabel={`Build requests for ${payee.name}`}
                  />
                )}
                <TextAction
                  label="Edit"
                  onPress={() => onEdit(index)}
                  accessibilityLabel={`Edit ${payee.name}`}
                />
              </View>
            </View>
            {useFailedAt === index ? <Problem>{USE_FAILED}</Problem> : null}
          </Card>
        );
      })}

      <View style={styles.add}>
        <Button label="Add a payee" variant="secondary" onPress={onAdd} disabled={full} />
        {full ? <Hint center>The wallet holds up to {PAYEE_LIMIT} payees.</Hint> : null}
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
