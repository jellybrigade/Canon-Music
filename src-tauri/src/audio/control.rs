use super::AudioState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[tauri::command]
pub fn audio_get_pos(state: tauri::State<'_, AudioState>) -> f64 {
    state
        .pos
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .current()
}

#[tauri::command]
pub fn audio_volume(state: tauri::State<'_, AudioState>, volume: f32) {
    // Cancel any in-flight seek fade so it doesn't overwrite this new volume.
    state.fade_gen.fetch_add(1, Ordering::Relaxed);
    *state.volume.lock().unwrap_or_else(|e| e.into_inner()) = volume;
    if let Some(sink) = state
        .sink
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        sink.set_volume(volume);
    }
}

#[tauri::command]
pub fn audio_set_speed(state: tauri::State<'_, AudioState>, speed: f32) {
    let clamped = speed.clamp(0.5, 2.0);
    *state.speed.lock().unwrap_or_else(|e| e.into_inner()) = clamped;
    let sink_opt = state.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(sink) = sink_opt {
        sink.set_speed(clamped);
    }
    let mut pos = state.pos.lock().unwrap_or_else(|e| e.into_inner());
    // Freeze offset at current real-time position, then start fresh with new speed.
    if let Some(t) = pos.play_start.take() {
        pos.offset += t.elapsed().as_secs_f64() * pos.speed as f64;
    }
    pos.speed = clamped;
    pos.play_start = Some(Instant::now());
}

#[tauri::command]
pub fn audio_seek(state: tauri::State<'_, AudioState>, seconds: f64) {
    let fade_gen = Arc::clone(&state.fade_gen);
    let gen = fade_gen.fetch_add(1, Ordering::Relaxed) + 1;

    let target_vol = *state.volume.lock().unwrap_or_else(|e| e.into_inner());
    let sink_opt = state.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(sink) = sink_opt {
        sink.set_volume(0.0);
        let duration = std::time::Duration::from_secs_f64(seconds);
        if let Err(e) = sink.try_seek(duration) {
            eprintln!("audio_seek error: {e}");
            sink.set_volume(target_vol);
            return;
        }
        let mut pos = state.pos.lock().unwrap_or_else(|e| e.into_inner());
        pos.offset = seconds;
        // Only restart the wall clock if it was already running. Seeking while paused used to
        // re-arm it, so PosTracker::current() climbed in real time against silent audio and the
        // frontend eventually treated the phantom position as the end of the track.
        if pos.play_start.is_some() {
            pos.play_start = Some(Instant::now());
        }
        drop(pos);

        // Ramp volume back up over 80 ms to mask any DC-offset click at the seek boundary.
        // Check gen AFTER each sleep so a concurrent seek that fires mid-sleep is seen
        // immediately on wake, preventing a partial-volume write over the new seek's mute.
        std::thread::spawn(move || {
            const STEPS: u64 = 8;
            for i in 1..=STEPS {
                std::thread::sleep(Duration::from_millis(10));
                if fade_gen.load(Ordering::Relaxed) != gen {
                    return;
                }
                let t = i as f32 / STEPS as f32;
                sink.set_volume(target_vol * t);
            }
            if fade_gen.load(Ordering::Relaxed) == gen {
                sink.set_volume(target_vol);
            }
        });
    }
}

#[tauri::command]
pub fn audio_pause(state: tauri::State<'_, AudioState>, fade_ms: u64) {
    let fade_gen = Arc::clone(&state.fade_gen);
    let gen = fade_gen.fetch_add(1, Ordering::Relaxed) + 1;
    let pause_pending = Arc::clone(&state.pause_pending);
    pause_pending.store(true, Ordering::Relaxed);

    let mut pos = state.pos.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = pos.play_start.take() {
        pos.offset += t.elapsed().as_secs_f64() * pos.speed as f64;
    }
    drop(pos);

    if fade_ms == 0 {
        if let Some(sink) = state
            .sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            sink.pause();
        }
        return;
    }

    let sink_opt = state.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(sink) = sink_opt {
        // Ramp from wherever the volume actually is, not from the configured target. Pausing
        // during an in-flight resume fade cancels that fade partway, so the sink can sit at any
        // level; starting from the target would jump the volume up before fading it down.
        let start_vol = sink.volume();
        tauri::async_runtime::spawn_blocking(move || {
            let steps = (fade_ms / 10).max(1);
            for i in 1..=steps {
                // Abandon the ramp if another fade took over, but still fall through to the
                // pause_pending check below: a seek mid-fade bumps fade_gen without meaning
                // "keep playing", and skipping the pause left audio running with the UI
                // showing a paused state.
                if fade_gen.load(Ordering::Relaxed) != gen {
                    break;
                }
                let t = i as f32 / steps as f32;
                sink.set_volume(start_vol * (1.0 - t));
                std::thread::sleep(Duration::from_millis(10));
            }
            if pause_pending.load(Ordering::Relaxed) {
                sink.pause();
            }
        });
    }
}

#[tauri::command]
pub fn audio_resume(state: tauri::State<'_, AudioState>, fade_ms: u64) {
    let fade_gen = Arc::clone(&state.fade_gen);
    let gen = fade_gen.fetch_add(1, Ordering::Relaxed) + 1;
    // Clears the pending pause so a still-running pause fade thread can't pause us afterwards.
    state.pause_pending.store(false, Ordering::Relaxed);

    let mut pos = state.pos.lock().unwrap_or_else(|e| e.into_inner());
    if pos.play_start.is_none() {
        pos.play_start = Some(Instant::now());
    }
    drop(pos);

    let target_vol = *state.volume.lock().unwrap_or_else(|e| e.into_inner());
    let sink_opt = state.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(sink) = sink_opt {
        if fade_ms == 0 {
            sink.set_volume(target_vol);
            sink.play();
            return;
        }
        // Ramp up from the current level rather than forcing 0 first. A pause fade that was
        // cancelled partway leaves the sink mid-ramp, and dropping it to 0 to fade back up
        // produces an audible dip when play/pause is toggled quickly.
        let start_vol = sink.volume().min(target_vol);
        sink.set_volume(start_vol);
        sink.play();
        tauri::async_runtime::spawn_blocking(move || {
            let steps = (fade_ms / 10).max(1);
            for i in 1..=steps {
                if fade_gen.load(Ordering::Relaxed) != gen {
                    return;
                }
                let t = i as f32 / steps as f32;
                sink.set_volume(start_vol + (target_vol - start_vol) * t);
                std::thread::sleep(Duration::from_millis(10));
            }
            if fade_gen.load(Ordering::Relaxed) == gen {
                sink.set_volume(target_vol);
            }
        });
    }
}

#[tauri::command]
pub fn audio_stop(state: tauri::State<'_, AudioState>) {
    // Bump play_id first so the watcher thread won't emit track-ended after stop.
    state.play_id.fetch_add(1, Ordering::Relaxed);
    state.fade_gen.fetch_add(1, Ordering::Relaxed);
    state.gapless_queued.store(false, Ordering::Relaxed);
    state.pause_pending.store(false, Ordering::Relaxed);
    let old_sink = state.sink.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(sink) = old_sink {
        sink.stop();
    }
    state
        .prefetch_cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    let mut pos = state.pos.lock().unwrap_or_else(|e| e.into_inner());
    pos.play_start = None;
    pos.offset = 0.0;
}
