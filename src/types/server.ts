export type ServerType = "navidrome" | "jellyfin" | "plex";

export interface Server {
  id: string;
  type: ServerType;
  url: string;
  display_name: string;
  username: string;
  created_at: string;
  sidecar_url: string | null;
  sidecar_secret_key: string | null;
  sidecar_path_prefix_from: string | null;
  sidecar_path_prefix_to: string | null;
}
