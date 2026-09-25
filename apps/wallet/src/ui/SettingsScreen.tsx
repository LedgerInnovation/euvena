import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { LANGUAGES, LANGUAGE_NAMES, type Language , type TransferRefusal } from "../i18n";
import { useStrings } from "../i18n/context";
import { APPEARANCES, type Appearance, type Preferences } from "../settings/preferences";
import { TransferProblem, describeImport, type ImportOutcome } from "../settings/transfer";
import {
  Button,
  Card,
  CardTitle,
  ChoiceRows,
  Header,
  Hint,
  NavRow,
  Problem,
  Screen,
  Segmented,
} from "./kit";

interface SettingsScreenProps {
  /** How many payees the device holds. */
  payeeCount: number;
  /** The active payee's name, or null while there is none. */
  activeName: string | null;
  onPayees: () => void;
  preferences: Preferences;
  /** The language the device would pick, named for the choice that follows it. */
  deviceLanguage: Language;
  /** Rejects when the preference could not be written. */
  onAppearance: (appearance: Appearance) => Promise<void>;
  onLanguage: (language: Language | null) => Promise<void>;
  /** Hands the data file to the share sheet. Rejects when it could not be written or shared. */
  onExport: () => Promise<void>;
  /** Whether an export is refused right now, because a read failed. */
  exportBlocked: boolean;
  /**
   * Reads a data file the user picks. Resolves null when none was picked and
   * rejects when the file could not be read or merged.
   */
  onImport: () => Promise<ImportOutcome | null>;
  onBack: () => void;
}

/**
 * Everything that is set once and kept. The request screen stays free of it;
 * settings that come later get a row here rather than a card there.
 */
export function SettingsScreen({
  payeeCount,
  activeName,
  onPayees,
  preferences,
  deviceLanguage,
  onAppearance,
  onLanguage,
  onExport,
  exportBlocked,
  onImport,
  onBack,
}: SettingsScreenProps) {
  const strings = useStrings();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // What happened is kept, and worded when shown, so a language switch
  // re-words it.
  const [notice, setNotice] = useState<
    | { kind: "outcome"; outcome: ImportOutcome }
    | { kind: "refusal"; refusal: TransferRefusal }
    | { kind: "exportFailed" }
    | { kind: "importFailed" }
    | null
  >(null);
  const [preferenceFailed, setPreferenceFailed] = useState(false);
  const busy = exporting || importing;

  // A stored payee can lack a name, so the count stands in for one.
  const name = activeName === null || activeName === "" ? null : activeName;
  const payeeDetail =
    payeeCount === 0
      ? strings.settings.none
      : name === null
        ? `${payeeCount}`
        : payeeCount === 1
          ? name
          : strings.settings.andMore(name, payeeCount - 1);

  const appearances = APPEARANCES.map((key) => ({ key, label: strings.settings[key] }));
  const languages: { key: Language | "device"; label: string }[] = [
    { key: "device", label: strings.settings.deviceLanguage(LANGUAGE_NAMES[deviceLanguage]) },
    ...LANGUAGES.map((key) => ({ key, label: LANGUAGE_NAMES[key] })),
  ];

  const prefer = async (write: Promise<void>) => {
    setPreferenceFailed(false);
    try {
      await write;
    } catch {
      setPreferenceFailed(true);
    }
  };
  const runExport = async () => {
    setExporting(true);
    setNotice(null);
    try {
      await onExport();
    } catch {
      setNotice({ kind: "exportFailed" });
    } finally {
      setExporting(false);
    }
  };
  const runImport = async () => {
    setImporting(true);
    setNotice(null);
    try {
      const outcome = await onImport();
      if (outcome !== null) setNotice({ kind: "outcome", outcome });
    } catch (error) {
      // Only a refusal the wallet knows is named; anything from the platform
      // is summed up.
      setNotice(
        error instanceof TransferProblem
          ? { kind: "refusal", refusal: error.refusal }
          : { kind: "importFailed" },
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen>
      <Header title={strings.settings.title} back={{ label: strings.tabs.request, onPress: onBack }} />

      <Card>
        <NavRow label={strings.settings.payees} detail={payeeDetail} onPress={onPayees} />
        <Hint>{strings.settings.payeesHint}</Hint>
      </Card>

      <Card>
        <CardTitle>{strings.settings.appearance}</CardTitle>
        <Segmented
          options={appearances}
          value={preferences.appearance}
          onChange={(appearance) => {
            void prefer(onAppearance(appearance));
          }}
        />
        <CardTitle>{strings.settings.language}</CardTitle>
        <ChoiceRows
          options={languages}
          value={preferences.language ?? "device"}
          onChange={(key) => {
            void prefer(onLanguage(key === "device" ? null : key));
          }}
        />
        {preferenceFailed ? <Problem>{strings.settings.preferenceFailed}</Problem> : null}
      </Card>

      <Card>
        <CardTitle>{strings.settings.yourData}</CardTitle>
        <Hint>{strings.settings.yourDataHint}</Hint>
        <View style={styles.actions}>
          <Button
            label={strings.settings.exportAction}
            variant="secondary"
            busy={exporting}
            disabled={busy || exportBlocked}
            onPress={() => {
              void runExport();
            }}
          />
          <Button
            label={strings.settings.importAction}
            variant="secondary"
            busy={importing}
            disabled={busy}
            onPress={() => {
              void runImport();
            }}
          />
        </View>
        {exportBlocked ? <Problem>{strings.settings.exportBlocked}</Problem> : null}
        {notice === null ? null : notice.kind === "outcome" && !notice.outcome.historyFailed ? (
          <Hint>{describeImport(notice.outcome, strings)}</Hint>
        ) : (
          <Problem>
            {notice.kind === "outcome"
              ? describeImport(notice.outcome, strings)
              : notice.kind === "refusal"
                ? strings.settings.refusals[notice.refusal]
                : notice.kind === "exportFailed"
                  ? strings.settings.exportFailed
                  : strings.settings.importFailed}
          </Problem>
        )}
      </Card>

      <Card tone="soft">
        <CardTitle>{strings.settings.about}</CardTitle>
        <Hint>{strings.settings.aboutText}</Hint>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 10,
  },
});
