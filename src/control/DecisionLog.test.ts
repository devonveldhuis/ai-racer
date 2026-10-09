import { describe, expect, it } from 'vitest';
import { DecisionLog, type DecisionEntry } from './DecisionLog';
import { blankObservation } from './testObservation';

const entry = (i: number, error?: string): DecisionEntry => ({
  t: i / 10,
  observation: blankObservation(i / 10),
  action: { accelerator: 0.5 + i / 100, steering: -0.25 },
  latencyMs: i,
  ...(error ? { error } : {}),
});

describe('DecisionLog', () => {
  it('keeps entries in order below capacity', () => {
    const log = new DecisionLog(5);
    for (let i = 0; i < 3; i++) log.push(entry(i));
    expect(log.size).toBe(3);
    expect(log.entries().map((e) => e.latencyMs)).toEqual([0, 1, 2]);
  });

  it('drops the oldest entries at capacity', () => {
    const log = new DecisionLog(4);
    for (let i = 0; i < 11; i++) log.push(entry(i));
    expect(log.size).toBe(4);
    expect(log.entries().map((e) => e.latencyMs)).toEqual([7, 8, 9, 10]);
  });

  it('clears', () => {
    const log = new DecisionLog(2);
    log.push(entry(1));
    log.clear();
    expect(log.size).toBe(0);
    expect(log.toJSONL()).toBe('');
    log.push(entry(2));
    expect(log.entries()).toHaveLength(1);
  });

  it('writes JSONL where every line parses back to the stored entry', () => {
    const log = new DecisionLog(3);
    for (let i = 0; i < 5; i++) log.push(entry(i, i === 3 ? 'boom' : undefined));
    const text = log.toJSONL();
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l))).toEqual(log.entries());
    expect(JSON.parse(lines[1] as string).error).toBe('boom');
  });

  it('defaults to 20 000 entries and never has a capacity below 1', () => {
    expect(new DecisionLog().capacity).toBe(20_000);
    expect(new DecisionLog(0).capacity).toBe(1);
  });
});
