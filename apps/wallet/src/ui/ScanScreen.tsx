import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { type EpcQrData } from "@eupi/qr";

import { buildPaytoUri, handoffFields, type HandoffField } from "../epc/payto";
import { summarizeRequest } from "../epc/request";
import { readPastedRequest, readPaymentRequest, type ReadRequestResult } from "../epc/scan";

interface ScanScreenProps {
  onBack: () => void;
}

/**
 * Reads a payment request from the camera or from pasted text, then shows what
 * it says before anything else happens with it.
 *
 * The review below is the security surface of the payer side: values come from
 * the decoded payload in strict mode, and a payload that fails any check is
 * replaced by the rejection as a whole, never shown partially. The paste path
 * takes the same route as a scanned code, so the two cannot drift and the flow
 * stays exercisable where no camera exists.
 */
export function ScanScreen({ onBack }: ScanScreenProps) {
  const [result, setResult] = useState<ReadRequestResult | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Scan a request</Text>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.link}>Request money</Text>
        </Pressable>
      </View>
      <Text style={styles.intro}>
        Reads a payment code or a shared request and shows what it says. Reading pays nothing and
        sends nothing.
      </Text>

      {result === null ? (
        <>
          {/* A scanned code is read byte for byte; pasted text sheds its outer
              whitespace first, which is clipboard packaging and not payload. */}
          <CameraSurface onRead={(text) => setResult(readPaymentRequest(text))} />
          <PasteEntry onRead={(text) => setResult(readPastedRequest(text))} />
        </>
      ) : result.ok ? (
        <ReviewPanel data={result.data} onReset={() => setResult(null)} />
      ) : (
        <RejectionPanel reason={result.reason} onReset={() => setResult(null)} />
      )}
    </ScrollView>
  );
}

/**
 * The camera, or what stands in for it while permission is unsettled. Scanning
 * a code, valid or not, unmounts the camera: reporting a rejection at the
 * scanner's frame rate would re-render the screen continuously.
 */
function CameraSurface({ onRead }: { onRead: (text: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();

  // The permission module has not answered yet. The paste path works meanwhile.
  if (permission === null) return <View style={styles.cameraPlaceholder} />;

  if (!permission.granted) {
    return (
      <View style={styles.cameraPlaceholder}>
        {permission.canAskAgain ? (
          <>
            <Pressable
              onPress={() => {
                void requestPermission();
              }}
              accessibilityRole="button"
              style={styles.primary}
            >
              <Text style={styles.primaryLabel}>Turn on the camera</Text>
            </Pressable>
            <Text style={styles.placeholderHint}>
              The camera is only used to read codes on this screen.
            </Text>
          </>
        ) : (
          <Text style={styles.placeholderHint}>
            The camera is switched off for this app in the system settings. Pasting below still
            works.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.cameraFrame}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(scan) => onRead(scan.data)}
      />
      <Text style={styles.hint}>Point the camera at a payment QR code.</Text>
    </View>
  );
}

function PasteEntry({ onRead }: { onRead: (text: string) => void }) {
  const [pasted, setPasted] = useState("");
  const empty = pasted.trim() === "";

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Or paste a request</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={pasted}
        onChangeText={setPasted}
        placeholder="A shared eupi://request link or the text of a code"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <Pressable
        onPress={() => onRead(pasted)}
        accessibilityRole="button"
        accessibilityState={{ disabled: empty }}
        disabled={empty}
        style={[styles.primary, empty ? styles.primaryDisabled : null]}
      >
        <Text style={styles.primaryLabel}>Read what was pasted</Text>
      </Pressable>
    </View>
  );
}

/**
 * The decoded request, in the same invoice-style rows the request screen
 * prints beside a code it builds.
 */
function ReviewPanel({ data, onReset }: { data: EpcQrData; onReset: () => void }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>What the code says</Text>
      {summarizeRequest(data).map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.rowLabel}>{row.label}</Text>
          <Text style={styles.rowValue}>{row.value}</Text>
        </View>
      ))}
      <Text style={styles.hint}>
        Values read from the code itself. Check the name and IBAN with whoever is asking to be
        paid; the code cannot do that for you.
      </Text>
      <HandoffActions data={data} />
      <Pressable onPress={onReset} accessibilityRole="button" style={styles.secondary}>
        <Text style={styles.secondaryLabel}>Read another</Text>
      </Pressable>
    </View>
  );
}

