import { invoke } from "@tauri-apps/api/core";
import type { CurrentTrack } from "./player";
import type { DlnaRenderer } from "../lib/dlna";
import {
  buildDidlMetadata,
  setAvTransportUri,
  setNextAvTransportUri,
  avPlay,
  avPause,
  avStop,
  avSeek,
  getPositionInfo,
  getTransportInfo,
  setVolume as dlnaSetVolume,
} from "../lib/dlna";

// ── Interface ──────────────────────────────────────────────────────────────

export interface PlaybackTarget {
  load(url: string, track: CurrentTrack, coverArtUrl: string | null): Promise<void>;
  pause(fadeMs?: number): void;
  resume(fadeMs?: number): void;
  stop(): void;
  seek(seconds: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getPosition(): Promise<number>;
  supportsVolume: boolean;
  supportsGapless: boolean;
  setNext(url: string | null, track?: CurrentTrack, coverArtUrl?: string | null): Promise<void>;
  teardown(): void;
}

// ── Local (rodio) target ───────────────────────────────────────────────────

export class LocalTarget implements PlaybackTarget {
  readonly supportsVolume = true;
  readonly supportsGapless = false;

  async load(url: string): Promise<void> {
    await invoke("audio_play", { url });
  }

  pause(fadeMs = 150): void {
    void invoke("audio_pause", { fadeMs });
  }

  resume(fadeMs = 150): void {
    void invoke("audio_resume", { fadeMs });
  }

  stop(): void {
    void invoke("audio_stop");
  }

  async seek(seconds: number): Promise<void> {
    await invoke("audio_seek", { seconds });
  }

  async setVolume(volume: number): Promise<void> {
    await invoke("audio_volume", { volume: volume ** 2 });
  }

  async getPosition(): Promise<number> {
    return invoke<number>("audio_get_pos");
  }

  async setNext(url: string | null): Promise<void> {
    if (!url) return;
    void invoke("audio_prefetch", { url });
  }

  teardown(): void {
    void invoke("audio_stop");
  }
}

// ── DLNA (UPnP AVTransport) target ────────────────────────────────────────

export class DlnaTarget implements PlaybackTarget {
  readonly supportsVolume: boolean;
  readonly supportsGapless = true;

  private renderer: DlnaRenderer;
  private castMaxBitrate: number;
  private failedToSetNext = false;
  private positionSeconds = 0;
  private positionUpdatedAt = 0;
  private currentDuration = 0;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private trackEndTimer: ReturnType<typeof setTimeout> | null = null;
  private onTrackEnd: (() => void) | null = null;
  private playing = false;

  constructor(renderer: DlnaRenderer, onTrackEnd: () => void, castMaxBitrate = 320) {
    this.renderer = renderer;
    this.supportsVolume = renderer.supportsVolume;
    this.onTrackEnd = onTrackEnd;
    this.castMaxBitrate = castMaxBitrate;
  }

  private rewriteUrl(url: string): string {
    if (this.castMaxBitrate <= 0) return url;
    try {
      const u = new URL(url);
      u.searchParams.set("maxBitRate", String(this.castMaxBitrate));
      return u.toString();
    } catch {
      return url;
    }
  }

  async load(url: string, track: CurrentTrack, coverArtUrl: string | null): Promise<void> {
    this.clearTimers();
    const castUrl = this.rewriteUrl(url);
    const metadata = buildDidlMetadata(track, castUrl, coverArtUrl);
    await setAvTransportUri(this.renderer.avTransportControlUrl, castUrl, metadata);
    await avPlay(this.renderer.avTransportControlUrl);
    this.playing = true;
    this.positionSeconds = 0;
    this.positionUpdatedAt = Date.now();
    this.currentDuration = track.duration ?? 0;
    this.scheduleReconcile(2000);
    if (track.duration) {
      this.scheduleTrackEndTimer(track.duration);
    }
  }

  pause(): void {
    if (this.playing) {
      this.positionSeconds += (Date.now() - this.positionUpdatedAt) / 1000;
      this.positionUpdatedAt = Date.now();
    }
    this.playing = false;
    this.clearTimers();
    void avPause(this.renderer.avTransportControlUrl).catch(() => {});
  }

  resume(): void {
    this.positionUpdatedAt = Date.now();
    this.playing = true;
    void avPlay(this.renderer.avTransportControlUrl).catch(() => {});
    this.scheduleReconcile(2000);
  }

