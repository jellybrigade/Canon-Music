import { useId } from "react";

interface SettingRowProps {
  title: string;
  description?: string;
  /** Live status about this setting, under its description. */
  note?: React.ReactNode;
  stacked?: boolean;
  children: React.ReactNode;
}

export function SettingRow({ title, description, note, stacked, children }: SettingRowProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <div
      className={`setting-row${stacked ? " setting-row--stacked" : ""}`}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div className="setting-row-info">
        <span id={titleId} className="setting-row-title">
          {title}
        </span>
        {description && (
          <p id={descriptionId} className="setting-row-desc">
            {description}
          </p>
        )}
        {note}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
