import { useCallback, useMemo, useState } from "react";
import { Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { EPC069_MAX_BYTES, byteLength, type EpcQrData } from "@euvena/qr";

import { buildShareMessage } from "../epc/link";
import {
  EMPTY_FORM,
  buildPaymentRequest,
  formatIbanForDisplay,
  summarizeRequest,
  validatePayee,
  type Payee,
  type RemittanceKind,
  type RequestForm,
} from "../epc/request";
import {
  EPC069_ERROR_CORRECTION,
  EPC069_MAX_VERSION,
  toQrSymbol,
  type QrSymbol,
} from "../qr/symbol";
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
  Segmented,
  SectionLabel,
  TextAction,
} from "./kit";
import { QrCode } from "./QrCode";
import { useTheme } from "./theme";

interface RequestScreenProps {
  payee: Payee;
  onEditPayee: () => void;
  onScan: () => void;
}

const REMITTANCE_KINDS: {
  key: RemittanceKind;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    key: "text",
    label: "Text",
    placeholder: "What the payment is for",
    hint: "Unstructured text, up to 140 characters",
  },
  {
    key: "reference",
    label: "Reference",
    placeholder: "RF18539007547034",
    hint: "Structured creditor reference, up to 35 characters",
  },
];

/** Issues the request builder reports against the payee rather than the form. */
const PAYEE_ELEMENTS: ReadonlySet<string> = new Set(["name", "iban", "bic"]);

/**
 * Subject offered to destinations that have one, such as mail. Android reads
 * it from the content title and iOS from the subject option, so the share
 * call passes it as both.
 */
const SHARE_TITLE = "Payment request";

type SymbolResult = { symbol: QrSymbol } | { error: string };

function buildSymbol(payload: string): SymbolResult {
  try {
    return { symbol: toQrSymbol(payload) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "the code could not be rendered" };
  }
}

/**
 * Composes a payment request and renders it as an EPC069-12 QR code.
 *
 * The values printed below the code are decoded back out of the payload rather
 * than read from the form, so what the payer reads is what a scanner reads. The
 * guidelines recommend showing them in an invoice-style presentation next to
 * the code, which also gives the payer a way to check the code before scanning.
 */
export function RequestScreen({ payee, onEditPayee, onScan }: RequestScreenProps) {
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const { width } = useWindowDimensions();
  const theme = useTheme();

  const payeeIssues = validatePayee(payee);
  const payeeReady = Object.keys(payeeIssues).length === 0;
  // Stored settings are not validated when read, so a payee written under
  // older rules can be present and still not encode. That is a problem to
  // name, not a first run.
  const payeeEmpty = payee.name === "" && payee.iban === "";
  const request = useMemo(() => buildPaymentRequest(payee, form), [payee, form]);
  const rendered = useMemo(
    () => (request.ok ? buildSymbol(request.payload) : undefined),
    [request],
  );
  // Payee problems are what the set-up card is for, so only form problems are
  // listed under the form.
  const formIssues = request.ok
    ? []
    : request.issues.filter((issue) => !PAYEE_ELEMENTS.has(issue.element));

  const remittanceKind = REMITTANCE_KINDS.find((entry) => entry.key === form.remittanceKind);
  const codeSize = Math.min(width - 104, 280);

  return (
    <Screen>
      <Header title="Request money" />

      {payeeReady ? (
        <Card>
          <View style={styles.payeeRow}>
            <View style={styles.payeeText}>
              <SectionLabel>Paid to</SectionLabel>
              <Text style={[styles.payeeName, { color: theme.text }]} numberOfLines={1}>
                {payee.name}
              </Text>
              <Hint>{formatIbanForDisplay(payee.iban)}</Hint>
            </View>
            <TextAction label="Change" onPress={onEditPayee} accessibilityLabel="Change payee" />
          </View>
        </Card>
      ) : payeeEmpty ? (
        <Card tone="soft">
          <CardTitle>Who gets paid?</CardTitle>
          <Hint>
            Add the name and IBAN a request is paid to. They stay on this device: the wallet has
            no accounts and no backend.
          </Hint>
          <Button label="Add name and IBAN" onPress={onEditPayee} />
        </Card>
      ) : (
        <Card tone="danger">
          <CardTitle>Check the payee settings</CardTitle>
          {Object.entries(payeeIssues).map(([field, message]) => (
            <Problem key={field}>
              {field}: {message}
            </Problem>
          ))}
          <Button label="Open payee settings" onPress={onEditPayee} />
        </Card>
      )}

      <Card>
        <Field label="Amount in euro">
          <AmountInput
            value={form.amount}
            onChangeText={(amount) => setForm({ ...form, amount })}
          />
        </Field>

        <Field
          label="Remittance information"
          hint={`${remittanceKind?.hint ?? ""}. A code carries one or the other, never both.`}
        >
          <Segmented
            options={REMITTANCE_KINDS}
            value={form.remittanceKind}
            onChange={(kind) => setForm({ ...form, remittanceKind: kind })}
          />
          <Input
            value={form.remittance}
            onChangeText={(remittance) => setForm({ ...form, remittance })}
            placeholder={remittanceKind?.placeholder}
            multiline
            autoCapitalize={form.remittanceKind === "reference" ? "characters" : "sentences"}
            autoCorrect={false}
          />
        </Field>

        {formIssues.length === 0 ? null : (
          <View style={styles.issues}>
            {formIssues.map((issue) => (
              <Problem key={`${issue.element}:${issue.message}`}>
                {issue.element}: {issue.message}
              </Problem>
            ))}
          </View>
        )}
      </Card>

      {request.ok && rendered !== undefined ? (
        "error" in rendered ? (
          <Card tone="danger">
            <Problem>{rendered.error}</Problem>
          </Card>
        ) : (
          <>
            <QrCodeCard symbol={rendered.symbol} size={codeSize} />
            <Card>
              <DecodedSummary payload={request.payload} data={request.data} />
              {/* Keyed on the payload so an error from one request is not left
                  standing over the next one. */}
              <ShareRequest key={request.payload} payload={request.payload} data={request.data} />
            </Card>
          </>
        )
      ) : null}

      <Card tone="soft">
        <CardTitle>Paying someone?</CardTitle>
        <Hint>
          Read their code or shared link. The wallet shows what it says before anything else
          happens, then hands it to your banking app.
        </Hint>
        <Button label="Scan or paste a request" variant="secondary" onPress={onScan} />
      </Card>
    </Screen>
  );
}

