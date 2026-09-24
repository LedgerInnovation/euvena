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
  payee: Payee;
  onEditPayee: () => void;
  onScan: () => void;
  onHistory: () => void;
  /** Keeps a composed request in the history. Rejects when it could not be written. */
  onKeep: (payload: string) => Promise<void>;
}

const REMITTANCE_KINDS: {
  key: RemittanceKind;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    key: "text",
    label: "Text",
    placeholder: "What the payment is for",
    hint: "Unstructured text, up to 140 characters",
  },
  {
    key: "reference",
    label: "Reference",
    placeholder: "RF18539007547034",
    hint: "Structured creditor reference, up to 35 characters",
  },
];

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
  onEditPayee,
  onScan,
  onHistory,
  onKeep,
}: RequestScreenProps) {
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const theme = useTheme();

  const payeeIssues = validatePayee(payee);
  const payeeReady = Object.keys(payeeIssues).length === 0;
  // Stored settings are not validated when read, so a payee written under
  // older rules can be present and still not encode. That is a problem to
  // name, not a first run.
  const payeeEmpty = payee.name === "" && payee.iban === "";
  const request = useMemo(() => buildPaymentRequest(payee, form), [payee, form]);
  // Payee problems are what the set-up card is for, so only form problems are
  // listed under the form.
  const formIssues = request.ok
    ? []
    : request.issues.filter((issue) => !PAYEE_ELEMENTS.has(issue.element));

  const remittanceKind = REMITTANCE_KINDS.find((entry) => entry.key === form.remittanceKind);

  return (
    <Screen>
      <Header title="Request money" action={{ label: "History", onPress: onHistory }} />

      {payeeReady ? (
        <Card>
          <View style={styles.payeeRow}>
            <View style={styles.payeeText}>
              <SectionLabel>Paid to</SectionLabel>
              <Text style={[styles.payeeName, { color: theme.text }]} numberOfLines={1}>
                {payee.name}
              </Text>
              <Hint>{formatIbanForDisplay(payee.iban)}</Hint>
            </View>
            <TextAction label="Change" onPress={onEditPayee} accessibilityLabel="Change payee" />
          </View>
        </Card>
      ) : payeeEmpty ? (
        <Card tone="soft">
          <CardTitle>Who gets paid?</CardTitle>
          <Hint>
            Add the name and IBAN a request is paid to. They stay on this device: the wallet has
            no accounts and no backend.
          </Hint>
          <Button label="Add name and IBAN" onPress={onEditPayee} />
        </Card>
      ) : (
        <Card tone="danger">
          <CardTitle>Check the payee settings</CardTitle>
          {Object.entries(payeeIssues).map(([field, message]) => (
            <Problem key={field}>
              {field}: {message}
            </Problem>
          ))}
          <Button label="Open payee settings" onPress={onEditPayee} />
        </Card>
      )}

      <Card>
        <Field label="Amount in euro">
          <AmountInput
            value={form.amount}
            onChangeText={(amount) => setForm({ ...form, amount })}
          />
        </Field>

        <Field
          label="Remittance information"
          hint={`${remittanceKind?.hint ?? ""}. A code carries one or the other, never both.`}
        >
          <Segmented
            options={REMITTANCE_KINDS}
            value={form.remittanceKind}
            onChange={(kind) => setForm({ ...form, remittanceKind: kind })}
          />
          <Input
            value={form.remittance}
            onChangeText={(remittance) => setForm({ ...form, remittance })}
            placeholder={remittanceKind?.placeholder}
            multiline
            autoCapitalize={form.remittanceKind === "reference" ? "characters" : "sentences"}
            autoCorrect={false}
          />
        </Field>

        {formIssues.length === 0 ? null : (
          <View style={styles.issues}>
            {formIssues.map((issue) => (
              <Problem key={`${issue.element}:${issue.message}`}>
                {issue.element}: {issue.message}
              </Problem>
            ))}
          </View>
        )}
      </Card>

      {request.ok ? (
        <ComposedRequest payload={request.payload} data={request.data} onKeep={onKeep} />
      ) : null}

      <Card tone="soft">
        <CardTitle>Paying someone?</CardTitle>
        <Hint>
          Read their code or shared link. The wallet shows what it says before anything else
          happens, then hands it to your banking app.
        </Hint>
        <Button label="Scan or paste a request" variant="secondary" onPress={onScan} />
      </Card>
    </Screen>
  );
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
        placeholder="Payer decides"
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoCorrect={false}
        accessibilityLabel="Amount in euro, leave empty to let the payer decide"
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
