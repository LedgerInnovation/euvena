import { useEffect, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";

import {
  EMPTY_POI_PROFILE,
  normalizePoiProfile,
  poiProfileIssues,
  type PoiProfile,
  type PoiProfileField,
} from "../epc/poi";
import { type Dictionary } from "../i18n";
import { useStrings } from "../i18n/context";
import { Button, Card, Field, Header, Hint, Input, Problem, Screen } from "./kit";

interface PoiScreenProps {
  /** The profile in force, or null while EN 18184 codes are off. */
  profile: PoiProfile | null;
  /** Saves a profile, or null to turn the codes off. Rejects on a failed write. */
  onSave: (profile: PoiProfile | null) => Promise<void>;
  onCancel: () => void;
}

/**
 * Sets up the EN 18184 profile: the framework domain, the provider ID and the
 * issuer ID a code carries. None of the three can be derived or looked up, so
 * the form explains where they come from and the encoder decides what saves.
 */
export function PoiScreen({ profile, onSave, onCancel }: PoiScreenProps) {
  const strings = useStrings();
  const [draft, setDraft] = useState<PoiProfile>(profile ?? EMPTY_POI_PROFILE);
  // Which write is running, so each button shows its own progress.
  const [writing, setWriting] = useState<"save" | "off" | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = writing !== null;
  // The system back on Android is Cancel, and like Cancel it waits while a
  // write runs.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busy) onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [busy, onCancel]);

  const normalized = normalizePoiProfile(draft);
  const issues = poiProfileIssues(draft);
  // Empty fields disable Save without an error: an empty form is a state.
  const error = (field: PoiProfileField) =>
    normalized[field] !== "" && issues.includes(field) ? shapeOf(field, strings) : undefined;

  const write = async (kind: "save" | "off") => {
    setWriting(kind);
    setFailed(false);
    try {
      await onSave(kind === "save" ? normalized : null);
    } catch {
      setFailed(true);
    } finally {
      setWriting(null);
    }
  };

  return (
    <Screen>
      <Header
        title={strings.poi.title}
        subtitle={strings.poi.subtitle}
        action={{ label: strings.common.cancel, onPress: onCancel, disabled: busy }}
      />

      <Card>
        <Hint>{strings.poi.explainer}</Hint>
        <Field label={strings.poi.domain} error={error("domain")}>
          <Input
            value={draft.domain}
            onChangeText={(domain) => setDraft({ ...draft, domain })}
            placeholder={strings.poi.domainPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>
        <Field label={strings.poi.providerId} error={error("providerId")}>
          <Input
            value={draft.providerId}
            onChangeText={(providerId) => setDraft({ ...draft, providerId })}
            placeholder={strings.poi.providerPlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />
        </Field>
        <Field label={strings.poi.issuer} error={error("issuer")}>
          <Input
            value={draft.issuer}
            onChangeText={(issuer) => setDraft({ ...draft, issuer })}
            placeholder={strings.poi.issuerPlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />
        </Field>
      </Card>

      {failed ? (
        <Card tone="danger">
          <Problem>{strings.poi.saveFailed}</Problem>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={writing === "save" ? strings.common.saving : strings.common.save}
          disabled={issues.length > 0 || writing === "off"}
          busy={writing === "save"}
          onPress={() => {
            void write("save");
          }}
        />
        {profile === null ? null : (
          <Button
            label={writing === "off" ? strings.poi.turningOff : strings.poi.turnOff}
            variant="ghost"
            disabled={writing === "save"}
            busy={writing === "off"}
            onPress={() => {
              void write("off");
            }}
          />
        )}
      </View>
    </Screen>
  );
}

function shapeOf(field: PoiProfileField, strings: Dictionary): string {
  switch (field) {
    case "domain":
      return strings.poi.domainShape;
    case "providerId":
      return strings.poi.providerShape;
    case "issuer":
      return strings.poi.issuerShape;
  }
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
  },
});
