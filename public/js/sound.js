/**
 * Sound effects, synthesized with the Web Audio API.
 *
 * There are no audio files: every sound is a short tone generated in the
 * browser, so nothing needs licensing and nothing extra is downloaded.
 * Sound is off by default and only plays after the player turns it on.
 */

let enabled = false;
let ctx = null;

function audio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(c, { freq, start = 0, length = 0.12, type = "sine", volume = 0.05, slideTo }) {
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

const SOUNDS = {
  flag: (c) => tone(c, { freq: 520, length: 0.06, type: "triangle", volume: 0.04 }),
  unflag: (c) => tone(c, { freq: 380, length: 0.06, type: "triangle", volume: 0.03 }),
  correct: (c) => {
    tone(c, { freq: 660, length: 0.1 });
    tone(c, { freq: 990, start: 0.09, length: 0.16 });
  },
  wrong: (c) => tone(c, { freq: 220, length: 0.28, type: "sawtooth", volume: 0.035, slideTo: 140 }),
  clockOut: (c) => {
    tone(c, { freq: 523, length: 0.14 });
    tone(c, { freq: 659, start: 0.12, length: 0.14 });
    tone(c, { freq: 784, start: 0.24, length: 0.3 });
  },
};

export function setSoundEnabled(on) {
  enabled = on;
}

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  try {
    const c = audio();
    if (c) SOUNDS[name](c);
  } catch {
    // Audio is a nice-to-have; never let it break the game.
  }
}
