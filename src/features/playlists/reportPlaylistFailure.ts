import { errorMessage } from "../../lib/errorMessage";
import { useDismissibleNoticeStore } from "../../store/dismissibleNotice";

export function reportPlaylistFailure(what: string, err: unknown) {
  console.error(`${what}:`, err);
  useDismissibleNoticeStore.getState().report(`${what}: ${errorMessage(err)}`);
}
