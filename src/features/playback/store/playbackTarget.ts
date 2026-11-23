import { invoke } from "@tauri-apps/api/core";
import type { DlnaRenderer } from "../../../clients/dlna";
import {
  avPause,
  avPlay,
  avSeek,
  avStop,
  buildDidlMetadata,
  castCoverArtUrl,
  setVolume as dlnaSetVolume,
  getPositionInfo,
  getTransportInfo,
  setAvTransportUri,
} from "../../../clients/dlna";
import { errorMessage } from "../../../lib/errorMessage";
import type { CurrentTrack } from "./playerTypes";

// How often DlnaTarget re-checks the renderer's transport state once the track is expected to
// have finished, and how often it checks when the track's duration is unknown so there is no
// expected finish time to aim at.
const DLNA_TRACK_END_POLL_MS = 2000;
const DLNA_UNKNOWN_DURATION_POLL_MS = 5000;

// A single SOAP fault can be a transient blip or a renderer briefly busy mid-transition;
// treating one as "track ended" or "device gone" would skip a track or drop the session for no reason.
const DLNA_MAX_CONSECUTIVE_FAILURES = 3;

// A load that a newer load or a teardown overtook; whoever overtook it owns the player state.
export class LoadSupersededError extends Error {
  constructor() {
    super("Load superseded");
    this.name = "LoadSupersededError";
  }
}

export interface PlaybackTarget {
  load(url: string, track: CurrentTrack): Promise<void>;
  pause(fadeMs?: number): void;
  resume(fadeMs?: number): void;
  stop(): void;
  seek(seconds: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getPosition(): Promise<number>;
  supportsVolume: boolean;
  supportsGapless: boolean;
  setNext(url: string | null): Promise<void>;
  teardown(): void;
}

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
    // A missed prefetch only costs the warm start; the live path fetches the track itself.
    void invoke("audio_prefetch", { url }).catch(() => {});
  }

  teardown(): void {
    void invoke("audio_stop").catch(() => {});
  }
}

export interface DlnaTargetOptions {
  renderer: DlnaRenderer;
  onTrackEnd: () => void;
  // Read on every load(), so a bitrate changed mid-cast applies from the next track.
  readMaxBitrate: () => number;
  onError?: (message: string) => void;
}

export class DlnaTarget implements PlaybackTarget {
  readonly supportsVolume: boolean;
  // Canon's only end signal is a GetTransportInfo poll, which reads PLAYING straight through
  // a SetNext-driven transition, leaving the UI a track behind; every transition goes through load() instead.
  readonly supportsGapless = false;

