import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Appearance, BackHandler, Keyboard, StyleSheet, View } from "react-native";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useLocales } from "expo-localization";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { type Payee } from "./src/epc/request";
import { readOpenedLink, type OpenedRequest } from "./src/epc/scan";
import { resolveLocale, type Language } from "./src/i18n";
import { LocaleProvider, useStrings } from "./src/i18n/context";
import { markEntry, rememberRequest, type HistoryEntry } from "./src/settings/history";
import {
  EMPTY_BOOK,
  activePayee,
  removePayeeAt,
  savePayeeAt,
  setActivePayee,
  type PayeeBook,
} from "./src/settings/payee";
import { DEFAULT_PREFERENCES, type Preferences } from "./src/settings/preferences";
import {
  loadHistory,
  loadPayeeBook,
  loadPreferences,
  saveHistory,
  savePayeeBook,
  savePreferences,
} from "./src/settings/storage";
import {
  TransferProblem,
  type ImportOutcome,
  mergeTransfer,
  readTransfer,
  serializeTransfer,
  transferFileName,
} from "./src/settings/transfer";
import { useCommittedStore } from "./src/ui/committed";
import { pickDataFile, shareDataFile } from "./src/ui/dataFile";
import { HistoryScreen } from "./src/ui/HistoryScreen";
import { type Tab, TabBar } from "./src/ui/kit";
import { PayeeScreen } from "./src/ui/PayeeScreen";
import { PayeesScreen } from "./src/ui/PayeesScreen";
import { RequestScreen } from "./src/ui/RequestScreen";
import { ScanScreen } from "./src/ui/ScanScreen";
import { SettingsScreen } from "./src/ui/SettingsScreen";
import { AppearanceContext, useScheme, useTheme } from "./src/ui/theme";

/** The three places the bar at the foot of the screen switches between. */
type TabKey = "request" | "pay" | "history";

/** Where the payee screens were entered from, which is where leaving them returns to. */
type Origin = "tab" | "settings";

/**
 * What is on screen: the tabs, or a screen opened over them, which hides the
 * bar until it is left. The payee form edits the payee at an index, or a new
 * one when null; it remembers whether it was opened from the payees list, so
 * that Cancel, Save and Remove return to where the user came from.
 */
type Screen =
  | { name: "tab" }
  | { name: "settings" }
  | { name: "payees"; origin: Origin }
  | { name: "payee"; editing: number | null; origin: Origin; fromList: boolean };


/** Where the payee form returns to when it is left without a change. */
function leavePayeeForm(screen: Screen & { name: "payee" }): Screen {
  if (screen.fromList) return { name: "payees", origin: screen.origin };
  return screen.origin === "settings" ? { name: "settings" } : { name: "tab" };
}

/** Where a payee just saved leads: back to a list where there was one, else to the tab. */
function afterPayeeSaved(screen: Screen & { name: "payee" }): Screen {
  if (screen.fromList || screen.origin === "settings") {
    return { name: "payees", origin: screen.origin };
  }
  return { name: "tab" };
}

/** Where the payees list returns to. */
function leavePayees(screen: Screen & { name: "payees" }): Screen {
  return screen.origin === "settings" ? { name: "settings" } : { name: "tab" };
}

// The splash stays up until the settings are read, so the first frame is a
// screen rather than a spinner. Expo Go has no splash of its own to hold, and
// the call rejects there; that is nothing to act on.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Reads the preferences and puts the appearance and the language they name
 * in force over the whole wallet. Both can be chosen again, so they are
 * written even after a failed read.
 */
