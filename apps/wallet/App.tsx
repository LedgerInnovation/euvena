import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";

import { EMPTY_PAYEE, type Payee } from "./src/epc/request";
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

  useEffect(() => {
    let cancelled = false;
    void loadPayee()
      .then((stored) => {
        if (cancelled) return;
        setPayee(stored);
        // A first run has nothing to build a code from, so start in settings.
        if (stored.iban === "") setScreen("payee");
      })
      .catch(() => {
        if (cancelled) return;
        // Settings that cannot be read are not the same as settings that were
        // never set, so send the user to the form and say why it is empty
        // rather than presenting the failure as a first run.
        setLoadFailed(true);
        setScreen("payee");
      })
      .finally(() => {
        // Runs on both paths: a rejected read must not strand the spinner.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
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
        <ScanScreen onBack={() => setScreen("request")} />
      ) : (
        <RequestScreen
          payee={payee}
          onEditPayee={() => setScreen("payee")}
          onScan={() => setScreen("scan")}
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
