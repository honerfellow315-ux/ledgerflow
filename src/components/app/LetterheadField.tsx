import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./Field";
import { analyzeLetterhead } from "@/lib/ledger/letterhead";

const MAX_LETTERHEAD_BYTES = 2 * 1024 * 1024; // 2 MB — a full-page scan is bigger than a small logo
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function LetterheadField({
  letterhead,
  marginTop,
  marginBottom,
  onChange,
  className,
}: {
  letterhead: string;
  marginTop: number;
  marginBottom: number;
  onChange: (patch: { letterhead?: string; marginTop?: number; marginBottom?: number }) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readAndAnalyze = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPG or WEBP scan/export of the letterhead.");
      return;
    }
    if (file.size > MAX_LETTERHEAD_BYTES) {
      toast.error("Letterhead file is too large — please use an image under 2 MB.");
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      const analysis = await analyzeLetterhead(dataUrl);
      onChange({
        letterhead: dataUrl,
        marginTop: analysis.marginTopMm,
        marginBottom: analysis.marginBottomMm,
      });
      setBusy(false);
      toast.success(
        analysis.imageWidth
          ? "Letterhead uploaded — content margins auto-detected, adjust below if needed."
          : "Letterhead uploaded. Couldn't auto-detect margins — please set them manually.",
      );
    };
    reader.onerror = () => {
      setBusy(false);
      toast.error("Couldn't read that file — please try again.");
    };
    reader.readAsDataURL(file);
  };

  const reanalyze = async () => {
    if (!letterhead) return;
    setBusy(true);
    const analysis = await analyzeLetterhead(letterhead);
    onChange({ marginTop: analysis.marginTopMm, marginBottom: analysis.marginBottomMm });
    setBusy(false);
  };

  const remove = () => {
    onChange({ letterhead: "", marginTop: 0, marginBottom: 0 });
    if (inputRef.current) inputRef.current.value = "";
  };

  // A4 aspect ratio preview box (210 x 297mm) with the detected safe zone
  // shaded, so the auto-adjust result is visible, not just two numbers.
  const topPct = Math.min(100, (marginTop / 297) * 100);
  const bottomPct = Math.min(100, (marginBottom / 297) * 100);

  return (
    <Field
      label="Letterhead"
      className={className}
      hint="Upload the company's pre-printed letterhead (PNG/JPG/WEBP export of the full A4 page). Invoices print directly on top of it — the logo field has been replaced by this."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          className="relative w-28 shrink-0 overflow-hidden rounded-md border border-dashed border-border bg-surface-muted/60"
          style={{ aspectRatio: "210 / 297" }}
        >
          {letterhead ? (
            <>
              <img src={letterhead} alt="Letterhead preview" className="size-full object-cover" />
              <div
                className="absolute inset-x-0 top-0 border-b-2 border-dashed border-[color:var(--color-primary,#0f5c56)] bg-[color:var(--color-primary,#0f5c56)]/10"
                style={{ height: `${topPct}%` }}
                title="Header artwork — content stays below this line"
              />
              <div
                className="absolute inset-x-0 bottom-0 border-t-2 border-dashed border-[color:var(--color-primary,#0f5c56)] bg-[color:var(--color-primary,#0f5c56)]/10"
                style={{ height: `${bottomPct}%` }}
                title="Footer artwork — content stays above this line"
              />
            </>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10px] font-medium text-muted-foreground">
              No letterhead
            </span>
          )}
        </div>

        <div className="flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? "Working…" : letterhead ? "Replace letterhead" : "Upload letterhead"}
            </Button>
            {letterhead ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={reanalyze}>
                Re-detect margins
              </Button>
            ) : null}
            {letterhead ? (
              <Button type="button" size="sm" variant="ghost" onClick={remove}>
                Remove
              </Button>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readAndAnalyze(file);
              }}
            />
          </div>

          {letterhead ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Field
                label="Content starts (mm from top)"
                htmlFor="lh-margin-top"
                className="space-y-1"
              >
                <Input
                  id="lh-margin-top"
                  type="number"
                  min={0}
                  max={150}
                  step={0.5}
                  value={marginTop}
                  onChange={(e) => onChange({ marginTop: Number(e.target.value) || 0 })}
                  className="h-8 text-[13px]"
                />
              </Field>
              <Field
                label="Content ends (mm from bottom)"
                htmlFor="lh-margin-bottom"
                className="space-y-1"
              >
                <Input
                  id="lh-margin-bottom"
                  type="number"
                  min={0}
                  max={150}
                  step={0.5}
                  value={marginBottom}
                  onChange={(e) => onChange({ marginBottom: Number(e.target.value) || 0 })}
                  className="h-8 text-[13px]"
                />
              </Field>
            </div>
          ) : null}
        </div>
      </div>
    </Field>
  );
}
