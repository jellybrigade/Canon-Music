import { invoke } from "@tauri-apps/api/core";
import type { CurrentTrack } from "./player";
import type { DlnaRenderer } from "../lib/dlna";
import {
  buildDidlMetadata,
  setAvTransportUri,
  avPlay,
  avPause,
  avStop,
  avSeek,
  getPositionInfo,
  getTransportInfo,
  setVolume as dlnaSetVolume,
} from "../lib/dlna";

// How often DlnaTarget re-checks the renderer's transport state once the track is expected to
// have finished, and how often it checks when the track's duration is unknown so there is no
// expected finish time to aim at.
const DLNA_TRACK_END_POLL_MS = 2000;
const DLNA_UNKNOWN_DURATION_POLL_MS = 5000;

// How many consecutive SOAP failures against the renderer are tolerated before the target
// gives up and reports an error. One failure is not enough to conclude anything: since
// upnp_soap started returning Err on SOAP faults, a single transient fault (or a renderer
// briefly busy mid-transition) reaches here, and treating that as "the track ended" or
// "the device is gone" would skip a track or drop the session for no reason.
const DLNA_MAX_CONSECUTIVE_FAILURES = 3;

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
  readonly supportsGapless = true;

  async load(url: string): Promise<void> {
    await invoke("audio_play", { url });
  }

  pause(fadeMs = 150): void {
    void invoke("audio_pause", { fadeMs }).catch(() => {});
  }

  resume(fadeMs = 150): void {
    void invoke("audio_resume", { fadeMs }).catch(() => {});
  }

  stop(): void {
    void invoke("audio_stop").catch(() => {});
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
    void invoke("audio_stop").catch(() => {});
  }
}

// ── DLNA (UPnP AVTransport) target ────────────────────────────────────────

export class DlnaTarget implements PlaybackTarget {
  readonly supportsVolume: boolean;
  // The renderer, not Canon, owns the gap between tracks, and Canon cannot see the
  // renderer cross it: its only end signal is a GetTransportInfo poll, which reads
  // PLAYING straight through a SetNext-driven transition. Handing the next URI over
  // therefore leaves the UI a whole track behind and plays that track twice. Every
  // transition goes through load() instead.
  readonly supportsGapless = false;

