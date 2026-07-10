import { useProfile } from '../store/useProfile.js';

let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone({ freq, duration = 0.15, type = 'sine', gain = 0.15, delay = 0 }) {
  if (useProfile.getState().muted) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  const startTime = ctx.currentTime + delay;
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

export function playDealCard() {
  tone({ freq: 620, duration: 0.06, type: 'square', gain: 0.06 });
}

export function playFlipCard() {
  tone({ freq: 900, duration: 0.09, type: 'triangle', gain: 0.08 });
  tone({ freq: 1200, duration: 0.07, type: 'triangle', gain: 0.05, delay: 0.04 });
}

export function playChipBet() {
  tone({ freq: 300, duration: 0.08, type: 'square', gain: 0.07 });
  tone({ freq: 260, duration: 0.08, type: 'square', gain: 0.05, delay: 0.05 });
}

export function playCheck() {
  tone({ freq: 200, duration: 0.1, type: 'square', gain: 0.08 });
}

export function playFold() {
  tone({ freq: 150, duration: 0.15, type: 'sawtooth', gain: 0.05 });
}

export function playYourTurn() {
  tone({ freq: 700, duration: 0.1, type: 'sine', gain: 0.08 });
  tone({ freq: 900, duration: 0.12, type: 'sine', gain: 0.08, delay: 0.12 });
}

export function playWin() {
  [523, 659, 784, 1046].forEach((freq, i) =>
    tone({ freq, duration: 0.2, type: 'sine', gain: 0.09, delay: i * 0.09 })
  );
}

export function playClick() {
  tone({ freq: 500, duration: 0.05, type: 'square', gain: 0.05 });
}

export function playTimeWarningTick(secondsLeft) {
  const urgent = secondsLeft <= 3;
  tone({
    freq: urgent ? 950 : 750,
    duration: urgent ? 0.09 : 0.06,
    type: 'square',
    gain: urgent ? 0.1 : 0.07,
  });
}
