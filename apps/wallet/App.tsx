import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { EMPTY_PAYEE, type Payee } from "./src/epc/request";
import { readOpenedLink, type OpenedRequest } from "./src/epc/scan";
import { markEntry, rememberRequest, type HistoryEntry } from "./src/settings/history";
import { loadHistory, loadPayee, saveHistory, savePayee } from "./src/settings/storage";
import { HistoryScreen } from "./src/ui/HistoryScreen";
import { PayeeScreen } from "./src/ui/PayeeScreen";
import { RequestScreen } from "./src/ui/RequestScreen";
import { ScanScreen } from "./src/ui/ScanScreen";
import { useTheme } from "./src/ui/theme";

type Screen = "request" | "payee" | "scan" | "history";

const READ_FAILED_NOTICE =
  "Saved settings could not be read from this device. Enter them again to build a code.";

// The splash stays up until the settings are read, so the first frame is a
// screen rather than a spinner. Expo Go has no splash of its own to hold, and
// the call rejects there; that is nothing to act on.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [payee, setPayee] = useState<Payee>(EMPTY_PAYEE);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>("request");
  const [loadFailed, setLoadFailed] = useState(false);
  const [opened, setOpened] = useState<OpenedRequest | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  // The committed list and a queue of writes to it. Handlers close over
  // neither the state nor each other: each write reads the list the previous
  // write left, so two taps in flight cannot build on the same old list and
  // lose each other's entry.
  const committed = useRef<HistoryEntry[]>([]);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const readFailed = useRef(false);
  // Outlives a remount of the effect, so arrival numbers never repeat.
  const arrivals = useRef(0);
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    // The settings read below only redirects from the start screen, so a link
    // that is already on screen keeps it.
    const leaveStart = () => setScreen((current) => (current === "request" ? "payee" : current));

    const openLink = (url: string | null) => {
      const result = readOpenedLink(url);
      if (cancelled || result === null) return;
      // The native side keeps the latest link until it is cleared. Clearing it
      // once it is read keeps a remounted app from opening it a second time.
      Linking.clearInitialURL();
      arrivals.current += 1;
      setOpened({ id: arrivals.current, result });
      setScreen("scan");
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

    const payeeRead = loadPayee()
      .then((stored) => {
        if (cancelled) return;
        setPayee(stored);
        // A first run has nothing to build a code from, so start in settings.
        if (stored.iban === "") leaveStart();
      })
      .catch(() => {
        if (cancelled) return;
        // Settings that cannot be read are not the same as settings that were
        // never set, so send the user to the form and say why it is empty
        // rather than presenting the failure as a first run.
        setLoadFailed(true);
        leaveStart();
      });

    // The history is not needed to start, but it is read before the splash
    // drops so a kept request is never missing for the first moment.
    const historyRead = loadHistory()
      .then((stored) => {
        if (cancelled) return;
        committed.current = stored;
        setHistory(stored);
      })
      .catch(() => {
        if (cancelled) return;
        // A list that could not be read must not be replaced by the next
        // write: that would turn a failed read into a lost history. Writes
        // refuse until the app is restarted.
        readFailed.current = true;
        setHistoryLoadFailed(true);
      });

    // Both reads settle their own failures above, so this runs on every
    // path: a rejected read must not strand the splash.
    void Promise.all([payeeRead, historyRead]).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);

  // Rejects when the write fails, so the screen can keep the draft and report it
  // instead of navigating away from settings that were never persisted.
  const onSave = useCallback(async (next: Payee) => {
    await savePayee(next);
    setPayee(next);
    setLoadFailed(false);
    // A link opened while the write was running has moved on to its review.
    setScreen((current) => (current === "payee" ? "request" : current));
  }, []);

  // Writes go through one queue, each applied to the list the previous one
  // committed, and the device is written before the screen changes, so a list
  // the user sees is a list the device holds. A write rejects on failure and
  // the screen reports it; the queue itself carries on.
  const commitHistory = useCallback((update: (current: HistoryEntry[]) => HistoryEntry[]) => {
    const write = writes.current.then(async () => {
      if (readFailed.current) throw new Error("history was not read");
      const next = update(committed.current);
      await saveHistory(next);
      committed.current = next;
      setHistory(next);
    });
    writes.current = write.catch(() => undefined);
    return write;
  }, []);
  const onKeep = useCallback(
    (payload: string) => commitHistory((current) => rememberRequest(current, payload, new Date())),
    [commitHistory],
  );
  const onMark = useCallback(
    (id: string, done: boolean) => commitHistory((current) => markEntry(current, id, done)),
    [commitHistory],
  );

  // The safe-area library insets on both platforms; the SafeAreaView built
  // into React Native is iOS-only, and Android draws edge to edge.
  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.root}>
          <StatusBar style="auto" />
        {!loaded ? (
          <ActivityIndicator style={styles.loading} color={theme.primary} />
        ) : screen === "payee" ? (
          <PayeeScreen
            payee={payee}
            onSave={onSave}
            onCancel={() => setScreen("request")}
            notice={loadFailed ? READ_FAILED_NOTICE : null}
          />
        ) : screen === "scan" ? (
          <ScanScreen opened={opened} onBack={() => setScreen("request")} />
        ) : screen === "history" ? (
          <HistoryScreen
            entries={history}
            loadFailed={historyLoadFailed}
            onMark={onMark}
            onBack={() => setScreen("request")}
          />
        ) : (
          <RequestScreen
            payee={payee}
            onEditPayee={() => setScreen("payee")}
            onHistory={() => setScreen("history")}
            onKeep={onKeep}
            onScan={() => {
              // Scanning by choice starts from the camera, not from a link
              // reviewed earlier.
              setOpened(null);
              setScreen("scan");
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
