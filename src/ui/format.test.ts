import { describe, expect, it } from 'vitest';
import { formatKmh, formatPenalty, formatTime } from './format';

describe('formatTime', () => {
  it('formats zero and small times', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(0.5)).toBe('0:00.500');
    expect(formatTime(5.007)).toBe('0:05.007');
  });
  it('rolls over to minutes and keeps counting past 10 minutes', () => {
    expect(formatTime(59.999)).toBe('0:59.999');
    expect(formatTime(60)).toBe('1:00.000');
    expect(formatTime(75.25)).toBe('1:15.250');
    expect(formatTime(10 * 60 + 5)).toBe('10:05.000');
    expect(formatTime(125 * 60 + 1.5)).toBe('125:01.500');
  });
  it('rounds to the nearest millisecond, carrying into seconds', () => {
    expect(formatTime(1.2344)).toBe('0:01.234');
    expect(formatTime(1.2346)).toBe('0:01.235');
    expect(formatTime(59.9996)).toBe('1:00.000');
  });
  it('treats negative and non-finite values as zero', () => {
    expect(formatTime(-3)).toBe('0:00.000');
    expect(formatTime(NaN)).toBe('0:00.000');
    expect(formatTime(Infinity)).toBe('0:00.000');
  });
});

describe('formatKmh', () => {
  it('converts m/s to whole km/h', () => {
    expect(formatKmh(0)).toBe('0');
    expect(formatKmh(10)).toBe('36');
    expect(formatKmh(41.9)).toBe('151');
  });
  it('shows reversing as a positive number and survives NaN', () => {
    expect(formatKmh(-10)).toBe('36');
    expect(formatKmh(NaN)).toBe('0');
  });
});

describe('formatPenalty', () => {
  it('signs the value with one decimal', () => {
    expect(formatPenalty(2)).toBe('+2.0 s');
    expect(formatPenalty(0.25)).toBe('+0.3 s');
    expect(formatPenalty(-1.5)).toBe('-1.5 s');
    expect(formatPenalty(0)).toBe('+0.0 s');
  });
});
