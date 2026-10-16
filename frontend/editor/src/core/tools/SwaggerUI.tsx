import { useTranslation } from "react-i18next";
import React, { useEffect } from "react";
import { BaseToolProps } from "@app/types/tool";
import { withBasePath } from "@app/constants/app";

const SwaggerUI: React.FC<BaseToolProps> = () => {
  const { t } = useTranslation();

  useEffect(() => {
    // Redirect to Swagger UI
    window.open(withBasePath("/swagger-ui/5.21.0/index.html"), "_blank");
  }, []);

  return (
    <div style={{ textAlign: "center", padding: "2rem" }}>
      <p>{t("ui.openingSwaggerUIInANewTab")}</p>
      <p>
        {t("ui.ifItDidnTOpenAutomatically")}{" "}
        <a
          href={withBasePath("/swagger-ui/5.21.0/index.html")}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("ui.clickHere")}
        </a>
      </p>
    </div>
  );
};

export default SwaggerUI;
