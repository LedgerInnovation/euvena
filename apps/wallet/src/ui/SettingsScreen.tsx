import { Card, CardTitle, Header, Hint, NavRow, Screen } from "./kit";

interface SettingsScreenProps {
  /** How many payees the device holds. */
  payeeCount: number;
  /** The active payee's name, or null while there is none. */
  activeName: string | null;
  onPayees: () => void;
  onBack: () => void;
}

/**
 * Everything that is set once and kept. The request screen stays free of it;
 * settings that come later get a row here rather than a card there.
 */
export function SettingsScreen({
  payeeCount,
  activeName,
  onPayees,
  onBack,
}: SettingsScreenProps) {
  // A stored payee can lack a name, so the count stands in for one.
  const name = activeName === null || activeName === "" ? null : activeName;
  const payeeDetail =
    payeeCount === 0
      ? "None yet"
      : name === null
        ? `${payeeCount}`
        : payeeCount === 1
          ? name
          : `${name} and ${payeeCount - 1} more`;

  return (
    <Screen>
      <Header title="Settings" back={{ label: "Request", onPress: onBack }} />

      <Card>
        <NavRow label="Payees" detail={payeeDetail} onPress={onPayees} />
        <Hint>Who requests are paid to. Held on this device only.</Hint>
      </Card>

      <Card tone="soft">
        <CardTitle>About</CardTitle>
        <Hint>
          Euvena is a reference wallet for EPC069-12 payment codes. It has no accounts and no
          backend, and it never moves money: a request is handed to your banking app.
        </Hint>
      </Card>
    </Screen>
  );
}
