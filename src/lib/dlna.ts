import { invoke } from "@tauri-apps/api/core";
import type { CurrentTrack } from "../store/player";

export interface DlnaRenderer {
  name: string;
  baseUrl: string;
  avTransportControlUrl: string;
  renderingControlUrl: string;
  supportsVolume: boolean;
}

interface ResolvedRenderer {
  name: string;
  base_url: string;
  av_transport_control_url: string;
  rendering_control_url: string;
  supports_volume: boolean;
}

// ── Discovery ──────────────────────────────────────────────────────────────

export async function discoverRenderers(timeoutMs = 4000): Promise<DlnaRenderer[]> {
  const raw = await invoke<ResolvedRenderer[]>("discover_upnp_renderers", { timeoutMs });
  return raw.map((r) => ({
    name: r.name,
    baseUrl: r.base_url,
    avTransportControlUrl: r.av_transport_control_url,
    renderingControlUrl: r.rendering_control_url,
    supportsVolume: r.supports_volume,
  }));
}

// ── SOAP helpers ───────────────────────────────────────────────────────────

async function soapAction(
  controlUrl: string,
  serviceType: string,
  action: string,
  body: string
): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  // Native fetch() is blocked by CORS for LAN UPnP devices; route through Rust.
  return invoke<string>("upnp_soap", {
    url: controlUrl,
    soapAction: `"${serviceType}#${action}"`,
    body: envelope,
  });
}

const AV_SERVICE = "urn:schemas-upnp-org:service:AVTransport:1";
const RC_SERVICE = "urn:schemas-upnp-org:service:RenderingControl:1";

function secsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timeToSecs(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + (parts[2]! || 0);
  if (parts.length === 2) return (parts[0]! * 60) + (parts[1]! || 0);
  return parts[0]! || 0;
}

function xmlTextContent(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([^<]*)<`).exec(xml);
  return m?.[1]?.trim() ?? null;
}

// ── DIDL metadata ──────────────────────────────────────────────────────────

export function buildDidlMetadata(
  track: CurrentTrack,
  streamUrl: string,
  coverArtUrl: string | null,
  transcoding = true
): string {
  const title = escapeXml(track.title);
  const artist = escapeXml(track.artist ?? "");
  const album = escapeXml(track.album ?? "");
  const duration = track.duration ? secsToTime(track.duration) : "0:00:00";
  // Only an address the renderer can fetch itself is worth sending. Canon's own art URLs
  // use the private "cover://" scheme registered inside the app, which resolves nowhere
  // else on the network, and some renderers reject the whole DIDL document over one
  // unreachable albumArtURI rather than just skipping the art.
  const artIsFetchable = !!coverArtUrl && /^https?:\/\//i.test(coverArtUrl);
  const artUri = artIsFetchable ? `<upnp:albumArtURI>${escapeXml(coverArtUrl!)}</upnp:albumArtURI>` : "";
  // Claiming audio/mpeg for a raw stream is a lie whenever the server holds FLAC, and a
  // renderer that trusts protocolInfo over sniffing then refuses the track. "*" tells it
  // to work the type out from the response instead.
  const mime = transcoding ? "audio/mpeg" : "*";

  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="1" parentID="0" restricted="1">
    <dc:title>${title}</dc:title>
    <dc:creator>${artist}</dc:creator>
    <upnp:artist>${artist}</upnp:artist>
    <upnp:album>${album}</upnp:album>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    ${artUri}
    <res duration="${duration}" protocolInfo="http-get:*:${mime}:*">${escapeXml(streamUrl)}</res>
  </item>
</DIDL-Lite>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── AVTransport actions ────────────────────────────────────────────────────

export async function setAvTransportUri(
  controlUrl: string,
  streamUrl: string,
  metadata: string
): Promise<void> {
  await soapAction(
    controlUrl,
    AV_SERVICE,
    "SetAVTransportURI",
    `<InstanceID>0</InstanceID>
     <CurrentURI>${escapeXml(streamUrl)}</CurrentURI>
     <CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`
  );
}

export async function avPlay(controlUrl: string): Promise<void> {
  await soapAction(
    controlUrl,
    AV_SERVICE,
    "Play",
    `<InstanceID>0</InstanceID><Speed>1</Speed>`
  );
}

export async function avPause(controlUrl: string): Promise<void> {
  await soapAction(
    controlUrl,
    AV_SERVICE,
    "Pause",
    `<InstanceID>0</InstanceID>`
  );
}

export async function avStop(controlUrl: string): Promise<void> {
  await soapAction(
    controlUrl,
    AV_SERVICE,
    "Stop",
    `<InstanceID>0</InstanceID>`
  );
}

export async function avSeek(controlUrl: string, seconds: number): Promise<void> {
  await soapAction(
    controlUrl,
    AV_SERVICE,
    "Seek",
    `<InstanceID>0</InstanceID>
     <Unit>REL_TIME</Unit>
     <Target>${secsToTime(seconds)}</Target>`
  );
}

export async function getPositionInfo(controlUrl: string): Promise<number> {
  const xml = await soapAction(
    controlUrl,
    AV_SERVICE,
    "GetPositionInfo",
    `<InstanceID>0</InstanceID>`
  );
  const relTime = xmlTextContent(xml, "RelTime");
  return relTime ? timeToSecs(relTime) : 0;
}

export async function getTransportInfo(controlUrl: string): Promise<string> {
  const xml = await soapAction(
    controlUrl,
    AV_SERVICE,
    "GetTransportInfo",
    `<InstanceID>0</InstanceID>`
  );
  return xmlTextContent(xml, "CurrentTransportState") ?? "UNKNOWN";
}

// ── RenderingControl actions ───────────────────────────────────────────────

export async function getVolume(controlUrl: string): Promise<number> {
  const xml = await soapAction(
    controlUrl,
    RC_SERVICE,
    "GetVolume",
    `<InstanceID>0</InstanceID><Channel>Master</Channel>`
  );
  const v = xmlTextContent(xml, "CurrentVolume");
  return v ? parseInt(v, 10) : 50;
}

export async function setVolume(controlUrl: string, volume: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(volume * 100)));
  await soapAction(
    controlUrl,
    RC_SERVICE,
    "SetVolume",
    `<InstanceID>0</InstanceID>
     <Channel>Master</Channel>
     <DesiredVolume>${clamped}</DesiredVolume>`
  );
}
