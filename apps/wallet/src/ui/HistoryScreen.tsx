import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { summarizeRequest } from "../epc/request";
import { readPaymentRequest, type ReadRequestResult } from "../epc/scan";
import { type HistoryEntry } from "../settings/history";
import { ComposedRequest } from "./ComposedRequest";
import { Button, Card, CardTitle, Header, Hint, Problem, Rows, Screen, TextAction } from "./kit";
import { useTheme } from "./theme";

const READ_FAILED_NOTICE =
  "The saved history could not be read from this device. Nothing is kept or marked until the app is restarted, so the saved list is not written over.";

const MARK_FAILED = "The mark could not be saved to this device.";

const UNREADABLE = "This entry could not be read as a payment request.";

interface HistoryScreenProps {
  entries: HistoryEntry[];
  loadFailed: boolean;
  /** Rejects when the history could not be written. */
  onMark: (id: string, done: boolean) => Promise<void>;
  onBack: () => void;
}

/**
 * The kept requests, newest first, each shown by decoding its payload again.
 *
 * A kept request is re-opened as the same code and share action the request
 * screen showed when it was built. The done mark is the payee's own
 * bookkeeping: the wallet never learns whether anything was paid.
 */
export function HistoryScreen({ entries, loadFailed, onMark, onBack }: HistoryScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [markFailedId, setMarkFailedId] = useState<string | null>(null);

  // Decoded once per list, not once per render of every card.
  const decoded = useMemo(
    () => new Map(entries.map((entry) => [entry.id, readPaymentRequest(entry.payload)])),
    [entries],
  );

  const mark = async (entry: HistoryEntry) => {
    setMarkFailedId(null);
    try {
      await onMark(entry.id, !entry.done);
    } catch {
      setMarkFailedId(entry.id);
    }
  };

  const open = entries.find((entry) => entry.id === openId);
  const openResult = open === undefined ? undefined : decoded.get(open.id);
  if (open !== undefined && openResult !== undefined) {
    // Keyed apart from the list, so the detail does not inherit its scroll offset.
    return (
      <Screen key="detail">
        <Header title="Kept request" action={{ label: "History", onPress: () => setOpenId(null) }} />
        <Card>
          <EntryStatus
            entry={open}
            onMark={() => {
              void mark(open);
            }}
          />
          {markFailedId === open.id ? <Problem>{MARK_FAILED}</Problem> : null}
        </Card>
        {openResult.ok ? (
          <ComposedRequest payload={openResult.payload} data={openResult.data} />
        ) : (
          <Card tone="danger">
            <Problem>{UNREADABLE}</Problem>
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen key="list">
      <Header
        title="History"
        subtitle="Requests kept on this device, newest first. A mark is your own note: the wallet cannot know whether a request was paid."
        action={{ label: "Request money", onPress: onBack }}
      />

      {loadFailed ? (
        <Card tone="danger">
          <Problem>{READ_FAILED_NOTICE}</Problem>
        </Card>
      ) : null}

      {entries.length === 0 ? (
        <Card tone="soft">
          <CardTitle>Nothing kept yet</CardTitle>
          <Hint>
            A request is kept here when you share it, or when you press Keep without sharing.
          </Hint>
        </Card>
      ) : (
        entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            result={decoded.get(entry.id)}
            markFailed={markFailedId === entry.id}
            onOpen={() => setOpenId(entry.id)}
            onMark={() => {
              void mark(entry);
            }}
          />
        ))
      )}
    </Screen>
  );
}

function EntryCard({
  entry,
  result,
  markFailed,
  onOpen,
  onMark,
}: {
  entry: HistoryEntry;
  result: ReadRequestResult | undefined;
  markFailed: boolean;
  onOpen: () => void;
  onMark: () => void;
}) {
  return (
    <Card>
      <EntryStatus entry={entry} onMark={onMark} />
      {result?.ok === true ? (
        <Rows rows={summarizeRequest(result.data)} struck={entry.done} />
      ) : (
        <Problem>{UNREADABLE}</Problem>
      )}
      {markFailed ? <Problem>{MARK_FAILED}</Problem> : null}
      {result?.ok === true ? <Button label="Open" variant="ghost" onPress={onOpen} /> : null}
    </Card>
  );
}

/** When the request was built, its mark and the action that flips the mark. */
function EntryStatus({ entry, onMark }: { entry: HistoryEntry; onMark: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.status}>
      <Text style={[styles.builtAt, { color: theme.muted }]}>
        {formatBuiltAt(entry.builtAt)}
        {entry.done ? " · done" : ""}
      </Text>
      <TextAction
        label={entry.done ? "Mark open" : "Mark done"}
        onPress={onMark}
        accessibilityLabel={
          entry.done ? "Mark this request open again" : "Mark this request done"
        }
      />
    </View>
  );
}

function formatBuiltAt(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

const styles = StyleSheet.create({
  status: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  builtAt: {
    fontSize: 13,
    flexShrink: 1,
  },
});
