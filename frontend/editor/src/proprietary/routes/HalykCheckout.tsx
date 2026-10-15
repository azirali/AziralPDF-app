import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  billingService,
  validHalykScriptUrl,
} from "@app/services/billingService";

interface HalykWindow extends Window {
  halyk?: { pay: (payment: Record<string, unknown>) => void };
}

export default function HalykCheckout() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = useRef(false);

  async function openBank() {
    if (!id || running.current) return;
    running.current = true;
    setBusy(true);
    setError(false);
    try {
      const session = await billingService.halykSession(id);
      if (!validHalykScriptUrl(session.scriptUrl))
        throw new Error("Invalid bank script");
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = session.scriptUrl;
        script.async = true;
        const timeout = window.setTimeout(() => {
          script.remove();
          reject(new Error("Bank page timed out"));
        }, 20000);
        script.onload = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        script.onerror = () => {
          window.clearTimeout(timeout);
          script.remove();
          reject(new Error("Bank unavailable"));
        };
        document.head.appendChild(script);
      });
      const bank = (window as HalykWindow).halyk;
      if (!bank) throw new Error("Bank unavailable");
      bank.pay(session.payment);
    } catch {
      setError(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Container size="sm" py="xl">
      <Paper p="xl" radius="lg" withBorder>
        <Stack>
          <Title order={1}>{t("aziralBilling.bankCheckoutTitle")}</Title>
          <Text>{t("aziralBilling.bankCheckoutDescription")}</Text>
          {error && (
            <Alert color="red" role="alert">
              {t("aziralBilling.checkoutError")}
            </Alert>
          )}
          <Button
            size="md"
            mih={44}
            loading={busy}
            disabled={!id}
            onClick={openBank}
          >
            {busy
              ? t("aziralBilling.bankCheckoutLoading")
              : t("aziralBilling.bankCheckoutButton")}
          </Button>
          <Button
            component={Link}
            to="/settings/plan"
            variant="subtle"
            mih={44}
          >
            {t("aziralBilling.managePlan")}
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
