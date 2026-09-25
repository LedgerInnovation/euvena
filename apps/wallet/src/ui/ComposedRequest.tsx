import { useCallback, useMemo, useState } from "react";
import { Share, StyleSheet, View, useWindowDimensions } from "react-native";
import { EPC069_MAX_BYTES, byteLength, type EpcQrData } from "@euvena/qr";

import { buildShareMessage } from "../epc/link";
import { summarizeRequest } from "../epc/request";
import { useLocale } from "../i18n/context";
import {
  EPC069_ERROR_CORRECTION,
  EPC069_MAX_VERSION,
  toQrSymbol,
  type QrSymbol,
} from "../qr/symbol";
import { Button, Card, Hint, Problem, Rows, SectionLabel, TextAction } from "./kit";
import { QrCode } from "./QrCode";

type SymbolResult = { symbol: QrSymbol } | { error: true };

function buildSymbol(payload: string): SymbolResult {
  try {
    return { symbol: toQrSymbol(payload) };
  } catch {
    return { error: true };
  }
}

interface ComposedRequestProps {
  payload: string;
  data: EpcQrData;
  /**
   * Keeps the request in the history. Called when it is shared, or from the
   * Keep action, which is only offered when this is given. Rejects when the
   * history could not be written. Absent for a request that is already in the
   * history, so re-sharing it does not add it again.
   */
  onKeep?: ((payload: string) => Promise<void>) | undefined;
  /**
   * Shows the decoded values behind a toggle. The request screen uses this,
   * since the form the values came from is right above; the history shows
   * them open, since there the code is all there is.
   */
  compact?: boolean | undefined;
}

/**
 * A request as it is presented: the code, the values decoded back out of its
 * payload and the share action. The request screen shows the request it is
 * composing this way, and the history shows a kept one the same way, so what
 * is re-shared later is exactly what was shown at the time.
 */
export function ComposedRequest({ payload, data, onKeep, compact = false }: ComposedRequestProps) {
  const { width } = useWindowDimensions();
  const { strings } = useLocale();
  const rendered = useMemo(() => buildSymbol(payload), [payload]);
  const codeSize = Math.min(width - 104, 280);

  if ("error" in rendered) {
    return (
      <Card tone="danger">
        <Problem>{strings.composed.renderFailed}</Problem>
      </Card>
    );
  }

  return (
    <>
      <QrCodeCard symbol={rendered.symbol} size={codeSize} />
      <Card>
        {/* Keyed on the payload so an error from one request is not left
            standing over the next one. */}
        <ShareRequest key={payload} payload={payload} data={data} onKeep={onKeep} />
        <DecodedSummary payload={payload} data={data} symbol={rendered.symbol} compact={compact} />
      </Card>
    </>
  );
}

/**
 * The code on a light card in both appearances: the symbol is dark modules on
 * a light ground, and a scanner needs that contrast more than the page needs
 * a matching card.
 */
function QrCodeCard({ symbol, size }: { symbol: QrSymbol; size: number }) {
  // The symbol's own figures are read out with the decoded values below the
  // code, so the card holds nothing but the code.
  return (
    <View style={styles.codeCard}>
      <QrCode symbol={symbol} size={size} />
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
function ShareRequest({
  payload,
  data,
  onKeep,
}: {
  payload: string;
  data: EpcQrData;
  onKeep: ((payload: string) => Promise<void>) | undefined;
}) {
  const { strings, tag } = useLocale();
  const [sharing, setSharing] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState(false);
  // A failure is kept as what happened and worded when shown, so a language
  // switch re-words it. A message from the platform is kept as it came.
  const [error, setError] = useState<"keep" | { message: string } | null>(null);

  const keep = useCallback(async () => {
    if (onKeep === undefined) return;
    setKeeping(true);
    setError(null);
    try {
      await onKeep(payload);
      setKept(true);
    } catch {
      setError("keep");
    } finally {
      setKeeping(false);
    }
  }, [onKeep, payload]);

  const onShare = useCallback(async () => {
    setSharing(true);
    setError(null);
    try {
      // The title is offered to destinations that have a subject, such as
      // mail. Android reads it from the content title and iOS from the
      // subject option, so it is passed as both.
      const title = strings.composed.shareTitle;
      const result = await Share.share(
        { title, message: buildShareMessage(data, payload, strings, tag) },
        { subject: title },
      );
      // iOS reports a sheet closed without a destination; Android settles as
      // soon as the sheet is launched and always reports it as shared. A
      // request that went nowhere is not kept.
      if (result.action !== Share.dismissedAction) await keep();
    } catch (cause) {
      // Android settles the promise as soon as the sheet is launched; iOS
      // settles it when the sheet closes, and a destination that fails after
      // being picked arrives here too. Whatever the platform reports is worth
      // saying out loud.
      setError({ message: cause instanceof Error ? cause.message : "" });
    } finally {
      setSharing(false);
    }
  }, [payload, data, keep, strings, tag]);

  return (
    <View style={styles.share}>
      <Button
        label={strings.composed.share}
        busy={sharing}
        onPress={() => {
          void onShare();
        }}
      />
      {onKeep === undefined ? null : (
        <Button
          label={kept ? strings.composed.kept : strings.composed.keep}
          variant="ghost"
          disabled={kept}
          busy={keeping}
          onPress={() => {
            void keep();
          }}
        />
      )}
      <Hint>
        {strings.composed.shareHint}
        {onKeep === undefined ? "" : ` ${strings.composed.sharedIsKept}`}
      </Hint>
      {error === null ? null : (
        <Problem>
          {error === "keep"
            ? strings.composed.keepFailed
            : error.message === ""
              ? strings.composed.shareFailed
              : error.message}
        </Problem>
      )}
    </View>
  );
}

/**
 * The decoded payload, in the invoice-style presentation the guidelines
 * recommend printing beside the code.
 */
function DecodedSummary({
  payload,
  data,
  symbol,
  compact,
}: {
  payload: string;
  data: EpcQrData;
  symbol: QrSymbol;
  compact: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const { strings, tag } = useLocale();
  if (!open) {
    return (
      <TextAction
        label={strings.composed.showDetails}
        onPress={() => setOpen(true)}
        accessibilityLabel={strings.composed.showDetailsA11y}
      />
    );
  }
  return (
    <View style={styles.summary}>
      <SectionLabel>{strings.composed.whatTheCodeSays}</SectionLabel>
      <Rows rows={summarizeRequest(data, strings, tag)} />
      <Hint>
        {strings.composed.figures({
          version: data.version,
          bytes: byteLength(payload, data.charset),
          maxBytes: EPC069_MAX_BYTES,
          qrVersion: symbol.version,
          maxQrVersion: EPC069_MAX_VERSION,
          correction: EPC069_ERROR_CORRECTION,
        })}
      </Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  summary: {
    gap: 8,
  },
  share: {
    gap: 10,
  },
});
