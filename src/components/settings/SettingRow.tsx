interface SettingRowProps {
  title: string;
  description?: string;
  stacked?: boolean;
  children: React.ReactNode;
}

export function SettingRow({ title, description, stacked, children }: SettingRowProps) {
  return (
    <div className={`setting-row${stacked ? " setting-row--stacked" : ""}`}>
      <div className="setting-row-info">
        <span className="setting-row-title">{title}</span>
        {description && <p className="setting-row-desc">{description}</p>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
