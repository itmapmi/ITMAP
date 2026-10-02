import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export default function MobileNotesCloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("common");

  return (
    <div className="shrink-0 border-t border-[#dfe8ed] p-3">
      <Button
        type="button"
        className="min-h-11 w-full rounded-none bg-[#0f1418] text-white hover:bg-[#27323a]"
        onClick={onClose}
        data-testid="mobile-close-notes"
      >
        {t("common.closeNotes")}
      </Button>
    </div>
  );
}