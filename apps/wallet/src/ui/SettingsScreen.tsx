import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { TransferProblem, describeImport, type ImportOutcome } from "../settings/transfer";
import { Button, Card, CardTitle, Header, Hint, NavRow, Problem, Screen } from "./kit";

const EXPORT_FAILED = "The data could not be exported.";
const IMPORT_FAILED = "The file could not be imported.";

interface SettingsScreenProps {
  /** How many payees the device holds. */
  payeeCount: number;
  /** The active payee's name, or null while there is none. */
  activeName: string | null;
  onPayees: () => void;
  /** Hands the data file to the share sheet. Rejects when it could not be written or shared. */
  onExport: () => Promise<void>;
  /** Why an export is refused right now, or null. */
  exportProblem: string | null;
  /**
   * Reads a data file the user picks. Resolves null when none was picked and
   * rejects with a message when the file could not be read or merged.
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
  onExport,
  exportProblem,
  onImport,
  onBack,
}: SettingsScreenProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; problem: boolean } | null>(null);
  const busy = exporting || importing;

  const runExport = async () => {
    setExporting(true);
    setNotice(null);
    try {
      await onExport();
    } catch {
      setNotice({ text: EXPORT_FAILED, problem: true });
    } finally {
      setExporting(false);
    }
  };
  const runImport = async () => {
    setImporting(true);
    setNotice(null);
    try {
      const outcome = await onImport();
      if (outcome !== null) {
        setNotice({ text: describeImport(outcome), problem: outcome.historyFailed });
      }
    } catch (error) {
      // Only a message written for the user is shown as it is; anything from
      // the platform is summed up.
      setNotice({
        text: error instanceof TransferProblem ? error.message : IMPORT_FAILED,
        problem: true,
      });
    } finally {
      setImporting(false);
    }
  };
  // A stored payee can lack a name, so the count stands in for one.
  const name = activeName === null || activeName === "" ? null : activeName;
  const payeeDetail =
    payeeCount === 0
      ? "None yet"
      : name === null
        ? `${payeeCount}`
        : payeeCount === 1
          ? name
          : `${name} and ${payeeCount - 1} more`;

  return (
    <Screen>
      <Header title="Settings" back={{ label: "Request", onPress: onBack }} />

      <Card>
        <NavRow label="Payees" detail={payeeDetail} onPress={onPayees} />
        <Hint>Who requests are paid to. Held on this device only.</Hint>
      </Card>

      <Card>
        <CardTitle>Your data</CardTitle>
        <Hint>
          The payees and the kept requests, as one file. Export hands it to the share sheet;
          import adds what a file holds to what is here, and replaces nothing.
        </Hint>
        <View style={styles.actions}>
          <Button
            label="Export to a file"
            variant="secondary"
            busy={exporting}
            disabled={busy || exportProblem !== null}
            onPress={() => {
              void runExport();
            }}
          />
          <Button
            label="Import from a file"
            variant="secondary"
            busy={importing}
            disabled={busy}
            onPress={() => {
              void runImport();
            }}
          />
        </View>
        {exportProblem === null ? null : <Problem>{exportProblem}</Problem>}
        {notice === null ? null : notice.problem ? (
          <Problem>{notice.text}</Problem>
        ) : (
          <Hint>{notice.text}</Hint>
        )}
      </Card>

      <Card tone="soft">
        <CardTitle>About</CardTitle>
        <Hint>
          Euvena is a reference wallet for EPC069-12 payment codes. It has no accounts and no
          backend, and it never moves money: a request is handed to your banking app.
        </Hint>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 10,
  },
});
