import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";

import { EMPTY_PAYEE, type Payee } from "./src/epc/request";
import { readOpenedLink, type ReadRequestResult } from "./src/epc/scan";
import { loadPayee, savePayee } from "./src/settings/storage";
import { PayeeScreen } from "./src/ui/PayeeScreen";
import { RequestScreen } from "./src/ui/RequestScreen";
import { ScanScreen } from "./src/ui/ScanScreen";

type Screen = "request" | "payee" | "scan";

/** A request the app was opened with, numbered so each arrival gets a fresh review. */
interface OpenedRequest {
  id: number;
  result: ReadRequestResult;
}

const READ_FAILED_NOTICE =
  "Saved settings could not be read from this device. Enter them again to build a code.";

export default function App() {
  const [payee, setPayee] = useState<Payee>(EMPTY_PAYEE);
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>("request");
  const [loadFailed, setLoadFailed] = useState(false);
  const [opened, setOpened] = useState<OpenedRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Once a link is on screen, the settings read below must not send the user
    // away from it, and a launch URL that resolves late must not replace it.
    let linkShown = false;
    let arrivals = 0;

    const openLink = (url: string | null) => {
      if (cancelled) return;
      const result = readOpenedLink(url);
      if (result === null) return;
      linkShown = true;
      arrivals += 1;
      setOpened({ id: arrivals, result });
      setScreen("scan");
    };

    // Subscribed before the launch URL is read, so a link that arrives in
    // between is not missed.
    const subscription = Linking.addEventListener("url", (event) => openLink(event.url));

    // The launch URL is settled before the settings are, so a request opened by
    // link goes straight to review, first run included: paying needs no payee.
    // A launch URL that cannot be read counts as a launch without one.
    const launch = Linking.getInitialURL().catch(() => null);
    void launch.then((url) => {
      if (!linkShown) openLink(url);
    });
    void launch
      .then(() => loadPayee())
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
    setScreen("request");
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
        <ScanScreen
          key={opened?.id ?? 0}
          initialResult={opened?.result ?? null}
          // A link can open the app before any payee exists, and requesting
          // money starts with one, so leaving goes to settings in that case.
          onBack={() => setScreen(payee.iban === "" ? "payee" : "request")}
        />
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