export default function App() {
  const preferences = useCommittedStore<Preferences>(DEFAULT_PREFERENCES, savePreferences, {
    writeAfterFailedRead: true,
  });
  const [loaded, setLoaded] = useState(false);
  const { loaded: preferencesLoaded, failed: preferencesFailed } = preferences;
  useEffect(() => {
    let cancelled = false;
    loadPreferences()
      .then((stored) => {
        if (!cancelled) preferencesLoaded(stored);
      })
      .catch(() => {
        if (!cancelled) preferencesFailed();
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preferencesLoaded, preferencesFailed]);

  // The device's languages, most preferred first. The hook follows a change
  // made in the system settings while the app is running.
  const deviceTags = useLocales()
    .map((locale) => locale.languageTag)
    .join(" ");
  const chosenLanguage = preferences.value.language;
  const deviceLanguage = useMemo(
    () => resolveLocale(null, deviceTags.split(" ")).language,
    [deviceTags],
  );
  const locale = useMemo(
    () => resolveLocale(chosenLanguage, deviceTags.split(" ")),
    [chosenLanguage, deviceTags],
  );
  const { commit } = preferences;
  // The native side follows the chosen appearance too, so alerts, the
  // keyboard and the sheets the wallet opens match the screens.
  const appearance = preferences.value.appearance;
  useEffect(() => {
    Appearance.setColorScheme(appearance === "system" ? "unspecified" : appearance);
  }, [appearance]);
  const onAppearance = useCallback(
    (next: Preferences["appearance"]) => {
      // Told to the platform before the write settles, so the frame that
      // follows the tap already reads the right scheme.
      Appearance.setColorScheme(next === "system" ? "unspecified" : next);
      return commit((current) => ({ ...current, appearance: next }));
    },
    [commit],
  );
  const onLanguage = useCallback(
    (chosen: Language | null) => commit((current) => ({ ...current, language: chosen })),
    [commit],
  );

  return (
    <AppearanceContext.Provider value={appearance}>
      <LocaleProvider locale={locale}>
        <Wallet
          preferencesLoaded={loaded}
          preferences={preferences.value}
          deviceLanguage={deviceLanguage}
          onAppearance={onAppearance}
          onLanguage={onLanguage}
        />
      </LocaleProvider>
    </AppearanceContext.Provider>
  );
}

interface WalletProps {
  preferencesLoaded: boolean;
  preferences: Preferences;
  deviceLanguage: Language;
  onAppearance: (appearance: Preferences["appearance"]) => Promise<void>;
  onLanguage: (language: Language | null) => Promise<void>;
}

function Wallet({
  preferencesLoaded,
  preferences,
  deviceLanguage,
  onAppearance,
  onLanguage,
}: WalletProps) {
  const strings = useStrings();
  const scheme = useScheme();
  // Settings the user can retype are written even after a failed read: the
  // form says to enter them again, and that has to work.
  const book = useCommittedStore<PayeeBook>(EMPTY_BOOK, savePayeeBook, {
    writeAfterFailedRead: true,
  });
  const history = useCommittedStore<HistoryEntry[]>([], saveHistory);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<TabKey>("request");
  const [screen, setScreen] = useState<Screen>({ name: "tab" });
  const [opened, setOpened] = useState<OpenedRequest | null>(null);
  // Bumped when the History tab is chosen while already showing, so an open
  // entry returns to the list.
  const [historyListRequested, setHistoryListRequested] = useState(0);
  // Outlives a remount of the effect, so arrival numbers never repeat.
  const arrivals = useRef(0);
  const theme = useTheme();
  const { loaded: bookLoaded, failed: bookFailed, commit: commitBook } = book;
  const { loaded: historyLoaded, failed: historyFailed, commit: commitHistory } = history;

  useEffect(() => {
    let cancelled = false;
    // The settings read below only redirects from the start screen. A link
    // that has arrived is on screen already and keeps it: paying needs no
    // payee, so the form must not cover the review.
    const leaveStart = () => {
      if (arrivals.current > 0) return;
      setScreen((current) => {
        if (current.name !== "tab") return current;
        return { name: "payee", editing: null, origin: "tab", fromList: false };
      });
    };

    const openLink = (url: string | null) => {
      const result = readOpenedLink(url);
      if (cancelled || result === null) return;
      // The native side keeps the latest link until it is cleared. Clearing it
      // once it is read keeps a remounted app from opening it a second time.
      Linking.clearInitialURL();
      arrivals.current += 1;
      setOpened({ id: arrivals.current, result });
      setTab("pay");
      setScreen({ name: "tab" });
    };

    // Subscribed before the launch link is read, so a link that arrives in
    // between is not missed.
    const subscription = Linking.addEventListener("url", (event) => openLink(event.url));

    // The launch link is read from the native side, which also holds a link
    // that arrived before JavaScript was listening, such as one that restarted
    // the app after the system had stopped it. It is read before the settings,
    // so a request opened by link goes straight to review, first run included.
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

  const ready = loaded && preferencesLoaded;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // The system back gesture or button on Android leaves a screen opened over
  // the tabs the way its own back link does. On the tabs it keeps its meaning,
  // and the payee form handles it itself, since Cancel waits while it writes.
  useEffect(() => {
    if (screen.name !== "settings" && screen.name !== "payees") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setScreen((current) => {
        if (current.name === "settings") return { name: "tab" };
        if (current.name === "payees") return leavePayees(current);
        return current;
      });
      return true;
    });
    return () => subscription.remove();
  }, [screen.name]);

  // Each write rejects when it fails, so the screen can keep its draft and
  // report it instead of moving on from settings that were never persisted.
  // A payee just saved becomes the active one and the form is left; a link
  // opened while the write was running has moved on to its review and is left
  // alone.
  const onSavePayee = useCallback(
    async (editing: number | null, payee: Payee) => {
      await commitBook((current) => {
        const next = savePayeeAt(current, editing, payee);
        // A full book or a stale index leaves the book as it was. That is a
        // failed save, not a silent success.
        if (next === current) throw new Error("the payee was not saved");
        return next;
      });
      setScreen((current) => (current.name === "payee" ? afterPayeeSaved(current) : current));
    },
    [commitBook],
  );
  const onRemovePayee = useCallback(
    async (index: number) => {
      await commitBook((current) => removePayeeAt(current, index));
      setScreen((current) =>
        current.name === "payee" ? { name: "payees", origin: current.origin } : current,
      );
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
  // The export is built from what is committed, not from a draft on screen.
  const bookValue = book.value;
  const historyValue = history.value;
  const shareDialog = strings.settings.shareDialog;
  const onExport = useCallback(() => {
    const now = new Date();
    return shareDataFile(
      transferFileName(now),
      serializeTransfer({ book: bookValue, history: historyValue }, now),
      shareDialog,
    );
  }, [bookValue, historyValue, shareDialog]);
  // The payees are written first and on their own, so a history that cannot
  // be written (after a failed read) still leaves the payees imported, and
  // the outcome says so. The counts are taken once a write has settled: a
  // write that fails added nothing.
  const bookUnread = book.loadFailed;
  const onImport = useCallback(async (): Promise<ImportOutcome | null> => {
    // A book that could not be read would be written over by the merge, and
    // that is the user's whole list: a file is not worth it.
    if (bookUnread) throw new TransferProblem("bookUnread");
    const text = await pickDataFile();
    if (text === null) return null;
    const read = readTransfer(text, new Date());
    if (!read.ok) throw new TransferProblem(read.reason);
    const outcome: ImportOutcome = {
      added: { payees: 0, history: 0 },
      skipped: { payees: 0, history: 0 },
      dropped: read.dropped,
      historyFailed: false,
    };
    let pending = { added: 0, skipped: 0 };
    await commitBook((current) => {
      const merged = mergeTransfer({ book: current, history: [] }, { ...read.transfer, history: [] });
      pending = { added: merged.added.payees, skipped: merged.skipped.payees };
      return merged.transfer.book;
    });
    outcome.added.payees = pending.added;
    outcome.skipped.payees = pending.skipped;
    // A file without kept requests has nothing to write, so a history that
    // refuses writes is not asked.
    if (read.transfer.history.length === 0) return outcome;
    try {
      await commitHistory((current) => {
        const merged = mergeTransfer(
          { book: EMPTY_BOOK, history: current },
          { book: EMPTY_BOOK, history: read.transfer.history },
        );
        pending = { added: merged.added.history, skipped: merged.skipped.history };
        return merged.transfer.history;
      });
      outcome.added.history = pending.added;
      outcome.skipped.history = pending.skipped;
    } catch {
      outcome.historyFailed = true;
    }
    return outcome;
  }, [bookUnread, commitBook, commitHistory]);
  // An export after a failed read would hand out a file missing what could
  // not be read, and look complete. It is refused instead.
  const exportBlocked = book.loadFailed || history.loadFailed;

  const tabs: readonly Tab<TabKey>[] = [
    { key: "request", label: strings.tabs.request, icon: "qr-code-outline", selectedIcon: "qr-code" },
    { key: "pay", label: strings.tabs.pay, icon: "scan-outline", selectedIcon: "scan" },
    { key: "history", label: strings.tabs.history, icon: "time-outline", selectedIcon: "time" },
  ];

  const payees = book.value.payees;
  // Where a payee card or row leads: straight to the form while there is
  // nothing to choose from, otherwise to the list.
  const choosePayee = (origin: Origin) =>
    setScreen(
      payees.length === 0
        ? { name: "payee", editing: null, origin, fromList: false }
        : { name: "payees", origin },
    );
  const activeName = payees.length === 0 ? null : activePayee(book.value).name;

  const onTab = (next: TabKey) => {
    if (next === tab) {
      if (next === "history") setHistoryListRequested((count) => count + 1);
      return;
    }
    // A field on the tab being left would keep the focus while hidden.
    Keyboard.dismiss();
    // Paying by choice starts from the camera, not from a link reviewed
    // earlier.
    if (next === "pay") setOpened(null);
    setTab(next);
  };

  // The safe-area library insets on both platforms; the SafeAreaView built
  // into React Native is iOS-only, and Android draws edge to edge. The bar at
  // the foot takes the bottom inset itself, so the outer view leaves it out
  // and the screens opened over the tabs take it back.
  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          {!ready ? (
            <ActivityIndicator style={styles.loading} color={theme.primary} />
          ) : screen.name === "payee" ? (
            <SafeAreaView style={styles.root} edges={["bottom"]}>
              <PayeeScreen
                key={screen.editing ?? "new"}
                payee={screen.editing === null ? undefined : payees[screen.editing]}
                onSave={(payee) => onSavePayee(screen.editing, payee)}
                onRemove={
                  screen.editing === null ? undefined : onRemovePayee.bind(null, screen.editing)
                }
                onCancel={() => setScreen(leavePayeeForm(screen))}
                notice={book.loadFailed ? strings.payee.readFailed : null}
              />
            </SafeAreaView>
          ) : screen.name === "payees" ? (
            <SafeAreaView style={styles.root} edges={["bottom"]}>
              <PayeesScreen
                book={book.value}
                onUse={onUsePayee}
                onEdit={(index) =>
                  setScreen({ name: "payee", editing: index, origin: screen.origin, fromList: true })
                }
                onAdd={() =>
                  setScreen({ name: "payee", editing: null, origin: screen.origin, fromList: true })
                }
                from={screen.origin === "settings" ? strings.settings.title : strings.tabs.request}
                onBack={() => setScreen(leavePayees(screen))}
              />
            </SafeAreaView>
          ) : screen.name === "settings" ? (
            <SafeAreaView style={styles.root} edges={["bottom"]}>
              <SettingsScreen
                payeeCount={payees.length}
                activeName={activeName}
                onPayees={() => choosePayee("settings")}
                onExport={onExport}
                exportBlocked={exportBlocked}
                preferences={preferences}
                deviceLanguage={deviceLanguage}
                onAppearance={onAppearance}
                onLanguage={onLanguage}
                onImport={onImport}
                onBack={() => setScreen({ name: "tab" })}
              />
            </SafeAreaView>
          ) : (
            <>
              {/* Request and History stay mounted while another tab shows, so
                  a draft or an open entry survives a look elsewhere. Pay
                  mounts when chosen, since a hidden camera would stay on. */}
              <View style={[styles.root, tab === "request" ? null : styles.hidden]}>
                <RequestScreen
                  payee={activePayee(book.value)}
                  payeeCount={payees.length}
                  onEditPayee={() => choosePayee("tab")}
                  onRepairPayee={() =>
                    setScreen({
                      name: "payee",
                      editing: book.value.active,
                      origin: "tab",
                      fromList: false,
                    })
                  }
                  onSettings={() => setScreen({ name: "settings" })}
                  onKeep={onKeep}
                />
              </View>
              {tab === "pay" ? (
                <View style={styles.root}>
                  <ScanScreen opened={opened} />
                </View>
              ) : null}
              <View style={[styles.root, tab === "history" ? null : styles.hidden]}>
                <HistoryScreen
                  entries={history.value}
                  loadFailed={history.loadFailed}
                  onMark={onMark}
                  listRequested={historyListRequested}
                  active={tab === "history"}
                />
              </View>
              <TabBar tabs={tabs} active={tab} onChange={onTab} />
            </>
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
  hidden: {
    display: "none",
  },
  loading: {
    flex: 1,
  },
});
