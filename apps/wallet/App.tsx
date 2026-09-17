import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet } from "react-native";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";

import { EMPTY_PAYEE, type Payee } from "./src/epc/request";
import { readOpenedLink, type OpenedRequest } from "./src/epc/scan";
import { loadPayee, savePayee } from "./src/settings/storage";
import { PayeeScreen } from "./src/ui/PayeeScreen";
import { RequestScreen } from "./src/ui/RequestScreen";
import { ScanScreen } from "./src/ui/ScanScreen";

type Screen = "request" | "payee" | "scan";

const READ_FAILED_NOTICE =
  "Saved settings could not be read from this device. Enter them again to build a code.";

export default function App() {
  const [payee, setPayee] = useState<Payee>(EMPTY_PAYEE);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>("request");
  const [loadFailed, setLoadFailed] = useState(false);
  const [opened, setOpened] = useState<OpenedRequest | null>(null);
  // Outlives a remount of the effect, so arrival numbers never repeat.
  const arrivals = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Once a link is on screen, the settings read below must not send the user
    // away from it.
    let linkShown = false;

    const openLink = (url: string | null) => {
      const result = readOpenedLink(url);
      if (cancelled || result === null) return;
      // The native side keeps the latest link until it is cleared. Clearing it
      // once it is read keeps a remounted app from opening it a second time.
      Linking.clearInitialURL();
      linkShown = true;
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

    void loadPayee()
      .then((stored) => {
        if (cancelled) return;
        setPayee(stored);
        // A first run has nothing to build a code from, so start in settings.
        if (stored.iban === "" && !linkShown) setScreen("payee");
      })
      .catch(() => {
        if (cancelled) return;
        // Settings that cannot be read are not the same as settings that were
        // never set, so send the user to the form and say why it is empty
        // rather than presenting the failure as a first run.
        setLoadFailed(true);
        if (!linkShown) setScreen("payee");
      })
      .finally(() => {
        // Runs on both paths: a rejected read must not strand the spinner.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Rejects when the write fails, so the screen can keep the draft and report it
  // instead of navigating away from settings that were never persisted.
  const onSave = useCallback(async (next: Payee) => {
    await savePayee(next);
    setPayee(next);
    setLoadFailed(false);
    // A link opened while the write was running has moved on to its review.
    setScreen((current) => (current === "payee" ? "request" : current));
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      {!loaded ? (
        <ActivityIndicator style={styles.loading} />
      ) : screen === "payee" ? (
        <PayeeScreen
          payee={payee}
          onSave={onSave}
          onCancel={() => setScreen("request")}
          notice={loadFailed ? READ_FAILED_NOTICE : null}
        />
      ) : screen === "scan" ? (
        <ScanScreen opened={opened} onBack={() => setScreen("request")} />
      ) : (
        <RequestScreen
          payee={payee}
          onEditPayee={() => setScreen("payee")}
          onScan={() => {
            // Scanning by choice starts from the camera, not from a link
            // reviewed earlier.
            setOpened(null);
            setScreen("scan");
          }}
        />
      )}
    </SafeAreaView>
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
