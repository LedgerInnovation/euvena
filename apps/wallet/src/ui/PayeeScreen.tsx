import { useEffect, useState } from "react";
import { Alert, BackHandler, StyleSheet, View } from "react-native";

import {
  EMPTY_PAYEE,
  formatIbanForDisplay,
  normalizePayee,
  validatePayee,
  type Payee,
} from "../epc/request";
import { useStrings } from "../i18n/context";
import { Button, Card, Field, Header, Hint, Input, Problem, Screen } from "./kit";

interface PayeeScreenProps {
  /** The payee being edited, or none for a new one. */
  payee?: Payee | undefined;
  /** Rejects when the settings could not be written to the device. */
  onSave: (payee: Payee) => Promise<void>;
  /** Drops the payee being edited. Absent for a new one. Rejects on a failed write. */
  onRemove?: (() => Promise<void>) | undefined;
  onCancel: () => void;
  notice?: string | null;
}

/**
 * Edits the beneficiary details the request codes are built from.
 *
 * These are settings on the device, not an account: nothing is registered
 * anywhere and no interface is called to verify them.
 */
export function PayeeScreen({
  payee,
  onSave,
  onRemove,
  onCancel,
  notice = null,
}: PayeeScreenProps) {
  const strings = useStrings();
  const [draft, setDraft] = useState<Payee>(payee ?? EMPTY_PAYEE);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const busy = saving || removing;
  // The system back on Android is Cancel, and like Cancel it waits while a
  // write runs: leaving then would hide the outcome of the write.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busy) onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [busy, onCancel]);

  // The encoder decides what can be saved, so nothing that saves can fail to
  // encode on the request screen. Empty fields disable Save without shouting.
  const normalized = normalizePayee(draft);
  const issues = validatePayee(draft, strings);
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

  const remove = async () => {
    if (onRemove === undefined) return;
    // An IBAN typed by hand has no backup, so removal asks first.
    const confirmed = await new Promise<boolean>((resolve) =>
      Alert.alert(strings.payee.removeAsk, strings.payee.removeAskDetail, [
        { text: strings.payee.keep, style: "cancel", onPress: () => resolve(false) },
        { text: strings.payee.removeConfirm, style: "destructive", onPress: () => resolve(true) },
      ]),
    );
    if (!confirmed) return;
    setRemoving(true);
    setRemoveFailed(false);
    try {
      await onRemove();
    } catch {
      setRemoveFailed(true);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Screen>
      <Header
        title={payee === undefined ? strings.payee.addTitle : strings.payee.editTitle}
        subtitle={strings.payee.subtitle}
        action={{ label: strings.common.cancel, onPress: onCancel, disabled: busy }}
      />

      {notice === null ? null : (
        <Card tone="danger">
          <Problem>{notice}</Problem>
        </Card>
      )}

      <Card>
        <Field label={strings.payee.name} error={nameError}>
          <Input
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            placeholder={strings.payee.namePlaceholder}
            autoCorrect={false}
            textContentType="name"
          />
        </Field>

        <Field
          label={strings.payee.iban}
          error={ibanError}
          hint={normalized.iban === "" ? undefined : formatIbanForDisplay(normalized.iban)}
        >
          <Input
            value={draft.iban}
            onChangeText={(value) => setDraft({ ...draft, iban: value })}
            placeholder={strings.payee.ibanPlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </Field>

        <Field label={strings.payee.bic} error={bicError}>
          <Input
            value={draft.bic}
            onChangeText={(bic) => setDraft({ ...draft, bic })}
            placeholder={strings.payee.bicPlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {/* Outside the error slot, so the rule stays readable under an error. */}
          <Hint>{strings.common.bicRule}</Hint>
        </Field>
      </Card>

      {saveFailed ? (
        <Card tone="danger">
          <Problem>{strings.payee.saveFailed}</Problem>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={saving ? strings.common.saving : strings.common.save}
          disabled={!complete || removing}
          busy={saving}
          onPress={() => {
            void submit();
          }}
        />
        <Hint center>{strings.payee.nothingSent}</Hint>
        {onRemove === undefined ? null : (
          <>
            <Button
              label={removing ? strings.payee.removing : strings.payee.remove}
              variant="ghost"
              disabled={saving}
              busy={removing}
              onPress={() => {
                void remove();
              }}
            />
            {removeFailed ? <Problem>{strings.payee.removeFailed}</Problem> : null}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
  },
});
