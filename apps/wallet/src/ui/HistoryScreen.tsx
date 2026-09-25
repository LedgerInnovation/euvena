import { useEffect, useMemo, useState } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";

import { summarizeRequest } from "../epc/request";
import { readPaymentRequest, type ReadRequestResult } from "../epc/scan";
import { formatDateTime } from "../i18n";
import { useLocale } from "../i18n/context";
import { type HistoryEntry } from "../settings/history";
import { ComposedRequest } from "./ComposedRequest";
import { Button, Card, CardTitle, Header, Hint, Problem, Rows, Screen, TextAction } from "./kit";
import { useTheme } from "./theme";

interface HistoryScreenProps {
  entries: HistoryEntry[];
  loadFailed: boolean;
  /** Rejects when the history could not be written. */
  onMark: (id: string, done: boolean) => Promise<void>;
  /** Bumped when the history is asked for again while open, to return to the list. */
  listRequested: number;
  /** Whether the history is the tab on screen. It stays mounted while hidden. */
  active: boolean;
}

/**
 * The kept requests, newest first, each shown by decoding its payload again.
 *
 * A kept request is re-opened as the same code and share action the request
 * screen showed when it was built. The done mark is the payee's own
 * bookkeeping: the wallet never learns whether anything was paid.
 */
export function HistoryScreen({
  entries,
  loadFailed,
  onMark,
  listRequested,
  active,
}: HistoryScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { strings } = useLocale();
  useEffect(() => {
    setOpenId(null);
  }, [listRequested]);
  // The system back on Android returns from an open entry to the list, only
  // while the history is the tab on screen.
  useEffect(() => {
    if (!active || openId === null) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpenId(null);
      return true;
    });
    return () => subscription.remove();
  }, [active, openId]);
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
        <Header
          title={strings.history.keptRequest}
          back={{ label: strings.history.title, onPress: () => setOpenId(null) }}
        />
        <Card>
          <EntryStatus
            entry={open}
            onMark={() => {
              void mark(open);
            }}
          />
          {markFailedId === open.id ? <Problem>{strings.history.markFailed}</Problem> : null}
        </Card>
        {openResult.ok ? (
          <ComposedRequest payload={openResult.payload} data={openResult.data} />
        ) : (
          <Card tone="danger">
            <Problem>{strings.history.unreadable}</Problem>
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen key="list">
      <Header
        title={strings.history.title}
        subtitle={strings.history.subtitle}
      />

      {loadFailed ? (
        <Card tone="danger">
          <Problem>{strings.history.readFailed}</Problem>
        </Card>
      ) : null}

      {entries.length === 0 ? (
        <Card tone="soft">
          <CardTitle>{strings.history.nothingKept}</CardTitle>
          <Hint>{strings.history.nothingKeptHint}</Hint>
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
  const { strings, tag } = useLocale();
  return (
    <Card>
      <EntryStatus entry={entry} onMark={onMark} />
      {result?.ok === true ? (
        <Rows rows={summarizeRequest(result.data, strings, tag)} struck={entry.done} />
      ) : (
        <Problem>{strings.history.unreadable}</Problem>
      )}
      {markFailed ? <Problem>{strings.history.markFailed}</Problem> : null}
      {result?.ok === true ? (
        <Button label={strings.common.open} variant="ghost" onPress={onOpen} />
      ) : null}
    </Card>
  );
}

/** When the request was built, its mark and the action that flips the mark. */
function EntryStatus({ entry, onMark }: { entry: HistoryEntry; onMark: () => void }) {
  const theme = useTheme();
  const { strings, tag } = useLocale();
  return (
    <View style={styles.status}>
      <Text style={[styles.builtAt, { color: theme.muted }]}>
        {formatBuiltAt(entry.builtAt, tag)}
        {entry.done ? ` · ${strings.history.done}` : ""}
      </Text>
      <TextAction
        label={entry.done ? strings.history.markOpen : strings.history.markDone}
        onPress={onMark}
        accessibilityLabel={entry.done ? strings.history.markOpenA11y : strings.history.markDoneA11y}
      />
    </View>
  );
}

function formatBuiltAt(iso: string, tag: string): string {
  return formatDateTime(iso, tag);
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
