/**
 * 퀴즈 효과음 — WebAudio 합성(에셋 파일 불필요, 폐쇄망 OK).
 * 클라이언트에서만 동작. 사용자가 음소거하면 toggle(false).
 */
let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // 사용자 제스처 후 resume(자동재생 정책).
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** 단음 합성(주파수, 길이초, 파형, 시작지연초, 음량). */
function tone(freq: number, dur: number, type: OscillatorType = "sine", delay = 0, gain = 0.15) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  setEnabled(v: boolean) {
    enabled = v;
  },
  get enabled() {
    return enabled;
  },
  /** 게임 시작 — 짧은 상승 아르페지오. */
  start() {
    if (!enabled) return;
    tone(523, 0.12, "triangle", 0);
    tone(659, 0.12, "triangle", 0.1);
    tone(784, 0.18, "triangle", 0.2);
  },
  /** 정답 — 밝은 두 음. */
  correct() {
    if (!enabled) return;
    tone(880, 0.1, "sine", 0);
    tone(1175, 0.16, "sine", 0.08);
  },
  /** 콤보 강조 — 콤보 수에 따라 음 높아짐. */
  combo(n: number) {
    if (!enabled) return;
    const base = 880 + Math.min(n, 12) * 60;
    tone(base, 0.12, "square", 0, 0.1);
  },
  /** 오답/게임오버 — 하강음. */
  wrong() {
    if (!enabled) return;
    tone(330, 0.18, "sawtooth", 0, 0.12);
    tone(196, 0.3, "sawtooth", 0.12, 0.12);
  },
  /** 카운트다운 틱. */
  tick() {
    if (!enabled) return;
    tone(660, 0.05, "square", 0, 0.06);
  },
};
