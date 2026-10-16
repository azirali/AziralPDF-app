import { useTranslation } from "react-i18next";
/**
 * Loading fallback component for i18next suspense
 */
export function LoadingFallback() {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        fontSize: "18px",
        color: "#666",
      }}
    >
      {t("ui.loading")}
    </div>
  );
}
