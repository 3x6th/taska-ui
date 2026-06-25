export function TaskaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? "logo-compact" : ""}`}>
      <span className="logo-mark">
        <span />
      </span>
      <span className="logo-text">Taska</span>
    </div>
  );
}