  private renderer: DlnaRenderer;
  private readMaxBitrate: () => number;
  private positionSeconds = 0;
  private positionUpdatedAt = 0;
  private currentDuration = 0;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private trackEndTimer: ReturnType<typeof setTimeout> | null = null;
  private onTrackEnd: (() => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private consecutiveFailures = 0;
  private playing = false;
  // Bumped by every write that moves the position; a renderer reading started before one is stale.
  private positionEpoch = 0;
  // A renderer can still report the pre-seek time a few seconds after accepting a Seek.
  private discardNextReading = false;
  // Pause/Play go out one at a time, latest wins: parallel SOAP calls can reach the renderer
  // out of order and leave it paused after the last click said play.
  private desiredTransport: "play" | "pause" | null = null;
  private transportFlush: Promise<void> | null = null;
  private isTornDown = false;
  // Loads reach the renderer one at a time, in call order; only the newest one starts playing.
  private loadGeneration = 0;
  private loadChain: Promise<void> = Promise.resolve();

  constructor({ renderer, onTrackEnd, readMaxBitrate, onError }: DlnaTargetOptions) {
    this.renderer = renderer;
    this.supportsVolume = renderer.supportsVolume;
    this.onTrackEnd = onTrackEnd;
    this.readMaxBitrate = readMaxBitrate;
    this.onError = onError ?? null;
  }

  private rewriteUrl(url: string, maxBitrate: number): string {
    try {
      const u = new URL(url);
      if (maxBitrate <= 0) {
        // "Raw (original)" has to actually be raw. The URL arrives carrying whatever
        // maxBitRate the local player asked for, and leaving it in place would keep the
        // server transcoding for the renderer too.
        u.searchParams.delete("maxBitRate");
        u.searchParams.delete("format");
      } else {
        u.searchParams.set("maxBitRate", String(maxBitrate));
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
    this.onError?.(`${context}: ${errorMessage(e)}`);
    return true;
  }

  async load(url: string, track: CurrentTrack): Promise<void> {
    const generation = ++this.loadGeneration;
    this.clearTimers();
    this.desiredTransport = null;
    this.positionEpoch++;
    this.playing = false;
    const run = this.loadChain.then(() => this.sendLoad(generation, url, track));
    this.loadChain = run.catch(() => {});
    await run;
  }

  private isCurrentLoad(generation: number): boolean {
    return !this.isTornDown && generation === this.loadGeneration;
  }

  private async sendLoad(generation: number, url: string, track: CurrentTrack): Promise<void> {
    // A Pause still in flight would otherwise land after this track's Play and stop it.
    await this.transportFlush;
    if (!this.isCurrentLoad(generation)) throw new LoadSupersededError();
    const maxBitrate = this.readMaxBitrate();
    const castUrl = this.rewriteUrl(url, maxBitrate);
    const coverArtUrl = castCoverArtUrl(castUrl, track.artworkRef);
    const metadata = buildDidlMetadata(track, castUrl, coverArtUrl, maxBitrate > 0);
    await setAvTransportUri(this.renderer.avTransportControlUrl, castUrl, metadata);
    if (!this.isCurrentLoad(generation)) throw new LoadSupersededError();
    await avPlay(this.renderer.avTransportControlUrl);
    if (!this.isCurrentLoad(generation)) {
      // A newer load sends its own track; a torn-down renderer has to be stopped again.
      if (this.isTornDown) void avStop(this.renderer.avTransportControlUrl).catch(() => {});
      throw new LoadSupersededError();
    }
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
    this.requestTransport("pause");
  }

  resume(): void {
    this.positionUpdatedAt = Date.now();
    this.playing = true;
    this.requestTransport("play");
    this.scheduleReconcile(2000);
    // pause() cleared the track-end timer along with the reconcile timer. Without
    // rearming it here the track never auto-advances after a pause, and there is no
    // fallback: the natural-end check in the elapsed ticker is skipped for cast targets.
    this.scheduleTrackEndTimer(this.currentDuration);
  }

  stop(): void {
    this.playing = false;
    this.desiredTransport = null;
    this.clearTimers();
    void avStop(this.renderer.avTransportControlUrl).catch(() => {});
  }

  async seek(seconds: number): Promise<void> {
    await avSeek(this.renderer.avTransportControlUrl, seconds);
    this.noteSuccess();
    // After the await, so a reading started while the Seek was pending is discarded too.
    this.positionEpoch++;
    this.discardNextReading = true;
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

  // No-op: supportsGapless is false, see above.
  async setNext(): Promise<void> {}

  teardown(): void {
    this.isTornDown = true;
    this.playing = false;
    this.desiredTransport = null;
    this.clearTimers();
    this.onTrackEnd = null;
    this.onError = null;
    void avStop(this.renderer.avTransportControlUrl).catch(() => {});
  }

  // ── internals ──

  private requestTransport(state: "play" | "pause") {
    this.desiredTransport = state;
    if (!this.transportFlush) this.transportFlush = this.flushTransport();
  }

  private async flushTransport() {
    try {
      while (this.desiredTransport) {
        const state = this.desiredTransport;
        this.desiredTransport = null;
        await (state === "play" ? avPlay : avPause)(this.renderer.avTransportControlUrl).catch(() => {});
      }
    } finally {
      this.transportFlush = null;
    }
  }

  private scheduleReconcile(delayMs: number) {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(async () => {
      this.reconcileTimer = null;
      if (!this.playing) return;
      try {
        const epoch = this.positionEpoch;
        const t0 = Date.now();
        const reported = await getPositionInfo(this.renderer.avTransportControlUrl);
        const isStale = epoch !== this.positionEpoch;
        // A reading that started before a newer seek must not consume that seek's discard.
        const isFirstAfterSeek = !isStale && this.discardNextReading;
        if (!isStale) this.discardNextReading = false;
        const rtt = Date.now() - t0;
        const effective = reported + rtt / 2000;
        const localPos = this.positionSeconds + (Date.now() - this.positionUpdatedAt) / 1000;
        // Reject: renderer returned 0 (bad/unsupported) while we're already past 3s.
        const valid =
          (reported > 0 || localPos <= 3) && (this.currentDuration <= 0 || effective < this.currentDuration + 5);
        // Only re-baseline on significant drift to avoid visible snaps.
        if (!isStale && !isFirstAfterSeek && valid && Math.abs(effective - localPos) > 1.5) {
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

  // A duration of 0 still gets polled (from the start, at a slower interval): cast targets
  // have no other end-of-track signal, since player.ts skips its position-based fallback for them.
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
      const epoch = this.positionEpoch;
      let state: string;
      try {
        state = await getTransportInfo(this.renderer.avTransportControlUrl);
        // A load or seek since the request re-armed its own poll; this reply describes the old track.
        if (epoch !== this.positionEpoch) return;
        this.noteSuccess();
      } catch (e) {
        if (epoch !== this.positionEpoch) return;
        // Not reaching the renderer once is not evidence the track ended (a transient fault
        // lands here too); only a sustained run means the device is really gone.
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
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.trackEndTimer) {
      clearTimeout(this.trackEndTimer);
      this.trackEndTimer = null;
    }
  }
}
