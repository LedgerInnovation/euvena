import { useEffect, useState } from "react";
import { AccessibilityInfo, Linking, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";

import {
  buildPaytoUri,
  handoffFields,
  type HandoffField,
  type TransferDetails,
} from "../epc/payto";
import { summarizeRequest, type PaymentCode } from "../epc/request";
import { describeRejection, type Rejection } from "../i18n";
import { useLocale } from "../i18n/context";
import {
  openedRequestStep,
  readPastedRequest,
  readPaymentRequest,
  type OpenedRequest,
  type ReadRequestResult,
} from "../epc/scan";
import {
  Button,
  Card,
  CardTitle,
  Field,
  Header,
  Hint,
  Input,
  Problem,
  Rows,
  Screen,
  SectionLabel,
  TextAction,
  type RowItem,
} from "./kit";
import { useTheme } from "./theme";

/** How long a newly shown review ignores presses on its handoff actions. */
const ARM_DELAY_MS = 500;

interface ScanScreenProps {
  /** The latest request the app was opened with. It can change while the screen is open. */
  opened: OpenedRequest | null;
}

/**
 * Reads a payment request from the camera or from pasted text, then shows what
 * it says before anything else happens with it.
 *
 * The review below is the security surface of the payer side: values come from
 * the decoded payload in strict mode, and a payload that fails any check is
 * replaced by the rejection as a whole, never shown partially. The paste path
 * takes the same route as a scanned code, so the two cannot drift and the flow
 * stays exercisable where no camera exists. A link the app was opened with
 * lands on the same review and starts nothing by itself: the handoff waits
 * for the payer.
 */
export function ScanScreen({ opened }: ScanScreenProps) {
  const { strings } = useLocale();
  const [result, setResult] = useState<ReadRequestResult | null>(opened?.result ?? null);
  // The last opened request this screen has dealt with, whether it showed it,
  // found it identical to what was shown or the payer moved past it.
  const [handledId, setHandledId] = useState<number | null>(opened?.id ?? null);
  // The opened request on screen, which keys the review. Unlike handledId it
  // stays put when the same request is opened again, so nothing resets.
  const [shownId, setShownId] = useState<number | null>(opened?.id ?? null);

  const unhandled = opened !== null && opened.id !== handledId ? opened : null;
  const step = unhandled === null ? null : openedRequestStep(result, unhandled.result);
  if (unhandled !== null && step !== "hold") {
    // Adjusted during render, React's pattern for state that follows a prop.
    setHandledId(unhandled.id);
    if (step === "show") {
      setResult(unhandled.result);
      setShownId(unhandled.id);
    }
  }
  const waiting = step === "hold" ? unhandled : null;

  const waitingId = waiting?.id ?? null;
  const waitingNotice = strings.scan.waiting;
  useEffect(() => {
    if (waitingId !== null) AccessibilityInfo.announceForAccessibility(waitingNotice);
  }, [waitingId, waitingNotice]);

  const show = (next: OpenedRequest) => {
    setResult(next.result);
    setHandledId(next.id);
    setShownId(next.id);
  };
  // Reading another moves past any request still waiting, so the camera opens
  // as asked instead of the waiting request appearing in its place.
  const reset = () => {
    setResult(null);
    setHandledId(opened?.id ?? null);
  };

  return (
    <Screen>
      <Header
        title={result?.ok === true ? strings.scan.reviewTitle : strings.scan.title}
        subtitle={result?.ok === true ? strings.scan.reviewSubtitle : strings.scan.subtitle}
      />

      {waiting === null ? null : (
        <Card tone="soft">
          <Problem>{waitingNotice}</Problem>
          <Button label={strings.scan.showNew} variant="secondary" onPress={() => show(waiting)} />
        </Card>
      )}

      {result === null ? (
        <>
          {/* A scanned code is read byte for byte; pasted text sheds its outer
              whitespace first, which is clipboard packaging and not payload. */}
          <CameraSurface onRead={(text) => setResult(readPaymentRequest(text))} />
          <PasteEntry onRead={(text) => setResult(readPastedRequest(text))} />
        </>
      ) : result.ok ? (
        // Keyed so a request shown in place of another starts with fresh
        // handoff state rather than the previous one's copy markers.
        <ReviewPanel key={shownId ?? "read"} code={result} onReset={reset} />
      ) : (
        <RejectionPanel reason={result.reason} onReset={reset} />
      )}
    </Screen>
  );
}

/**
 * The camera, or what stands in for it while permission is unsettled. Scanning
 * a code, valid or not, unmounts the camera: reporting a rejection at the
 * scanner's frame rate would re-render the screen continuously.
 */
function CameraSurface({ onRead }: { onRead: (text: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const theme = useTheme();
  const { strings } = useLocale();

  // The permission module has not answered yet. The paste path works meanwhile.
  if (permission === null) {
    return <View style={[styles.cameraPlaceholder, { backgroundColor: theme.surface }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.cameraPlaceholder, { backgroundColor: theme.surface }]}>
        {permission.canAskAgain ? (
          <>
            <Button
              label={strings.scan.turnOnCamera}
              onPress={() => {
                void requestPermission();
              }}
            />
            <Hint center>{strings.scan.cameraOnlyHere}</Hint>
          </>
        ) : (
          <Hint center>{strings.scan.cameraOff}</Hint>
        )}
      </View>
    );
  }

  return (
    <View style={styles.cameraFrame}>
      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(scan) => onRead(scan.data)}
        />
        <Viewfinder />
      </View>
      <Hint center>{strings.scan.pointCamera}</Hint>
    </View>
  );
}

/** Four corner marks over the camera, so the payer knows where to hold the code. */
function Viewfinder() {
  return (
    <View pointerEvents="none" style={styles.viewfinder}>
      <View style={[styles.corner, styles.cornerTopLeft]} />
      <View style={[styles.corner, styles.cornerTopRight]} />
      <View style={[styles.corner, styles.cornerBottomLeft]} />
      <View style={[styles.corner, styles.cornerBottomRight]} />
    </View>
  );
}

function PasteEntry({ onRead }: { onRead: (text: string) => void }) {
  const [pasted, setPasted] = useState("");
  const { strings } = useLocale();
  const empty = pasted.trim() === "";

  return (
    <Card>
      <Field label={strings.scan.pasteLabel}>
        <Input
          value={pasted}
          onChangeText={setPasted}
          placeholder={strings.scan.pastePlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
      </Field>
      <Button label={strings.scan.readPasted} disabled={empty} onPress={() => onRead(pasted)} />
    </Card>
  );
}

/**
 * The decoded request, in the same invoice-style rows the request screen
 * prints beside a code it builds. An EN 18184 code is a web address, which a
 * phone camera would have opened; the review says that it was not.
 */
function ReviewPanel({ code, onReset }: { code: PaymentCode; onReset: () => void }) {
  const { strings, tag } = useLocale();
  const poi = code.format === "en18184";
  return (
    <>
      <Card>
        <CardTitle>{strings.composed.whatTheCodeSays}</CardTitle>
        <Rows rows={summarizeRequest(code, strings, tag)} />
        {poi ? <Hint>{strings.scan.poiRead}</Hint> : null}
        <Hint>{strings.scan.reviewHint}</Hint>
      </Card>
      <HandoffActions data={code.data} instant={poi && code.data.instrument === "INST"} />
      <Button label={strings.scan.readAnother} variant="ghost" onPress={onReset} />
    </>
  );
}

/**
 * Hands the reviewed request onward. The primary action fires the payto URI
 * and reports failure instead of asking the system first: querying installed
 * handlers needs platform permission entries the attempt itself does not. The
 * copy actions are always offered, because even a launched app cannot be
 * prefilled and transfer forms are filled field by field.
 */
function HandoffActions({ data, instant }: { data: TransferDetails; instant: boolean }) {
  const { strings } = useLocale();
  const [opening, setOpening] = useState(false);
  const [noHandler, setNoHandler] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    // A review can appear under a finger that was headed for something else,
    // such as when a link opens while the camera is showing. Its actions
    // ignore presses until it has been on screen for a moment.
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const onOpen = async () => {
    if (!armed) return;
    setOpening(true);
    setNoHandler(false);
    try {
      await Linking.openURL(buildPaytoUri(data));
    } catch {
      // Rejection means no installed app handles payto, on either platform.
      setNoHandler(true);
    } finally {
      setOpening(false);
    }
  };

  const onCopy = async (field: HandoffField) => {
    if (!armed) return;
    try {
      await Clipboard.setStringAsync(field.value);
      setCopied(field.key);
    } catch {
      setCopied(null);
    }
  };

  const fields = handoffFields(data);
  const reference = fields.find((field) => field.key === "reference");
  const rest = reference === undefined ? fields : fields.filter((field) => field !== reference);

  const row = (field: HandoffField): RowItem => {
    const label = strings.rows[field.key];
    return {
      label,
      value: field.value,
      singleLine: true,
      trailing: (
        <TextAction
          label={copied === field.key ? strings.common.copied : strings.common.copy}
          onPress={() => {
            void onCopy(field);
          }}
          accessibilityLabel={
            copied === field.key ? strings.common.copiedOf(label) : strings.common.copyOf(label)
          }
        />
      ),
    };
  };

  return (
    <Card>
      <CardTitle>{strings.scan.payIt}</CardTitle>
      {/* The URI cannot carry the structured reference, so its warning and its
          copy action stand BEFORE the launch action: the payer must be able to
          take the reference along before leaving for the banking app, not
          discover its absence after the transfer form is already open. */}
      {reference === undefined ? null : (
        <View style={styles.referenceWarning}>
          <Problem>{strings.scan.referenceWarning}</Problem>
          <Rows rows={[row(reference)]} />
        </View>
      )}
      {/* Neither the payto URI nor a transfer form field carries the kind of
          transfer, so the payee's ask for an instant one is said out loud. */}
      {instant ? <Hint>{strings.scan.instantAsked}</Hint> : null}
      <Button
        label={strings.scan.openBankingApp}
        busy={opening}
        onPress={() => {
          void onOpen();
        }}
      />
      {noHandler ? <Problem>{strings.scan.noHandler}</Problem> : null}
      <SectionLabel>{strings.scan.copyInto}</SectionLabel>
      <Rows rows={rest.map(row)} />
      <Hint>{strings.scan.handoffHint}</Hint>
    </Card>
  );
}

function RejectionPanel({ reason, onReset }: { reason: Rejection; onReset: () => void }) {
  const { strings } = useLocale();
  return (
    <>
      <Card tone="danger">
        <CardTitle>{strings.scan.nothingRead}</CardTitle>
        <Problem>{describeRejection(reason, strings)}</Problem>
        <Hint>{strings.scan.rejectionHint}</Hint>
      </Card>
      <Button label={strings.scan.tryAgain} variant="secondary" onPress={onReset} />
    </>
  );
}

const CORNER = 28;

const styles = StyleSheet.create({
  cameraFrame: {
    gap: 10,
  },
  camera: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000000",
  },
  cameraPlaceholder: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  viewfinder: {
    position: "absolute",
    top: 36,
    right: 36,
    bottom: 36,
    left: 36,
  },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: "#FFFFFF",
    borderRadius: 3,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  referenceWarning: {
    gap: 4,
  },
});
