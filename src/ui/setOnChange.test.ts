import { describe, expect, it, vi } from 'vitest';
import { onChange, scaleXSetter, styleSetter, textSetter } from './setOnChange';

/** A fake element that counts writes. */
function fakeEl() {
  let text: string | null = '';
  const writes = { text: 0, style: 0 };
  const style = new Proxy({} as Record<string, string>, {
    set(t, k, v) {
      writes.style++;
      t[k as string] = v as string;
      return true;
    },
  });
  return {
    writes,
    style,
    get textContent() {
      return text;
    },
    set textContent(v: string | null) {
      writes.text++;
      text = v;
    },
  };
}

describe('onChange', () => {
  it('applies the first value and then only changes', () => {
    const apply = vi.fn();
    const set = onChange<number>(apply);
    set(1);
    set(1);
    set(2);
    set(2);
    set(1);
    expect(apply.mock.calls).toEqual([[1], [2], [1]]);
  });
  it('applies undefined / NaN once', () => {
    const apply = vi.fn();
    const set = onChange<number>(apply);
    set(NaN);
    set(NaN);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('DOM setters', () => {
  it('textSetter writes textContent only on change', () => {
    const el = fakeEl();
    const set = textSetter(el);
    set('a');
    set('a');
    set('b');
    expect(el.writes.text).toBe(2);
    expect(el.textContent).toBe('b');
  });
  it('styleSetter writes the property only on change', () => {
    const el = fakeEl();
    const set = styleSetter(el, 'color');
    set('red');
    set('red');
    set('blue');
    expect(el.writes.style).toBe(2);
    expect(el.style.color).toBe('blue');
  });
  it('scaleXSetter clamps, rounds to 2 decimals and skips equal values', () => {
    const el = fakeEl();
    const set = scaleXSetter(el as unknown as { style: { transform: string } });
    set(0.501);
    set(0.5049);
    set(2);
    set(-1);
    expect(el.writes.style).toBe(3);
    expect(el.style.transform).toBe('scaleX(0)');
    set(0.123456);
    expect(el.style.transform).toBe('scaleX(0.12)');
  });
});
