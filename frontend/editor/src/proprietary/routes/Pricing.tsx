import { Anchor, Container, Group, ScrollArea } from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BillingPanel from "@app/components/billing/BillingPanel";

export default function Pricing() {
  const { t } = useTranslation();
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
