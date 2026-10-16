import { Button, Text, Group, Divider } from "@mantine/core";
import { useTranslation } from "react-i18next";
import classes from "@app/components/pageEditor/bulkSelectionPanel/BulkSelectionPanel.module.css";
import { LogicalOperator } from "@app/utils/bulkselection/selectionBuilders";

interface OperatorsSectionProps {
  csvInput: string;
  onInsertOperator: (op: LogicalOperator) => void;
}

const OperatorsSection = ({
  csvInput,
  onInsertOperator,
}: OperatorsSectionProps) => {
  const { t } = useTranslation();

  return (
    <div>
      <Text size="xs" c="var(--text-muted)" fw={500} mb="xs">
        {t("bulkSelection.keywords.title", "Keywords")}:
      </Text>
      <Group gap="sm" wrap="nowrap">
        <Button
          size="sm"
          variant="outline"
          className={classes.operatorChip}
          onClick={() => onInsertOperator("and")}
          disabled={!csvInput.trim()}
          title={t("ui.combineSelectionsBothConditionsMustBeTrue")}
        >
          <Text size="xs" fw={500}>
            {t("ui.and")}
          </Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={classes.operatorChip}
          onClick={() => onInsertOperator("or")}
          disabled={!csvInput.trim()}
          title={t("ui.addToSelectionEitherConditionCanBeTrue")}
        >
          <Text size="xs" fw={500}>
            or
          </Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={classes.operatorChip}
          onClick={() => onInsertOperator("not")}
          disabled={!csvInput.trim()}
          title={t("ui.excludeFromSelection")}
        >
          <Text size="xs" fw={500}>
            {t("ui.not")}
          </Text>
        </Button>
      </Group>
      <Divider my="sm" />
      <Group gap="sm" wrap="nowrap">
        <Button
          size="sm"
          variant="outline"
          className={classes.operatorChip}
          onClick={() => onInsertOperator("even")}
          title={t("ui.selectAllEvenNumberedPages2468")}
        >
          <Text size="xs" fw={500}>
            {t("ui.even")}
          </Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={classes.operatorChip}
          onClick={() => onInsertOperator("odd")}
          title={t("ui.selectAllOddNumberedPages1357")}
        >
          <Text size="xs" fw={500}>
            {t("ui.odd")}
          </Text>
        </Button>
      </Group>
    </div>
  );
};

export default OperatorsSection;
