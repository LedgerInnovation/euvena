import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  EMPTY_FORM,
  buildPaymentRequest,
  formatIbanForDisplay,
  validatePayee,
  type Payee,
  type RemittanceKind,
  type RequestForm,
} from "../epc/request";
import { type Dictionary } from "../i18n";
import { useStrings } from "../i18n/context";
import { ComposedRequest } from "./ComposedRequest";
import {
  Button,
  Card,
  CardTitle,
  Field,
  Header,
  Hint,
  Input,
  Problem,
  Screen,
  Segmented,
  SectionLabel,
  TextAction,
} from "./kit";
import { useTheme } from "./theme";

interface RequestScreenProps {
  /** The active payee, or empty fields while there is none. */
  payee: Payee;
  /** How many payees the device holds, which decides what the payee card offers. */
  payeeCount: number;
  onEditPayee: () => void;
  /** Opens the form on the active payee, for one that is present but does not encode. */
  onRepairPayee: () => void;
  onSettings: () => void;
  /** Keeps a composed request in the history. Rejects when it could not be written. */
  onKeep: (payload: string) => Promise<void>;
}

/** Issues the request builder reports against the payee rather than the form. */
const PAYEE_ELEMENTS: ReadonlySet<string> = new Set(["name", "iban", "bic"]);

/**
 * Composes a payment request and renders it as an EPC069-12 QR code.
 *
 * The values printed below the code are decoded back out of the payload rather
 * than read from the form, so what the payer reads is what a scanner reads. The
 * guidelines recommend showing them in an invoice-style presentation next to
 * the code, which also gives the payer a way to check the code before scanning.
 */
export function RequestScreen({
  payee,
  payeeCount,
  onEditPayee,
  onRepairPayee,
  onSettings,
  onKeep,
}: RequestScreenProps) {
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  // The remittance fields stay folded until wanted, so a plain amount request
  // is one field. A draft that already has text keeps them open.
  const [remittanceOpen, setRemittanceOpen] = useState(false);
  const showRemittance = remittanceOpen || form.remittance !== "";
  const theme = useTheme();
  const strings = useStrings();

  const payeeIssues = validatePayee(payee, strings);
  const payeeReady = Object.keys(payeeIssues).length === 0;
  // Stored settings are not validated when read, so a payee written under
  // older rules can be present and still not encode. That is a problem to
  // name, not a first run.
  const payeeEmpty = payee.name === "" && payee.iban === "";
  const request = useMemo(
    () => buildPaymentRequest(payee, form, strings),
    [payee, form, strings],
  );
  // Payee problems are what the set-up card is for, so only form problems are
  // listed under the form.
  const formIssues = request.ok
    ? []
    : request.issues.filter((issue) => !PAYEE_ELEMENTS.has(issue.element));

  const remittanceKinds: { key: RemittanceKind; label: string }[] = [
    { key: "text", label: strings.request.kindText },
    { key: "reference", label: strings.request.kindReference },
  ];
  const reference = form.remittanceKind === "reference";

  return (
    <Screen>
      <Header
        title={strings.request.title}
        action={{ label: strings.request.settings, icon: "settings-outline", onPress: onSettings }}
      />

      {payeeReady ? (
        <Card>
          <View style={styles.payeeRow}>
            <View style={styles.payeeText}>
              <SectionLabel>{strings.request.paidTo}</SectionLabel>
              <Text style={[styles.payeeName, { color: theme.text }]} numberOfLines={1}>
                {payee.name}
              </Text>
              <Hint>{formatIbanForDisplay(payee.iban)}</Hint>
            </View>
            <TextAction
              label={payeeCount > 1 ? strings.request.switchPayee : strings.request.changePayee}
              onPress={onEditPayee}
              accessibilityLabel={
                payeeCount > 1 ? strings.request.switchPayeeA11y : strings.request.changePayeeA11y
              }
            />
          </View>
        </Card>
      ) : payeeEmpty ? (
        <Card tone="soft">
          <CardTitle>{strings.request.whoGetsPaid}</CardTitle>
          <Hint>{strings.request.whoGetsPaidHint}</Hint>
          <Button label={strings.request.addNameAndIban} onPress={onEditPayee} />
        </Card>
      ) : (
        <Card tone="danger">
          <CardTitle>{strings.request.checkPayee}</CardTitle>
          {Object.entries(payeeIssues).map(([field, message]) => (
            <Problem key={field}>
              {payeeFieldLabel(field, strings)}: {message}
            </Problem>
          ))}
          <Button label={strings.request.openPayeeSettings} onPress={onRepairPayee} />
        </Card>
      )}

      <Card>
        <Field label={strings.request.amountLabel}>
          <AmountInput
            value={form.amount}
            onChangeText={(amount) => setForm({ ...form, amount })}
          />
        </Field>

        {showRemittance ? (
          <Field
            label={strings.request.purposeLabel}
            hint={reference ? strings.request.referenceHint : strings.request.textHint}
          >
            <Segmented
              options={remittanceKinds}
              value={form.remittanceKind}
              onChange={(kind) => setForm({ ...form, remittanceKind: kind })}
            />
            <Input
              value={form.remittance}
              onChangeText={(remittance) => setForm({ ...form, remittance })}
              placeholder={
                reference ? strings.request.referencePlaceholder : strings.request.textPlaceholder
              }
              multiline
              autoCapitalize={reference ? "characters" : "sentences"}
              autoCorrect={false}
            />
          </Field>
        ) : (
          <TextAction
            label={strings.request.addPurpose}
            onPress={() => setRemittanceOpen(true)}
            accessibilityLabel={strings.request.addPurposeA11y}
          />
        )}

        {formIssues.length === 0 ? null : (
          <View style={styles.issues}>
            {formIssues.map((issue) => (
              <Problem key={`${issue.element}:${issue.message}`}>{issue.message}</Problem>
            ))}
          </View>
        )}
      </Card>

      {request.ok ? (
        <ComposedRequest payload={request.payload} data={request.data} onKeep={onKeep} compact />
      ) : null}
    </Screen>
  );
}

/** The payee field a problem is listed under, named as the rows name it. */
function payeeFieldLabel(field: string, strings: Dictionary): string {
  switch (field) {
    case "name":
      return strings.rows.payee;
    case "iban":
      return strings.rows.iban;
    case "bic":
      return strings.rows.bic;
    default:
      return field;
  }
}

/** The amount, large, with the currency sign fixed before it. */
function AmountInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const theme = useTheme();
  const strings = useStrings();
  return (
    <View style={styles.amount}>
      <Text
        style={[styles.amountSign, { color: value === "" ? theme.muted : theme.text }]}
        accessible={false}
        importantForAccessibility="no"
      >
        €
      </Text>
      <Input
        style={styles.amountInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={strings.request.payerDecides}
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoCorrect={false}
        accessibilityLabel={strings.request.amountA11y}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  payeeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  payeeText: {
    flex: 1,
    gap: 4,
  },
  payeeName: {
    fontSize: 17,
    fontWeight: "600",
  },
  amount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  amountSign: {
    fontSize: 28,
    fontWeight: "600",
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: "600",
    paddingVertical: 10,
  },
  issues: {
    gap: 4,
  },
});
