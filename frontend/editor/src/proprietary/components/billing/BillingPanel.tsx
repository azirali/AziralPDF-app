import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LocalIcon from "@app/components/shared/LocalIcon";
import {
  billingService,
  isPaymentPending,
  validCheckoutUrl,
  type BillingCatalog,
  type BillingPayment,
  type BillingPlanId,
} from "@app/services/billingService";
import {
  subscriptionService,
  type UserLicense,
} from "@app/services/subscriptionService";

export default function BillingPanel({
  publicPage = false,
}: {
  publicPage?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const returnedPayment = params.get("payment");
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [license, setLicense] = useState<UserLicense | null>(null);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [plan, setPlan] = useState<BillingPlanId>("PRO_MONTHLY");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BillingPayment | null>(null);
  const [waiting, setWaiting] = useState(false);
  const requestKeys = useRef<Partial<Record<BillingPlanId, string>>>({});
  const money = (amount: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: "KZT",
      maximumFractionDigits: 0,
    }).format(amount);
  const date = (value: string) =>
    new Date(
      /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
    ).toLocaleDateString(i18n.language);
  const load = useCallback(async () => {
    setError("");
    try {
      const data = await billingService.catalog();
      setCatalog(data);
      if (!publicPage) {
        const [history, currentLicense] = await Promise.all([
          billingService.history(),
          subscriptionService.getMyLicense(),
        ]);
        setPayments(history);
        setLicense(currentLicense);
      }
    } catch {
      setError(t("aziralBilling.loadError"));
    } finally {
      setLoading(false);
    }
  }, [publicPage, t]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (publicPage || !returnedPayment) return;
    if (!/^[a-f0-9-]{36}$/.test(returnedPayment)) {
      setError(t("aziralBilling.invalidPayment"));
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setWaiting(true);
    const check = async () => {
      try {
        const payment = await billingService.payment(returnedPayment);
        if (!active) return;
        setResult(payment);
        if (isPaymentPending(payment.status) && ++attempts < 12)
          timer = setTimeout(() => {
            void check();
          }, 5000);
        else {
          setWaiting(false);
          if (!isPaymentPending(payment.status)) await load();
        }
      } catch {
        if (active) {
          setError(t("aziralBilling.statusError"));
          setWaiting(false);
        }
      }
    };
    void check();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [publicPage, returnedPayment, load, t]);

  const redirect = (url: string) => {
    if (!validCheckoutUrl(url)) throw new Error("Invalid payment destination");
    window.location.assign(url);
  };
  const pay = async () => {
    if (!catalog || !accepted || paying) return;
    setPaying(true);
    setError("");
    try {
      const requestKey = requestKeys.current[plan] ?? crypto.randomUUID();
      requestKeys.current[plan] = requestKey;
      const payment = await billingService.checkout(
        plan,
        requestKey,
        catalog.termsVersion,
      );
      if (payment.checkoutUrl) redirect(payment.checkoutUrl);
      else if (payment.status === "FAILED") {
        delete requestKeys.current[plan];
        setError(t("aziralBilling.paymentFailed"));
      } else {
        setResult(payment);
        await load();
      }
    } catch {
      setError(t("aziralBilling.checkoutError"));
    } finally {
      setPaying(false);
    }
  };

  if (loading)
    return (
      <Group role="status">
        <Loader size="sm" />
        <Text>{t("aziralBilling.loading")}</Text>
      </Group>
    );
  if (!catalog)
    return (
      <Alert color="red">
        <Stack>
          <Text>{error}</Text>
          <Button variant="light" onClick={() => void load()}>
            {t("aziralBilling.retry")}
          </Button>
        </Stack>
      </Alert>
    );
  const selected = catalog.plans.find((offer) => offer.id === plan);
  const permanent =
    license?.tier === "ENTERPRISE" ||
    (license?.tier === "PRO" && !license.expiresAt);
  const currentPending = payments.find((payment) =>
    isPaymentPending(payment.status),
  );
  const period = t(
    plan === "PRO_YEARLY" ? "aziralBilling.year" : "aziralBilling.month",
  );
  return (
    <Stack gap="xl">
      <Stack gap={6}>
        <Title order={publicPage ? 1 : 2}>{t("aziralBilling.title")}</Title>
        <Text c="dimmed">{t("aziralBilling.subtitle")}</Text>
        {!publicPage && license && (
          <Group gap="sm">
            <Badge variant="light">{license.tier}</Badge>
            <Text size="sm">
              {license.expiresAt
                ? t("aziralBilling.activeUntil", {
                    date: date(license.expiresAt),
                  })
                : t("aziralBilling.currentPlan")}
            </Text>
          </Group>
        )}
      </Stack>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {result && (
        <Alert
          color={
            result.status === "PAID"
              ? "green"
              : result.status === "FAILED"
                ? "red"
                : "blue"
          }
          role="status"
        >
          <Group>
            {waiting && <Loader size="xs" />}
            <Text size="sm">{t(`aziralBilling.result.${result.status}`)}</Text>
          </Group>
          {result.accessUntil && (
            <Text size="sm">
              {t("aziralBilling.activeUntil", {
                date: date(result.accessUntil),
              })}
            </Text>
          )}
        </Alert>
      )}
      {!catalog.checkoutEnabled && (
        <Alert color="blue">{t("aziralBilling.notConnected")}</Alert>
      )}
      {catalog.checkoutEnabled && catalog.testMode && (
        <Alert color="yellow">{t("aziralBilling.testMode")}</Alert>
      )}
      <SegmentedControl
        value={plan}
        onChange={(value) => {
          setPlan(value as BillingPlanId);
          setAccepted(false);
        }}
        fullWidth
        aria-label={t("aziralBilling.periodLabel")}
        data={[
          { value: "PRO_MONTHLY", label: t("aziralBilling.monthly") },
          { value: "PRO_YEARLY", label: t("aziralBilling.yearly") },
        ]}
      />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Paper withBorder radius="md" p="lg">
          <Stack h="100%" gap="md">
            <Title order={3}>Free</Title>
            <Text size="2rem" fw={700}>
              {money(0)}
            </Text>
            <Text>
              {catalog.freeDailyLimit > 0
                ? t("aziralBilling.freeLimit", {
                    count: catalog.freeDailyLimit,
                  })
                : t("aziralBilling.noDailyLimit")}
            </Text>
            <Text c="dimmed" size="sm">
              {t("aziralBilling.freeFeatures")}
            </Text>
            <div style={{ flex: 1 }} />
            {publicPage ? (
              <Button component={Link} to="/" variant="default" mih={44}>
                {t("aziralBilling.openTools")}
              </Button>
            ) : (
              <Badge variant="light" color="gray">
                {t("aziralBilling.alwaysFree")}
              </Badge>
            )}
          </Stack>
        </Paper>
        <Paper
          withBorder
          radius="md"
          p="lg"
          style={{ borderColor: "var(--mantine-color-blue-6)", borderWidth: 2 }}
        >
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={3}>Pro</Title>
              {plan === "PRO_YEARLY" &&
                selected?.amount ===
                  (catalog.plans.find((offer) => offer.id === "PRO_MONTHLY")
                    ?.amount ?? 0) *
                    10 && <Badge>{t("aziralBilling.twoMonths")}</Badge>}
            </Group>
            <Group gap="xs" align="baseline">
              <Text size="2rem" fw={700}>
                {selected ? money(selected.amount) : "—"}
              </Text>
              <Text c="dimmed">/ {period}</Text>
            </Group>
            <Group gap="xs">
              <span aria-hidden="true">
                <LocalIcon icon="check-circle-rounded" />
              </span>
              <Text>{t("aziralBilling.noDailyLimit")}</Text>
            </Group>
            <Text size="sm" c="dimmed">
              {t("aziralBilling.proFeatures")}
            </Text>
            <Divider />
            <Text size="sm">{t("aziralBilling.prepaid")}</Text>
            {catalog.applePayEnabled && (
              <Text size="sm">{t("aziralBilling.applePay")}</Text>
            )}
            {publicPage ? (
              <Button component={Link} to="/settings/plan" mih={44}>
                {t("aziralBilling.choosePro")}
              </Button>
            ) : (
              <>
                <Checkbox
                  checked={accepted}
                  onChange={(event) => setAccepted(event.currentTarget.checked)}
                  disabled={permanent || !catalog.checkoutEnabled}
                  label={
                    <Text size="sm">
                      {t("aziralBilling.acceptTerms")}{" "}
                      <Anchor
                        href={catalog.termsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("aziralBilling.offer")}
                      </Anchor>
                    </Text>
                  }
                />
                <Button
                  mih={44}
                  loading={paying}
                  disabled={
                    !catalog.checkoutEnabled ||
                    !accepted ||
                    permanent ||
                    !selected
                  }
                  onClick={() => void pay()}
                >
                  {permanent
                    ? t("aziralBilling.accessIncluded")
                    : t("aziralBilling.pay", {
                        amount: selected ? money(selected.amount) : "",
                        period,
                      })}
                </Button>
              </>
            )}
            <Text c="dimmed" size="xs">
              {t("aziralBilling.provider", {
                provider:
                  catalog.provider === "HALYK_EPAY"
                    ? "Halyk ePay"
                    : "Freedom Pay",
              })}
            </Text>
          </Stack>
        </Paper>
      </SimpleGrid>
      {!publicPage && currentPending?.checkoutUrl && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between">
            <Text size="sm">{t("aziralBilling.pending")}</Text>
            <Button
              variant="light"
              mih={44}
              onClick={() => {
                try {
                  redirect(currentPending.checkoutUrl!);
                } catch {
                  setError(t("aziralBilling.checkoutError"));
                }
              }}
            >
              {t("aziralBilling.resume")}
            </Button>
          </Group>
        </Paper>
      )}
      {!publicPage && payments.length > 0 && (
        <Stack gap="sm">
          <Title order={3}>{t("aziralBilling.history")}</Title>
          {payments.map((payment) => (
            <Paper withBorder key={payment.id} p="md" radius="sm">
              <Group justify="space-between" gap="sm">
                <Stack gap={2}>
                  <Text fw={600}>{money(payment.amount)} · Pro</Text>
                  <Text c="dimmed" size="sm">
                    {date(payment.createdAt)} ·{" "}
                    {t(
                      payment.plan === "PRO_YEARLY"
                        ? "aziralBilling.yearly"
                        : "aziralBilling.monthly",
                    )}
                  </Text>
                </Stack>
                <Badge
                  variant="light"
                  color={
                    payment.status === "PAID"
                      ? "green"
                      : payment.status === "FAILED"
                        ? "red"
                        : "blue"
                  }
                >
                  {t(`aziralBilling.status.${payment.status}`)}
                </Badge>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      <Group gap="lg">
        <Anchor
          href={catalog.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
        >
          {t("aziralBilling.offer")}
        </Anchor>
        <Anchor href="mailto:sales@aziral.com" size="sm">
          {t("aziralBilling.teamContact")}
        </Anchor>
        <Anchor
          href={catalog.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
        >
          {t("aziralBilling.privacy")}
        </Anchor>
        <Text c="dimmed" size="sm">
          {t("aziralBilling.merchant")}
        </Text>
      </Group>
    </Stack>
  );
}
