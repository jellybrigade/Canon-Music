import { useDismissibleNoticeStore } from "../store/dismissibleNotice";

export function DismissibleNotice() {
  const notice = useDismissibleNoticeStore((s) => s.notice);
  const dismiss = useDismissibleNoticeStore((s) => s.dismiss);
  if (!notice) return null;
  return (
    <div className="normalizing-bar" role="status">
      {notice.message}
      <button className="normalizing-bar__dismiss" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
