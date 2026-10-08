/**
 * The game overlay: loading screen, toast, countdown, race HUD, pause and finish screens, help
 * line and minimap. Plain DOM, no framework; styles come from `styles.ts`.
 *
 * The Hud lives for the whole game. Each session `bind()`s it to its race (events) and layout
 * (minimap); `bind`/`unbind` release the old session's subscriptions. Screens are switched
 * with a `data-state` attribute on the root (the race state), so most visibility is CSS.
 * Per-frame values come in through `update(snapshot)`; every DOM write goes through a
 * "set only on change" setter, and text other than the clock is refreshed at about 20 Hz.
 */
import type { SurfaceType } from '../assets/surfaces';
import type { Race, RaceState } from '../race/Race';
import { bestTimeForSeed, type RaceResult } from '../race/results';
import type { TrackLayout } from '../track/layout';
import { formatKmh, formatPenalty, formatTime } from './format';
import { Minimap } from './Minimap';
import { scaleXSetter, styleSetter, textSetter } from './setOnChange';
import { injectStyles } from './styles';

export interface HudActions {
  restart(): void;
  newTrack(): void;
}

export interface HudOptions {
  actions: HudActions;
  /** Accelerator value that means "coast" (`car.neutral`): where the bar's tick sits. */
  neutral: number;
  /** Where the overlay goes. Default `#ui`, else `document.body`. */
  parent?: HTMLElement;
}

export interface HudBinding {
  race: Race;
  layout: TrackLayout;
  worldScale: number;
  seed: number;
  controller: string;
}

/** The per-frame values the HUD shows. */
export interface HudSnapshot {
  /** Race time including penalties (s). */
  time: number;
  /** m/s, signed. */
  speed: number;
  surface: SurfaceType | null;
  accelerator: number;
  steering: number;
  lap: number;
  laps: number;
  checkpointsPassed: number;
  checkpointCount: number;
  /** Car pose in metres (`layout.ts` heading). */
  x: number;
  z: number;
  heading: number;
}

const SURFACE_COLORS: Record<SurfaceType | 'air', string> = {
  road: '#cfd6e0',
  kerb: '#ff6b5e',
  grass: '#6fdc6f',
  sand: '#e8c670',
  wall: '#ffa94d',
  air: '#9aa4b2',
};

