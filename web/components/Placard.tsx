// Quiet museum placard header used on every panel: a small-caps, letter-spaced
// title with a gold tick, plus a one-line "what am I looking at" subtitle.
export default function Placard({
  title,
  subtitle,
  right,
  className = "",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-3 flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <span className="placard">{title}</span>
        {subtitle && (
          <p className="mt-1.5 text-[11px] leading-tight text-faint">{subtitle}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