const NO_HANDLER_NOTICE =
  "No installed app took this request. Banks have not agreed on a common link format yet, so copy the details into your banking app instead.";

/**
 * Hands the reviewed request onward. The primary action fires the payto URI
 * and reports failure instead of asking the system first: querying installed
 * handlers needs platform permission entries the attempt itself does not. The
 * copy actions are always offered, because even a launched app cannot be
 * prefilled and transfer forms are filled field by field.
 */
function HandoffActions({ data }: { data: EpcQrData }) {
  const [opening, setOpening] = useState(false);
  const [noHandler, setNoHandler] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const onOpen = async () => {
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
    try {
      await Clipboard.setStringAsync(field.value);
      setCopied(field.label);
    } catch {
      setCopied(null);
    }
  };

  const fields = handoffFields(data);
  const reference = fields.find((field) => field.label === "Reference");
  const rest = reference === undefined ? fields : fields.filter((field) => field !== reference);

  const row = (field: HandoffField) => (
    <View key={field.label} style={styles.row}>
      <Text style={styles.rowLabel}>{field.label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {field.value}
      </Text>
      <Pressable
        onPress={() => {
          void onCopy(field);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          copied === field.label ? `${field.label} copied` : `Copy ${field.label}`
        }
      >
        <Text style={styles.link}>{copied === field.label ? "Copied" : "Copy"}</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.handoff}>
      {/* The URI cannot carry the structured reference, so its warning and its
          copy action stand BEFORE the launch action: the payer must be able to
          take the reference along before leaving for the banking app, not
          discover its absence after the transfer form is already open. */}
      {reference === undefined ? null : (
        <>
          <Text style={styles.issue}>
            The link cannot carry the structured reference. Copy it first and paste it into the
            reference field of your banking app.
          </Text>
          {row(reference)}
        </>
      )}
      <Pressable
        onPress={() => {
          void onOpen();
        }}
        accessibilityRole="button"
        accessibilityState={{ disabled: opening, busy: opening }}
        disabled={opening}
        style={[styles.primary, opening ? styles.primaryDisabled : null]}
      >
        <Text style={styles.primaryLabel}>Open your banking app</Text>
      </Pressable>
      {noHandler ? <Text style={styles.issue}>{NO_HANDLER_NOTICE}</Text> : null}
      <Text style={styles.label}>Copy into a transfer form</Text>
      {rest.map(row)}
      <Text style={styles.hint}>
        The link is a payto address built from the code. If no app on this device answers it,
        your banking app may still scan these codes directly.
      </Text>
    </View>
  );
}

function RejectionPanel({ reason, onReset }: { reason: string; onReset: () => void }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Nothing usable was read</Text>
      <Text style={styles.issue}>{reason}</Text>
      <Text style={styles.hint}>
        A request that fails a check is not shown at all: a partial reading could direct money to
        the wrong account.
      </Text>
      <Pressable onPress={onReset} accessibilityRole="button" style={styles.secondary}>
        <Text style={styles.secondaryLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 26,
    fontWeight: "600",
  },
  link: {
    fontSize: 15,
    color: "#1b64c8",
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.75,
  },
  cameraFrame: {
    gap: 8,
  },
  camera: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  cameraPlaceholder: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#e8e8ed",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  placeholderHint: {
    fontSize: 12,
    opacity: 0.6,
    lineHeight: 17,
    textAlign: "center",
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#c7c7cc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  hint: {
    fontSize: 12,
    opacity: 0.6,
    lineHeight: 17,
  },
  issue: {
    fontSize: 13,
    color: "#b3261e",
  },
  panel: {
    gap: 8,
  },
  handoff: {
    marginTop: 12,
    gap: 8,
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  rowLabel: {
    width: 84,
    fontSize: 13,
    opacity: 0.6,
  },
  rowValue: {
    flex: 1,
    fontSize: 15,
  },
  primary: {
    backgroundColor: "#1b64c8",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  secondary: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryLabel: {
    fontSize: 15,
    color: "#1b64c8",
  },
});
