/**
 * Clinical diagnosis line: human-readable text with optional ICD-10 (middle dot, muted).
 */
export function DiagnosisWithIcd({
  text,
  icd10,
  className,
}: {
  text: string;
  icd10?: string | null;
  className?: string;
}) {
  const t = text.trim();
  const code = icd10?.trim();
  const showIcd = Boolean(code && t !== "" && t !== "—");
  return (
    <span className={className}>
      <span className="font-normal text-inherit">{t}</span>
      {showIcd ? <span className="ml-1 text-xs text-gray-400">· {code}</span> : null}
    </span>
  );
}
