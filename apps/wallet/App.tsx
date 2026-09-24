import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { type Payee } from "./src/epc/request";
import { readOpenedLink, type OpenedRequest } from "./src/epc/scan";
import { markEntry, rememberRequest, type HistoryEntry } from "./src/settings/history";
import {
  EMPTY_BOOK,
  activePayee,
  removePayeeAt,
  savePayeeAt,
  setActivePayee,
  type PayeeBook,
} from "./src/settings/payee";
import { loadHistory, loadPayeeBook, saveHistory, savePayeeBook } from "./src/settings/storage";
import { useCommittedStore } from "./src/ui/committed";
import { HistoryScreen } from "./src/ui/HistoryScreen";
import { PayeeScreen } from "./src/ui/PayeeScreen";
import { PayeesScreen } from "./src/ui/PayeesScreen";
import { RequestScreen } from "./src/ui/RequestScreen";
import { ScanScreen } from "./src/ui/ScanScreen";
import { useTheme } from "./src/ui/theme";

/** The payee form edits the payee at an index, or a new one when null. */
type Screen =
  | { name: "request" }
  | { name: "payees" }
  | { name: "payee"; editing: number | null }
  | { name: "scan" }
  | { name: "history" };

const READ_FAILED_NOTICE =
  "Saved settings could not be read from this device. Enter them again to build a code.";

