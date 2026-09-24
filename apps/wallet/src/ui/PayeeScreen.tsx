import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { formatIbanForDisplay, normalizePayee, validatePayee, type Payee } from "../epc/request";
import { Button, Card, Field, Header, Hint, Input, Problem, Screen } from "./kit";

interface PayeeScreenProps {
  payee: Payee;
  /** Rejects when the settings could not be written to the device. */
  onSave: (payee: Payee) => Promise<void>;
  onCancel: () => void;
  notice?: string | null;
}

const SAVE_FAILED = "Settings could not be saved to this device. Nothing was stored.";

/**
 * Edits the beneficiary details the request codes are built from.
 *
 * These are settings on the device, not an account: nothing is registered
 * anywhere and no interface is called to verify them.
 */
export function PayeeScreen({ payee, onSave, onCancel, notice = null }: PayeeScreenProps) {
  const [draft, setDraft] = useState<Payee>(payee);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // The encoder decides what can be saved, so nothing that saves can fail to
  // encode on the request screen. Empty fields disable Save without shouting.
  const normalized = normalizePayee(draft);
  const issues = validatePayee(draft);
  const complete = Object.keys(issues).length === 0;
  // A required BIC is reported on an empty field, since emptiness is the problem.
  const nameError = normalized.name === "" ? undefined : issues.name;
  const ibanError = normalized.iban === "" ? undefined : issues.iban;
  const bicError = issues.bic;

  // The draft is kept on failure so a full retype is never the cost of a failed write.
  const submit = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(normalized);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header
        title="Payee settings"
        subtitle="Held on this device only. The wallet has no accounts and no backend and never routes funds."
        action={{ label: "Cancel", onPress: onCancel, disabled: saving }}
      />

      {notice === null ? null : (
        <Card tone="danger">
          <Problem>{notice}</Problem>
        </Card>
      )}

      <Card>
        <Field label="Name" error={nameError}>
          <Input
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder="Beneficiary name, up to 70 characters"
            autoCorrect={false}
            textContentType="name"
          />
        </Field>

        <Field
          label="IBAN"
          error={ibanError}
          hint={normalized.iban === "" ? undefined : formatIbanForDisplay(normalized.iban)}
        >
          <Input
            value={draft.iban}
            onChangeText={(value) => setDraft({ ...draft, iban: value })}
            placeholder="DE33 1002 0500 0001 1947 00"
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </Field>

        <Field label="BIC" error={bicError}>
          <Input
            value={draft.bic}
            onChangeText={(bic) => setDraft({ ...draft, bic })}
            placeholder="Optional inside the EEA"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {/* Outside the error slot, so the rule stays readable under an error. */}
          <Hint>
            Version 002 codes leave the BIC out for EEA beneficiaries. It stays mandatory for
            accounts in SEPA countries outside the EEA.
          </Hint>
        </Field>
      </Card>

      {saveFailed ? (
        <Card tone="danger">
          <Problem>{SAVE_FAILED}</Problem>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={saving ? "Saving" : "Save"}
          disabled={!complete}
          busy={saving}
          onPress={() => {
            void submit();
          }}
        />
        <Hint center>Nothing is sent anywhere. The details only go into the codes you build.</Hint>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
  },
});
