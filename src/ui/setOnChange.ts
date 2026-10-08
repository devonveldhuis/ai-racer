/**
 * "Write only when changed" helpers: every DOM write in the frame loop goes through one, so
 * an unchanged value costs a comparison and no style/layout work.
 */

/** Returns a function that calls `apply(value)` only when `value` differs from the last one. */
export function onChange<T>(apply: (value: T) => void): (value: T) => void {
  let has = false;
  let last: T;
  return (value) => {
    if (has && Object.is(last, value)) return;
    has = true;
    last = value;
    apply(value);
  };
}

/** Sets `el.textContent` when the text changes. */
export function textSetter(el: { textContent: string | null }): (text: string) => void {
  return onChange((text: string) => {
    el.textContent = text;
  });
}

/** Sets one inline style property when the value changes. */
export function styleSetter(el: { style: object }, prop: string): (value: string) => void {
  return onChange((value: string) => {
    (el.style as Record<string, string>)[prop] = value;
  });
}

/** Sets `transform: scaleX(v)` (v rounded to 2 decimals, clamped to [0, 1]). */
export function scaleXSetter(el: { style: { transform: string } }): (v: number) => void {
  const set = onChange((q: number) => {
    el.style.transform = `scaleX(${q})`;
  });
  return (v) => set(Math.round(Math.min(1, Math.max(0, v)) * 100) / 100);
}