  stop(): void {
    this.playing = false;
    this.clearTimers();
    void avStop(this.renderer.avTransportControlUrl).catch(() => {});
  }

  async seek(seconds: number): Promise<void> {
    await avSeek(this.renderer.avTransportControlUrl, seconds);
    this.positionSeconds = seconds;
    this.positionUpdatedAt = Date.now();
    if (this.playing) this.scheduleReconcile(3000);
  }

  async setVolume(volume: number): Promise<void> {
    if (!this.renderer.supportsVolume) return;
    await dlnaSetVolume(this.renderer.renderingControlUrl, volume);
  }

  async getPosition(): Promise<number> {
    // Interpolate between polls for smooth elapsed display.
    if (!this.playing) return this.positionSeconds;
    const elapsed = (Date.now() - this.positionUpdatedAt) / 1000;
    return this.positionSeconds + elapsed;
  }

  async setNext(url: string | null, track?: CurrentTrack, coverArtUrl?: string | null): Promise<void> {
    if (this.failedToSetNext || !url || !track) return;
    const castUrl = this.rewriteUrl(url);
    const metadata = buildDidlMetadata(track, castUrl, coverArtUrl ?? null);
    try {
      await setNextAvTransportUri(this.renderer.avTransportControlUrl, castUrl, metadata);
      // Mark supported so gapless is used for subsequent tracks too.
      const r = { ...this.renderer };
      r.supportsSetNext = true;
      this.renderer = r;
    } catch {
      // Renderer doesn't support SetNextAVTransportURI — fall back to load() on track change.
      this.failedToSetNext = true;
      const r = { ...this.renderer };
      r.supportsSetNext = false;
      this.renderer = r;
    }
  }

  teardown(): void {
    this.playing = false;
    this.clearTimers();
    this.onTrackEnd = null;
    void avStop(this.renderer.avTransportControlUrl).catch(() => {});
  }

  // ── internals ──

  private scheduleReconcile(delayMs: number) {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(async () => {
      this.reconcileTimer = null;
      if (!this.playing) return;
      try {
        const t0 = Date.now();
        const reported = await getPositionInfo(this.renderer.avTransportControlUrl);
        const rtt = Date.now() - t0;
        const effective = reported + rtt / 2000;
        const localPos = this.positionSeconds + (Date.now() - this.positionUpdatedAt) / 1000;
        // Reject: renderer returned 0 (bad/unsupported) while we're already past 3s.
        const valid =
          (reported > 0 || localPos <= 3) &&
          (this.currentDuration <= 0 || effective < this.currentDuration + 5);
        // Only re-baseline on significant drift to avoid visible snaps.
        if (valid && Math.abs(effective - localPos) > 1.5) {
          this.positionSeconds = effective;
          this.positionUpdatedAt = Date.now();
        }
      } catch {
        // transient SOAP failure — keep interpolating
      }
      if (this.playing) this.scheduleReconcile(5000);
    }, delayMs);
  }

  private scheduleTrackEndTimer(durationSeconds: number) {
    if (this.trackEndTimer) clearTimeout(this.trackEndTimer);
    const remaining = durationSeconds - this.positionSeconds;
    const delay = Math.max(0, remaining - 1) * 1000;
    this.trackEndTimer = setTimeout(async () => {
      if (!this.playing) return;
      // Confirm via GetTransportInfo that we're actually done.
      try {
        const state = await getTransportInfo(this.renderer.avTransportControlUrl);
        if (state === "STOPPED" || state === "NO_MEDIA_PRESENT") {
          this.onTrackEnd?.();
        } else {
          // Not done yet — check again in 2s.
          this.trackEndTimer = setTimeout(async () => {
            const s2 = await getTransportInfo(this.renderer.avTransportControlUrl).catch(() => "STOPPED");
            if (s2 === "STOPPED" || s2 === "NO_MEDIA_PRESENT") {
              this.onTrackEnd?.();
            }
          }, 2000);
        }
      } catch {
        // If we can't reach the renderer, assume track ended.
        this.onTrackEnd?.();
      }
    }, delay);
  }

  private clearTimers() {
    if (this.reconcileTimer) { clearTimeout(this.reconcileTimer); this.reconcileTimer = null; }
    if (this.trackEndTimer) { clearTimeout(this.trackEndTimer); this.trackEndTimer = null; }
  }
}