// The splash stays up until the settings are read, so the first frame is a
// screen rather than a spinner. Expo Go has no splash of its own to hold, and
// the call rejects there; that is nothing to act on.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  // Settings the user can retype are written even after a failed read: the
  // form says to enter them again, and that has to work.
  const book = useCommittedStore<PayeeBook>(EMPTY_BOOK, savePayeeBook, {
    writeAfterFailedRead: true,
  });
  const history = useCommittedStore<HistoryEntry[]>([], saveHistory);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "request" });
  const [opened, setOpened] = useState<OpenedRequest | null>(null);
  // Outlives a remount of the effect, so arrival numbers never repeat.
  const arrivals = useRef(0);
  const theme = useTheme();
  const { loaded: bookLoaded, failed: bookFailed, commit: commitBook } = book;
  const { loaded: historyLoaded, failed: historyFailed, commit: commitHistory } = history;

  useEffect(() => {
    let cancelled = false;
    // The settings read below only redirects from the start screen, so a link
    // that is already on screen keeps it.
    const leaveStart = () =>
      setScreen((current) =>
        current.name === "request" ? { name: "payee", editing: null } : current,
      );

    const openLink = (url: string | null) => {
      const result = readOpenedLink(url);
      if (cancelled || result === null) return;
      // The native side keeps the latest link until it is cleared. Clearing it
      // once it is read keeps a remounted app from opening it a second time.
      Linking.clearInitialURL();
      arrivals.current += 1;
      setOpened({ id: arrivals.current, result });
      setScreen({ name: "scan" });
    };

    // Subscribed before the launch link is read, so a link that arrives in
    // between is not missed.
    const subscription = Linking.addEventListener("url", (event) => openLink(event.url));

    // The launch link is read from the native side, which also holds a link
    // that arrived before JavaScript was listening, such as one that restarted
    // the app after the system had stopped it. It is read before the settings,
    // so a request opened by link goes straight to review, first run included:
    // paying needs no payee.
    openLink(Linking.getLinkingURL());

    const bookRead = loadPayeeBook()
      .then((stored) => {
        if (cancelled) return;
        bookLoaded(stored);
        // A first run has nothing to build a code from, so start in the form.
        if (stored.payees.length === 0) leaveStart();
      })
      .catch(() => {
        if (cancelled) return;
        // Settings that cannot be read are not the same as settings that were
        // never set, so send the user to the form and say why it is empty
        // rather than presenting the failure as a first run.
        bookFailed();
        leaveStart();
      });

    // The history is not needed to start, but it is read before the splash
    // drops so a kept request is never missing for the first moment.
    const historyRead = loadHistory()
      .then((stored) => {
        if (!cancelled) historyLoaded(stored);
      })
      .catch(() => {
        if (!cancelled) historyFailed();
      });

    // Both reads settle their own failures above, so this runs on every
    // path: a rejected read must not strand the splash.
    void Promise.all([bookRead, historyRead]).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [bookLoaded, bookFailed, historyLoaded, historyFailed]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);

  // Each write rejects when it fails, so the screen can keep its draft and
  // report it instead of moving on from settings that were never persisted.
  // A payee just saved becomes the active one and the form returns to the
  // request screen; a link opened while the write was running has moved on
  // to its review and is left alone.
  const onSavePayee = useCallback(
    async (editing: number | null, payee: Payee) => {
      await commitBook((current) => {
        const next = savePayeeAt(current, editing, payee);
        // A full book or a stale index leaves the book as it was. That is a
        // failed save, not a silent success.
        if (next === current) throw new Error("the payee was not saved");
        return next;
      });
      setScreen((current) => (current.name === "payee" ? { name: "request" } : current));
    },
    [commitBook],
  );
  const onRemovePayee = useCallback(
    async (index: number) => {
      await commitBook((current) => removePayeeAt(current, index));
      setScreen((current) => (current.name === "payee" ? { name: "payees" } : current));
    },
    [commitBook],
  );
  const onUsePayee = useCallback(
    (index: number) => commitBook((current) => setActivePayee(current, index)),
    [commitBook],
  );
  const onKeep = useCallback(
    (payload: string) =>
      commitHistory((current) => rememberRequest(current, payload, new Date())),
    [commitHistory],
  );
  const onMark = useCallback(
    (id: string, done: boolean) => commitHistory((current) => markEntry(current, id, done)),
    [commitHistory],
  );

  const payees = book.value.payees;
  // Where the payee card on the request screen leads: straight to the form
  // while there is nothing to choose from, otherwise to the list.
  const choosePayee = () =>
    setScreen(payees.length === 0 ? { name: "payee", editing: null } : { name: "payees" });

  // The safe-area library insets on both platforms; the SafeAreaView built
  // into React Native is iOS-only, and Android draws edge to edge.
  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.root}>
          <StatusBar style="auto" />
          {!loaded ? (
            <ActivityIndicator style={styles.loading} color={theme.primary} />
          ) : screen.name === "payee" ? (
            <PayeeScreen
              key={screen.editing ?? "new"}
              payee={screen.editing === null ? undefined : payees[screen.editing]}
              onSave={(payee) => onSavePayee(screen.editing, payee)}
              onRemove={screen.editing === null ? undefined : onRemovePayee.bind(null, screen.editing)}
              onCancel={() => setScreen(payees.length === 0 ? { name: "request" } : { name: "payees" })}
              notice={book.loadFailed ? READ_FAILED_NOTICE : null}
            />
          ) : screen.name === "payees" ? (
            <PayeesScreen
              book={book.value}
              onUse={onUsePayee}
              onEdit={(index) => setScreen({ name: "payee", editing: index })}
              onAdd={() => setScreen({ name: "payee", editing: null })}
              onBack={() => setScreen({ name: "request" })}
            />
          ) : screen.name === "scan" ? (
            <ScanScreen opened={opened} onBack={() => setScreen({ name: "request" })} />
          ) : screen.name === "history" ? (
            <HistoryScreen
              entries={history.value}
              loadFailed={history.loadFailed}
              onMark={onMark}
              onBack={() => setScreen({ name: "request" })}
            />
          ) : (
            <RequestScreen
              payee={activePayee(book.value)}
              payeeCount={payees.length}
              onEditPayee={choosePayee}
              onRepairPayee={() => setScreen({ name: "payee", editing: book.value.active })}
              onHistory={() => setScreen({ name: "history" })}
              onKeep={onKeep}
              onScan={() => {
                // Scanning by choice starts from the camera, not from a link
                // reviewed earlier.
                setOpened(null);
                setScreen({ name: "scan" });
              }}
            />
          )}
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
  },
});
