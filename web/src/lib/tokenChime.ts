/**
 * A short synthesized "tick" played whenever the token counter climbs —
 * generated with the Web Audio API rather than shipping an audio file, so
 * there's no binary asset to license or bundle. Two quick sine partials
 * (a fundamental plus a soft fifth) with a fast attack and short decay,
 * kept quiet (peak gain 0.05) so it reads as a subtle tick, not a chime
 * you'd want to mute after five minutes.
 *
 * Lazily creates one shared AudioContext. Browsers block audio until a
 * user gesture on the page — the context stays "suspended" until then and
 * play() below just no-ops (resume() is attempted opportunistically, but
 * never awaited/blocked on).
 */
let ctx: AudioContext | undefined;

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined" || !window.AudioContext) return undefined;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function playTokenChime(): void {
  const audioCtx = getContext();
  if (!audioCtx || audioCtx.state !== "running") return;

  const now = audioCtx.currentTime;
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.05, now + 0.008);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  master.connect(audioCtx.destination);

  for (const [freq, gain] of [
    [880, 1],
    [1318.5, 0.35],
  ] as const) {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const partialGain = audioCtx.createGain();
    partialGain.gain.value = gain;
    osc.connect(partialGain);
    partialGain.connect(master);
    osc.start(now);
    osc.stop(now + 0.24);
  }
}
