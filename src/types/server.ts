export type ServerType = "navidrome" | "jellyfin" | "plex";

export interface Server {
  id: string;
  type: ServerType;
  url: string;
  display_name: string;
  username: string;
  created_at: string;
}
