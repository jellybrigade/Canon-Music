import { invoke } from "@tauri-apps/api/core";
import type { CurrentTrack } from "../store/player";

export interface DlnaRenderer {
  name: string;
  baseUrl: string;
  avTransportControlUrl: string;
  renderingControlUrl: string;
  supportsVolume: boolean;
  supportsSetNext: boolean;
}

interface RawRenderer {
  location: string;
  usn: string;
  server: string;
}

// ── Discovery ──────────────────────────────────────────────────────────────

export async function discoverRenderers(timeoutMs = 4000): Promise<DlnaRenderer[]> {
  const raw = await invoke<RawRenderer[]>("discover_upnp_renderers", { timeoutMs });
  const results: DlnaRenderer[] = [];
  await Promise.all(
    raw.map(async (r) => {
      const renderer = await fetchDeviceDescription(r.location);
      if (renderer) results.push(renderer);
    })
  );
  return results;
}

async function fetchDeviceDescription(location: string): Promise<DlnaRenderer | null> {
  try {
    const res = await fetch(location);
    if (!res.ok) return null;
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    const base = resolveBase(location, doc);

    const friendlyName =
      doc.querySelector("device > friendlyName")?.textContent?.trim() ?? location;

    const avTransportControlUrl = findControlUrl(doc, "AVTransport", base);
    if (!avTransportControlUrl) return null;

    const renderingControlUrl = findControlUrl(doc, "RenderingControl", base);

    return {
      name: friendlyName,
      baseUrl: base,
      avTransportControlUrl,
      renderingControlUrl: renderingControlUrl ?? "",
      supportsVolume: !!renderingControlUrl,
      // We assume support and disable on first 501/optionally 500.
      supportsSetNext: true,
    };
  } catch {
    return null;
  }
}

function resolveBase(location: string, doc: Document): string {
  const urlBase = doc.querySelector("URLBase")?.textContent?.trim();
  if (urlBase) return urlBase.replace(/\/$/, "");
  try {
    const u = new URL(location);
    return `${u.protocol}//${u.host}`;
  } catch {
    return location;
  }
}

function findControlUrl(doc: Document, serviceType: string, base: string): string | null {
  const services = doc.querySelectorAll("service");
  for (const svc of Array.from(services)) {
    const type = svc.querySelector("serviceType")?.textContent ?? "";
    if (type.includes(serviceType)) {
      const controlUrl = svc.querySelector("controlURL")?.textContent?.trim() ?? "";
      if (!controlUrl) continue;
      if (controlUrl.startsWith("http")) return controlUrl;
      return `${base}${controlUrl.startsWith("/") ? "" : "/"}${controlUrl}`;
    }
  }
  return null;
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

  const res = await fetch(controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${serviceType}#${action}"`,
    },
    body: envelope,
  });
  if (!res.ok && res.status !== 500) {
    throw new Error(`SOAP ${action} failed: ${res.status}`);
  }
  return res.text();
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
  coverArtUrl: string | null
): string {
  const title = escapeXml(track.title);
  const artist = escapeXml(track.artist ?? "");
  const album = escapeXml(track.album ?? "");
  const duration = track.duration ? secsToTime(track.duration) : "0:00:00";
  const artUri = coverArtUrl ? `<upnp:albumArtURI>${escapeXml(coverArtUrl)}</upnp:albumArtURI>` : "";

  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="1" parentID="0" restricted="1">
    <dc:title>${title}</dc:title>
    <dc:creator>${artist}</dc:creator>
    <upnp:artist>${artist}</upnp:artist>
    <upnp:album>${album}</upnp:album>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    ${artUri}
    <res duration="${duration}" protocolInfo="http-get:*:audio/mpeg:*">${escapeXml(streamUrl)}</res>
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

export async function setNextAvTransportUri(
  controlUrl: string,
  streamUrl: string,
  metadata: string
): Promise<void> {
  await soapAction(
    controlUrl,
    AV_SERVICE,
    "SetNextAVTransportURI",
    `<InstanceID>0</InstanceID>
     <NextURI>${escapeXml(streamUrl)}</NextURI>
     <NextURIMetaData>${escapeXml(metadata)}</NextURIMetaData>`
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