const SLOW_INTERVAL_MS = 50;
const HELP_TEXT =
  'W/S throttle·brake   A/D steer   R reset   Enter restart   N new   Esc pause   C camera   H help';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly removeStyles: () => void;
  private readonly minimap: Minimap;
  private readonly actions: HudActions;

  private readonly loading = el('div', 'ar-loading');
  private readonly loadingBar = el('i');
  private readonly loadingText = el('div', 'ar-loading-text', 'Loading…');
  private readonly toast = el('div', 'ar-toast ar-panel');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly countdown = el('div', 'ar-countdown');
  private readonly penalty = el('div', 'ar-penalty');
  private readonly help = el('div', 'ar-help', HELP_TEXT);
  private readonly finishWrap = el('div', 'ar-finish-wrap');
  private readonly finishTotal = el('div', 'ar-total ar-num');
  private readonly finishBadge = el('div', 'ar-badge', 'New best!');
  private readonly finishStats = el('div', 'ar-stats');

  private readonly setTime: (s: string) => void;
  private readonly setBest: (s: string) => void;
  private readonly setCp: (s: string) => void;
  private readonly setLap: (s: string) => void;
  private readonly setSpeed: (s: string) => void;
  private readonly setSurfaceText: (s: string) => void;
  private readonly setSurfaceColor: (s: string) => void;
  private readonly setController: (s: string) => void;
  private readonly setBrake: (v: number) => void;
  private readonly setThrottle: (v: number) => void;
  private readonly setSteerL: (v: number) => void;
  private readonly setSteerR: (v: number) => void;

  private readonly neutral: number;
  private subs: (() => void)[] = [];
  private binding: HudBinding | null = null;
  private animations: Animation[] = [];
  private lastSlow = -Infinity;
  private disposed = false;

  constructor(opts: HudOptions) {
    this.actions = opts.actions;
    this.neutral = Math.min(0.95, Math.max(0.05, opts.neutral));
    this.removeStyles = injectStyles();
    const root = el('div', 'ar-hud');
    root.dataset.state = 'idle';
    this.root = root;

    // Loading screen
    const title = el('h1', undefined, 'AI Racer');
    const bar = el('div', 'ar-loading-bar');
    bar.appendChild(this.loadingBar);
    this.loading.append(title, bar, this.loadingText);
    this.loading.hidden = true;

    // Race HUD
    const play = el('div', 'ar-play');
    const tl = el('div', 'ar-tl ar-panel');
    const timeEl = el('div', 'ar-time ar-num', formatTime(0));
    const rows = el('div', 'ar-rows');
    const bestEl = el('span', 'ar-num', '—');
    const cpEl = el('span', 'ar-num', '0/0');
    const lapEl = el('span', 'ar-num', '1/1');
    rows.append(
      el('span', 'ar-label', 'Best'),
      bestEl,
      el('span', 'ar-label', 'Checkpoint'),
      cpEl,
      el('span', 'ar-label', 'Lap'),
      lapEl,
    );
    tl.append(timeEl, rows);

    const tr = el('div', 'ar-tr');
    this.minimap = new Minimap(tr);

    const br = el('div', 'ar-br ar-panel');
    const speedRow = el('div');
    const speedEl = el('span', 'ar-speed ar-num', '0');
    speedRow.append(speedEl, el('span', 'ar-unit', 'km/h'));
    const surfaceEl = el('div', 'ar-surface');
    br.append(speedRow, surfaceEl);

    const bl = el('div', 'ar-bl ar-panel');
    const ctrlEl = el('div', 'ar-ctrl');
    const accelBar = el('div', 'ar-bar');
    accelBar.style.setProperty('--ar-tick', `${this.neutral * 100}%`);
    const brakePart = el('div', 'ar-brake');
    brakePart.style.width = `${this.neutral * 100}%`;
    const brakeFill = el('i');
    brakePart.appendChild(brakeFill);
    const throttlePart = el('div', 'ar-throttle');
    throttlePart.style.width = `${(1 - this.neutral) * 100}%`;
    const throttleFill = el('i');
    throttlePart.appendChild(throttleFill);
    accelBar.append(brakePart, throttlePart);
    const steerBar = el('div', 'ar-bar');
    const sl = el('div', 'ar-steer-l');
    sl.style.width = '50%';
    const slFill = el('i');
    sl.appendChild(slFill);
    const sr = el('div', 'ar-steer-r');
    sr.style.width = '50%';
    const srFill = el('i');
    sr.appendChild(srFill);
    steerBar.append(sl, sr);
    bl.append(
      ctrlEl,
      el('div', 'ar-label', 'Brake · Throttle'),
      accelBar,
      el('div', 'ar-label', 'Steering'),
      steerBar,
    );
    play.append(tl, tr, br, bl);

    // Pause
    const pause = el('div', 'ar-pause');
    pause.appendChild(el('span', 'ar-panel', 'Paused — Esc to resume'));

    // Finish
    const finish = el('div', 'ar-finish ar-panel');
    this.finishBadge.hidden = true;
    const buttons = el('div', 'ar-buttons');
    const restartBtn = el('button', 'ar-btn ar-primary', 'Restart (Enter)');
    const newBtn = el('button', 'ar-btn', 'New track (N)');
    for (const [btn, fn] of [
      [restartBtn, () => this.actions.restart()],
      [newBtn, () => this.actions.newTrack()],
    ] as const) {
      btn.type = 'button';
      btn.tabIndex = -1;
      // Keep keyboard focus off the buttons, so Enter/Space do not click them a second time.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', fn);
    }
    buttons.append(restartBtn, newBtn);
    finish.append(
      el('h2', undefined, 'Finished'),
      this.finishTotal,
      this.finishBadge,
      this.finishStats,
      buttons,
    );
    this.finishWrap.appendChild(finish);

    this.toast.hidden = true;
    root.append(
      play,
      this.countdown,
      this.penalty,
      pause,
      this.finishWrap,
      this.help,
      this.toast,
      this.loading,
    );
    (opts.parent ?? document.getElementById('ui') ?? document.body).appendChild(root);

    this.setTime = textSetter(timeEl);
    this.setBest = textSetter(bestEl);
    this.setCp = textSetter(cpEl);
    this.setLap = textSetter(lapEl);
    this.setSpeed = textSetter(speedEl);
    this.setSurfaceText = textSetter(surfaceEl);
    this.setSurfaceColor = styleSetter(surfaceEl, 'color');
    this.setController = textSetter(ctrlEl);
    this.setBrake = scaleXSetter(brakeFill);
    this.setThrottle = scaleXSetter(throttleFill);
    this.setSteerL = scaleXSetter(slFill);
    this.setSteerR = scaleXSetter(srFill);
  }

  // --- Loading, toast, help ---------------------------------------------------------

  /** Shows the full loading screen with a progress bar (`done` of `total` models). */
  setLoading(done: number, total: number): void {
    this.loading.classList.remove('ar-error');
    this.loading.hidden = false;
    const f = total > 0 ? done / total : 0;
    this.loadingBar.style.transform = `scaleX(${f})`;
    this.loadingText.textContent = `Loading models ${done}/${total}`;
  }

  /** Replaces the loading text with an error (the loading screen stays up). */
  setLoadingError(message: string): void {
    this.loading.hidden = false;
    this.loading.classList.add('ar-error');
    this.loadingText.textContent = message;
  }

  hideLoading(): void {
    this.loading.hidden = true;
  }

  /** A small message at the top; `ms` = 0 keeps it until `hideToast`. */
  showToast(text: string, kind: 'info' | 'error' = 'info', ms = 0): void {
    if (this.disposed) return;
    this.toast.textContent = text;
    this.toast.classList.toggle('ar-error', kind === 'error');
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = ms > 0 ? setTimeout(() => this.hideToast(), ms) : null;
  }

  hideToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toast.hidden = true;
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }

  get helpVisible(): boolean {
    return !this.help.hidden;
  }

  // --- Session binding --------------------------------------------------------------

  /** Binds to a session's race events and layout; releases the previous binding first. */
  bind(b: HudBinding): void {
    this.unbind();
    this.binding = b;
    const ev = b.race.events;
    this.subs.push(
      ev.on('stateChanged', ({ state }) => this.applyState(state)),
      ev.on('countdownTick', ({ value }) => this.showCountdown(value)),
      ev.on('reset', ({ penalty }) => this.flashPenalty(penalty)),
      ev.on('finished', (result) => this.showFinish(result)),
    );
    this.minimap.setLayout(b.layout, b.worldScale);
    this.setController(b.controller);
    this.setBest(this.bestText());
    this.setCp(`0/${b.race.checkpointCount}`);
    this.lastSlow = -Infinity;
    // The race is usually already counting down by now: catch up with its current state.
    this.applyState(b.race.state);
    if (b.race.state === 'countdown' && b.race.countdownValue !== null) {
      this.showCountdown(b.race.countdownValue);
    }
    if (b.race.state === 'finished' && b.race.result) this.showFinish(b.race.result);
  }

  /** Releases the race subscriptions and hides every session screen. */
  unbind(): void {
    for (const off of this.subs) off();
    this.subs = [];
    this.binding = null;
    this.cancelAnimations();
    this.root.dataset.state = 'idle';
    this.minimap.setLayout(null, 1);
  }

  /** Number of live race subscriptions (0 when unbound); for tests and debugging. */
  get subscriptionCount(): number {
    return this.subs.length;
  }

  private bestText(): string {
    const b = this.binding;
    const best = b ? bestTimeForSeed(b.seed) : null;
    return best === null ? '—' : formatTime(best);
  }

  private applyState(state: RaceState): void {
    if (this.root.dataset.state === state) return;
    this.root.dataset.state = state;
    if (state === 'finished' || state === 'generating' || state === 'loading') {
      this.cancelAnimations();
    }
  }

  private cancelAnimations(): void {
    for (const a of this.animations) a.cancel();
    this.animations = [];
  }

  private animate(
    target: HTMLElement,
    keyframes: Keyframe[],
    duration: number,
    easing = 'ease-out',
  ): void {
    if (typeof target.animate !== 'function') return;
    const a = target.animate(keyframes, { duration, easing, fill: 'both' });
    a.onfinish = () => {
      this.animations = this.animations.filter((x) => x !== a);
    };
    this.animations.push(a);
  }

  private showCountdown(value: number): void {
    const go = value === 0;
    this.countdown.textContent = go ? 'GO!' : String(value);
    this.countdown.classList.toggle('ar-go', go);
    // A new tick replaces the animation of the previous one.
    this.cancelAnimations();
    if (go) {
      this.animate(
        this.countdown,
        [
          { opacity: 1, transform: 'scale(0.8)', offset: 0 },
          { opacity: 1, transform: 'scale(1.1)', offset: 0.15 },
          { opacity: 1, transform: 'scale(1)', offset: 0.4 },
          { opacity: 0, transform: 'scale(1.25)', offset: 1 },
        ],
        700,
      );
    } else {
      this.animate(
        this.countdown,
        [
          { opacity: 0, transform: 'scale(1.7)' },
          { opacity: 1, transform: 'scale(1)', offset: 0.25 },
          { opacity: 0.55, transform: 'scale(0.92)' },
        ],
        900,
      );
    }
  }

  private flashPenalty(seconds: number): void {
    this.penalty.textContent = formatPenalty(seconds);
    this.animate(
      this.penalty,
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 1, transform: 'translateY(-0.2em)', offset: 0.6 },
        { opacity: 0, transform: 'translateY(-0.6em)' },
      ],
      1300,
      'ease-out',
    );
  }

  private showFinish(result: RaceResult): void {
    const prevBest = bestTimeForSeed(result.seed, result);
    const isBest = prevBest !== null && result.totalTime < prevBest;
    this.finishTotal.textContent = formatTime(result.totalTime);
    this.finishBadge.hidden = !isBest;
    const rows: [string, string][] = [];
    result.lapTimes.forEach((t, i) => rows.push([`Lap ${i + 1}`, formatTime(t)]));
    rows.push(['Resets', String(result.resets)]);
    rows.push(['Off track', `${result.offTrackTime.toFixed(1)} s`]);
    rows.push(['Seed', String(result.seed)]);
    this.finishStats.replaceChildren(
      ...rows.flatMap(([k, v]) => [el('span', 'ar-label', k), el('span', 'ar-num', v)]),
    );
    this.setBest(this.bestText());
  }

  // --- Per frame --------------------------------------------------------------------

  update(s: HudSnapshot, nowMs: number): void {
    if (this.disposed || !this.binding) return;
    const state = this.binding.race.state;
    if (state === 'loading' || state === 'generating') return;
    this.setTime(formatTime(s.time));
    this.setBrake(this.neutral > 0 ? (this.neutral - s.accelerator) / this.neutral : 0);
    this.setThrottle((s.accelerator - this.neutral) / (1 - this.neutral));
    this.setSteerL(-s.steering);
    this.setSteerR(s.steering);
    this.minimap.update(s.x, s.z, s.heading, s.checkpointsPassed);
    if (nowMs - this.lastSlow < SLOW_INTERVAL_MS) return;
    this.lastSlow = nowMs;
    this.setSpeed(formatKmh(s.speed));
    this.setSurfaceText(s.surface ?? 'airborne');
    this.setSurfaceColor(SURFACE_COLORS[s.surface ?? 'air']);
    this.setCp(`${s.checkpointsPassed}/${s.checkpointCount}`);
    this.setLap(`${s.lap}/${s.laps}`);
  }

  dispose(): void {
    if (this.disposed) return;
    this.unbind();
    this.disposed = true;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.minimap.dispose();
    this.root.remove();
    this.removeStyles();
  }
}
