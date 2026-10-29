import type { ComponentProps } from "react";
import { useCoverUrl } from "../hooks/useCoverRevisions";

/** Every image goes through here, so a chosen album cover reaches URLs built before it was chosen. */
export function CoverImg({ src, alt, ...props }: ComponentProps<"img">) {
  return <img src={useCoverUrl(src)} alt={alt} {...props} />;
}