  private renderer: DlnaRenderer;
  private castMaxBitrate: number;
  private positionSeconds = 0;
  private positionUpdatedAt = 0;
  private currentDuration = 0;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private trackEndTimer: ReturnType<typeof setTimeout> | null = null;
  private onTrackEnd: (() => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private consecutiveFailures = 0;
  private playing = false;

  constructor(
    renderer: DlnaRenderer,
    onTrackEnd: () => void,
    castMaxBitrate = 320,
    onError?: (message: string) => void
  ) {
    this.renderer = renderer;
    this.supportsVolume = renderer.supportsVolume;
    this.onTrackEnd = onTrackEnd;
    this.castMaxBitrate = castMaxBitrate;
    this.onError = onError ?? null;
  }

  private rewriteUrl(url: string): string {
    try {
      const u = new URL(url);
      if (this.castMaxBitrate <= 0) {
        // "Raw (original)" has to actually be raw. The URL arrives carrying whatever
        // maxBitRate the local player asked for, and leaving it in place would keep the
        // server transcoding for the renderer too.
        u.searchParams.delete("maxBitRate");
        u.searchParams.delete("format");
      } else {
        u.searchParams.set("maxBitRate", String(this.castMaxBitrate));
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  // A renderer call succeeded: whatever went wrong before was transient.
  private noteSuccess() {
    this.consecutiveFailures = 0;
  }

  // Returns true once the failure run is long enough to call the renderer lost.
  private noteFailure(context: string, e: unknown): boolean {
    this.consecutiveFailures++;
    if (this.consecutiveFailures < DLNA_MAX_CONSECUTIVE_FAILURES) return false;
    this.onError?.(`${context}: ${e instanceof Error ? e.message : String(e)}`);
    return true;
  }

  async load(url: string, track: CurrentTrack, coverArtUrl: string | null): Promise<void> {
    this.clearTimers();
    const castUrl = this.rewriteUrl(url);
    const metadata = buildDidlMetadata(track, castUrl, coverArtUrl, this.castMaxBitrate > 0);
    await setAvTransportUri(this.renderer.avTransportControlUrl, castUrl, metadata);
    await avPlay(this.renderer.avTransportControlUrl);
    this.noteSuccess();
    this.playing = true;
    this.positionSeconds = 0;
    this.positionUpdatedAt = Date.now();
    this.currentDuration = track.duration ?? 0;
    this.scheduleReconcile(2000);
    // Armed even when duration is unknown; scheduleTrackEndTimer falls back to slow polling.
    this.scheduleTrackEndTimer(this.currentDuration);
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
    // pause() cleared the track-end timer along with the reconcile timer. Without
    // rearming it here the track never auto-advances after a pause, and there is no
    // fallback: the natural-end check in the elapsed ticker is skipped for cast targets.
    this.scheduleTrackEndTimer(this.currentDuration);
  }

  stop(): void {
    this.playing = false;
    this.clearTimers();
    void avStop(this.renderer.avTransportControlUrl).catch(() => {});
  }

  async seek(seconds: number): Promise<void> {
    await avSeek(this.renderer.avTransportControlUrl, seconds);
    this.noteSuccess();
    this.positionSeconds = seconds;
    this.positionUpdatedAt = Date.now();
    if (this.playing) {
      this.scheduleReconcile(3000);
      // The armed end-of-track timer was aimed at the pre-seek position. Seeking forward
      // leaves it firing far too late (silence until the stale delay expires); seeking
      // backwards leaves it firing while the track still has minutes to run. Re-aim it.
      this.scheduleTrackEndTimer(this.currentDuration);
    }
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

  // Deliberately a no-op: see supportsGapless above. The ticker in player.ts skips this
  // for cast targets, and the method only stays to satisfy the PlaybackTarget interface.
  async setNext(): Promise<void> {}

  teardown(): void {
    this.playing = false;
    this.clearTimers();
    this.onTrackEnd = null;
    this.onError = null;
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
        this.noteSuccess();
      } catch (e) {
        // A single SOAP failure is transient, keep interpolating. A run of them means the
        // renderer is gone, and silently interpolating against a dead device would leave
        // the UI counting up over silence forever.
        if (this.noteFailure("Renderer stopped responding", e)) {
          this.playing = false;
          this.clearTimers();
          return;
        }
      }
      if (this.playing) this.scheduleReconcile(5000);
    }, delayMs);
  }

  // Arms a transport-state poll that keeps checking until the renderer reports it is done.
  // A duration of 0 (track metadata without a length) still gets polled, just from the start
  // and at a slower interval, because a cast target has no other end-of-track signal: the
  // elapsed ticker's position-based fallback in player.ts is skipped for cast devices.
  private scheduleTrackEndTimer(durationSeconds: number) {
    if (this.trackEndTimer) clearTimeout(this.trackEndTimer);
    const known = durationSeconds > 0;
    const delay = known
      ? Math.max(0, durationSeconds - this.positionSeconds - 1) * 1000
      : DLNA_UNKNOWN_DURATION_POLL_MS;
    const retryMs = known ? DLNA_TRACK_END_POLL_MS : DLNA_UNKNOWN_DURATION_POLL_MS;
    const poll = async () => {
      this.trackEndTimer = null;
      if (!this.playing) return;
      // Confirm via GetTransportInfo that we're actually done.
      let state: string;
      try {
        state = await getTransportInfo(this.renderer.avTransportControlUrl);
        this.noteSuccess();
      } catch (e) {
        // Not reaching the renderer once is not evidence the track ended: a SOAP fault or
        // a renderer busy mid-transition lands here too, and advancing on it skips a track
        // that is still playing. Only a sustained run means the device is really gone, and
        // that is an error to show, not a cue to advance into another failing load().
        if (this.noteFailure("Lost contact with the renderer", e)) {
          this.playing = false;
          this.clearTimers();
          return;
        }
        this.trackEndTimer = setTimeout(() => void poll(), retryMs);
        return;
      }
      if (state === "STOPPED" || state === "NO_MEDIA_PRESENT") {
        this.onTrackEnd?.();
        return;
      }
      // Still playing. Keep polling: a single retry left the queue stranded on the finished
      // track whenever the renderer ran even slightly past our duration estimate.
      if (!this.playing) return;
      this.trackEndTimer = setTimeout(() => void poll(), retryMs);
    };
    this.trackEndTimer = setTimeout(() => void poll(), delay);
  }

  private clearTimers() {
    if (this.reconcileTimer) { clearTimeout(this.reconcileTimer); this.reconcileTimer = null; }
    if (this.trackEndTimer) { clearTimeout(this.trackEndTimer); this.trackEndTimer = null; }
  }
}
