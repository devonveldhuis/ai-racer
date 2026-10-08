/** HUD stylesheet, injected once as a `<style>` element (system fonts only, no external requests). */

export const HUD_STYLE_ID = 'ar-hud-style';

export const HUD_CSS = /* css */ `
.ar-hud {
  --ar-panel: rgba(10, 12, 16, 0.6);
  --ar-accent: #ffd23f;
  --ar-dim: rgba(255, 255, 255, 0.62);
  --ar-mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
  position: absolute;
  inset: 0;
  overflow: hidden;
  font: 600 clamp(13px, 2vmin, 28px) / 1.25 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  user-select: none;
}
.ar-hud [hidden] { display: none !important; }
.ar-panel {
  background: var(--ar-panel);
  border-radius: 0.7em;
  padding: 0.5em 0.8em;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.ar-num { font-family: var(--ar-mono); font-variant-numeric: tabular-nums; font-weight: 700; }
.ar-label { color: var(--ar-dim); font-size: 0.7em; letter-spacing: 0.08em; text-transform: uppercase; }

/* Race HUD: visible from the countdown until the finish screen is left. */
.ar-play { display: none; }
.ar-hud[data-state='countdown'] .ar-play,
.ar-hud[data-state='racing'] .ar-play,
.ar-hud[data-state='paused'] .ar-play,
.ar-hud[data-state='finished'] .ar-play { display: block; }

.ar-tl { position: absolute; top: 1em; left: 1em; min-width: 10em; }
.ar-time { font-size: 2.1em; line-height: 1.1; }
.ar-rows { display: grid; grid-template-columns: auto auto; column-gap: 1.2em; margin-top: 0.3em; }
.ar-rows .ar-num { text-align: right; }

.ar-tr { position: absolute; top: 1em; right: 1em; }
.ar-minimap {
  display: block;
  width: clamp(170px, 17vmin, 260px);
  height: clamp(170px, 17vmin, 260px);
  background: var(--ar-panel);
  border-radius: 0.7em;
}

.ar-br { position: absolute; right: 1em; bottom: 2.6em; text-align: right; min-width: 8em; }
.ar-speed { font-size: 3.2em; line-height: 1; }
.ar-unit { font-size: 0.8em; color: var(--ar-dim); margin-left: 0.3em; }
.ar-surface { display: inline-block; margin-top: 0.25em; font-size: 0.8em; font-weight: 700; }

.ar-bl { position: absolute; left: 1em; bottom: 2.6em; width: 13em; }
.ar-ctrl { font-size: 0.85em; margin-bottom: 0.45em; }
.ar-bar { position: relative; display: flex; height: 0.7em; margin: 0.25em 0 0.55em; background: rgba(255, 255, 255, 0.12); border-radius: 0.35em; overflow: hidden; }
.ar-bar > div { position: relative; height: 100%; }
.ar-bar i { position: absolute; inset: 0; transform: scaleX(0); will-change: transform; }
.ar-brake i { background: #ff5a4d; transform-origin: right center; }
.ar-throttle i { background: #4ade80; transform-origin: left center; }
.ar-steer-l i { background: var(--ar-accent); transform-origin: right center; }
.ar-steer-r i { background: var(--ar-accent); transform-origin: left center; }
.ar-bar::after { content: ''; position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; opacity: 0.85; left: var(--ar-tick, 50%); margin-left: -1px; }

/* Countdown and penalty flash */
.ar-countdown {
  position: absolute; left: 0; right: 0; top: 24%; text-align: center; opacity: 0;
  font: 800 clamp(80px, 22vmin, 320px) / 1 var(--ar-mono); color: #fff;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6); pointer-events: none;
}
.ar-countdown.ar-go { color: var(--ar-accent); }
.ar-penalty {
  position: absolute; left: 0; right: 0; top: 14%; text-align: center; opacity: 0;
  font: 800 2.4em var(--ar-mono); color: #ff6b5e; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
}

/* Screens */
.ar-pause, .ar-finish-wrap, .ar-loading {
  position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
}
.ar-pause { background: rgba(5, 6, 8, 0.55); }
.ar-pause span { font-size: 2.2em; letter-spacing: 0.04em; }
.ar-hud[data-state='paused'] .ar-pause { display: flex; }
.ar-hud[data-state='finished'] .ar-finish-wrap { display: flex; background: rgba(5, 6, 8, 0.35); }
.ar-finish { pointer-events: auto; text-align: center; min-width: 20em; max-width: 90vw; padding: 1.2em 1.8em; }
.ar-finish h2 { margin: 0; font-size: 0.8em; letter-spacing: 0.15em; text-transform: uppercase; color: var(--ar-dim); }
.ar-total { font-size: 3.6em; line-height: 1.15; }
.ar-badge { display: inline-block; margin: 0.2em 0 0.4em; padding: 0.15em 0.8em; border-radius: 1em; background: var(--ar-accent); color: #1a1500; text-shadow: none; font-weight: 800; }
.ar-stats { display: grid; grid-template-columns: auto auto; column-gap: 2em; margin: 0.6em auto 1em; width: max-content; text-align: left; }
.ar-stats .ar-num { text-align: right; }
.ar-buttons { display: flex; gap: 0.8em; justify-content: center; }
.ar-btn {
  pointer-events: auto; cursor: pointer; font: inherit; color: #fff; padding: 0.55em 1.1em;
  background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 0.6em;
}
.ar-btn:hover { background: rgba(255, 255, 255, 0.22); }
.ar-btn.ar-primary { background: var(--ar-accent); color: #1a1500; border-color: var(--ar-accent); text-shadow: none; }
.ar-btn.ar-primary:hover { filter: brightness(1.08); }

.ar-loading { background: #0b0d12; flex-direction: column; gap: 0.9em; z-index: 5; pointer-events: auto; }
.ar-loading:not([hidden]) { display: flex; }
.ar-loading h1 { margin: 0; font-size: 2.4em; letter-spacing: 0.06em; }
.ar-loading-bar { width: min(22em, 70vw); height: 0.6em; background: rgba(255, 255, 255, 0.14); border-radius: 0.3em; overflow: hidden; }
.ar-loading-bar i { display: block; height: 100%; background: var(--ar-accent); transform-origin: left center; transform: scaleX(0); }
.ar-loading-text { font-size: 0.85em; color: var(--ar-dim); }
.ar-loading.ar-error .ar-loading-text { color: #ff8a80; }

.ar-toast {
  position: absolute; left: 50%; top: 1em; transform: translateX(-50%); max-width: 80vw; text-align: center;
  z-index: 4;
}
.ar-toast.ar-error { background: rgba(120, 20, 20, 0.85); }

.ar-help {
  position: absolute; left: 50%; bottom: 0.7em; transform: translateX(-50%);
  width: max-content; max-width: 94vw; text-align: center; white-space: pre-wrap;
  font-size: 0.72em; color: rgba(255, 255, 255, 0.85); padding: 0.3em 0.9em;
  background: rgba(10, 12, 16, 0.5); border-radius: 0.6em; font-family: var(--ar-mono); font-weight: 500;
}

/* The ?debug=1 text panel: bottom left, above the controls (which scale with the viewport). */
.ar-debug {
  position: fixed; left: 12px; bottom: clamp(170px, 24vmin, 345px); padding: 6px 8px;
  background: rgba(0, 0, 0, 0.65); color: #fff; font: clamp(10px, 1.4vmin, 20px) / 1.35 ui-monospace, monospace;
  white-space: pre-wrap; max-width: 40em; pointer-events: none;
}
`;

/** Adds the stylesheet to `<head>` once; returns a function that removes it. */
export function injectStyles(doc: Document = document): () => void {
  let el = doc.getElementById(HUD_STYLE_ID);
  const created = !el;
  if (!el) {
    el = doc.createElement('style');
    el.id = HUD_STYLE_ID;
    el.textContent = HUD_CSS;
    doc.head.appendChild(el);
  }
  return () => {
    if (created) el?.remove();
  };
}