/** The amount, large, with the currency sign fixed before it. */
function AmountInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.amount}>
      <Text
        style={[styles.amountSign, { color: value === "" ? theme.muted : theme.text }]}
        accessible={false}
        importantForAccessibility="no"
      >
        €
      </Text>
      <Input
        style={styles.amountInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Payer decides"
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoCorrect={false}
        accessibilityLabel="Amount in euro, leave empty to let the payer decide"
      />
    </View>
  );
}

/**
 * The code on a light card in both appearances: the symbol is dark modules on
 * a light ground, and a scanner needs that contrast more than the page needs
 * a matching card.
 */
function QrCodeCard({ symbol, size }: { symbol: QrSymbol; size: number }) {
  return (
    <View style={styles.codeCard}>
      <QrCode symbol={symbol} size={size} />
      <Text style={styles.codeCaption}>
        EPC QR, version {symbol.version} of {EPC069_MAX_VERSION}, error correction{" "}
        {EPC069_ERROR_CORRECTION}
      </Text>
    </View>
  );
}

/**
 * Hands the request to the share sheet of the operating system.
 *
 * What leaves the device is the link form of the payload the code carries,
 * with the decoded values above it so the message reads on its own. The wallet
 * sends nothing itself: the share sheet belongs to the system and the
 * destination is the user's choice.
 */
function ShareRequest({ payload, data }: { payload: string; data: EpcQrData }) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onShare = useCallback(async () => {
    setSharing(true);
    setError(null);
    try {
      await Share.share(
        { title: SHARE_TITLE, message: buildShareMessage(data, payload) },
        { subject: SHARE_TITLE },
      );
    } catch (cause) {
      // Android settles the promise as soon as the sheet is launched; iOS
      // settles it when the sheet closes, and a destination that fails after
      // being picked arrives here too. Whatever the platform reports is worth
      // saying out loud.
      setError(cause instanceof Error ? cause.message : "the request could not be shared");
    } finally {
      setSharing(false);
    }
  }, [payload, data]);

  return (
    <View style={styles.share}>
      <Button
        label="Share this request"
        busy={sharing}
        onPress={() => {
          void onShare();
        }}
      />
      <Hint>
        The link carries the same payload as the code, so a payer who opens it reads the request
        the code holds. Nothing is resolved over the network.
      </Hint>
      {error === null ? null : <Problem>{error}</Problem>}
    </View>
  );
}

/**
 * The decoded payload, in the invoice-style presentation the guidelines
 * recommend printing beside the code.
 */
function DecodedSummary({ payload, data }: { payload: string; data: EpcQrData }) {
  return (
    <View style={styles.summary}>
      <SectionLabel>What the code says</SectionLabel>
      <Rows rows={summarizeRequest(data)} />
      <Hint>
        EPC069-12 version {data.version}, UTF-8, {byteLength(payload, data.charset)} of{" "}
        {EPC069_MAX_BYTES} bytes.
      </Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  payeeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  payeeText: {
    flex: 1,
    gap: 4,
  },
  payeeName: {
    fontSize: 17,
    fontWeight: "600",
  },
  amount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  amountSign: {
    fontSize: 28,
    fontWeight: "600",
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: "600",
    paddingVertical: 10,
  },
  issues: {
    gap: 4,
  },
  codeCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  codeCaption: {
    fontSize: 12,
    color: "#5A6A82",
  },
  summary: {
    gap: 8,
  },
  share: {
    gap: 10,
  },
});
