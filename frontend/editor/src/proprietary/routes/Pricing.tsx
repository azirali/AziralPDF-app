import { useEffect } from "react";
import apiClient from "@app/services/apiClient";
import { updateSupportedLanguages } from "@app/i18n";
import { Anchor, Container, Group, ScrollArea } from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BillingPanel from "@app/components/billing/BillingPanel";

export default function Pricing() {
  const { t } = useTranslation();
  useEffect(() => {
    let active = true;
    void apiClient
      .get<{ languages?: string[]; defaultLocale?: string }>(
        "/api/v1/proprietary/ui-data/login",
        { suppressErrorToast: true },
      )
      .then(({ data }) => {
        if (active)
          updateSupportedLanguages(data.languages, data.defaultLocale);
      })
      .catch(() => {
        // Keep the current language if public server settings are unavailable.
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <ScrollArea h="100dvh" type="auto" viewportProps={{ role: "main" }}>
      <Container size="md" py="xl">
        <Group justify="space-between" mb="xl">
          <Anchor component={Link} to="/" fw={700} size="xl">
            AziralPDF
          </Anchor>
          <Anchor component={Link} to="/login">
            {t("aziralBilling.signIn")}
          </Anchor>
        </Group>
        <BillingPanel publicPage />
      </Container>
    </ScrollArea>
  );
}
