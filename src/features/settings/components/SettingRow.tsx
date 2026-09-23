interface SettingRowProps {
  title: string;
  description?: string;
  /** Live status about this setting, under its description. */
  note?: React.ReactNode;
  stacked?: boolean;
  children: React.ReactNode;
}

export function SettingRow({ title, description, note, stacked, children }: SettingRowProps) {
  return (
    <div className={`setting-row${stacked ? " setting-row--stacked" : ""}`}>
      <div className="setting-row-info">
        <span className="setting-row-title">{title}</span>
        {description && <p className="setting-row-desc">{description}</p>}
        {note}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
