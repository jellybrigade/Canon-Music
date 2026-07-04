export type ServerType = "navidrome";

export interface Server {
  id: string;
  type: ServerType;
  url: string;
  alt_url: string | null;
  display_name: string;
  username: string;
  created_at: string;
}
