export function IpdSoapBadge({
  letter,
  title,
  subtitle,
  color,
}: {
  letter: string;
  title: string;
  subtitle?: string;
  color: "blue" | "green" | "purple";
}) {
  const map = {
    blue: "bg-sky-600 dark:bg-tscolors-soap-subjective",
    green: "bg-emerald-600 dark:bg-tscolors-soap-objective",
    purple: "bg-violet-600 dark:bg-tscolors-soap-assessment",
  } as const;
  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ring-1 ring-black/10 dark:ring-white/10 ${map[color]}`}
      >
        {letter}
      </div>
      <div>
        <p className="text-sm font-bold text-foreground dark:text-white">{title}</p>
        {subtitle ? <p className="text-xs text-muted-foreground dark:text-gray-200">{subtitle}</p> : null}
      </div>
    </div>
  );
}
