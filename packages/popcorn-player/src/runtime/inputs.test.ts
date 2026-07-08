import { test, expect } from 'bun:test';
import { scrollProgress } from './inputs';

// scroll.progress = scrollY / max(1, scrollHeight - innerHeight)

test('scrollProgress normalizes over the scrollable range', () => {
  // range = 2000 - 800 = 1200; at scrollY 600 => 0.5.
  expect(scrollProgress(600, 2000, 800)).toBeCloseTo(0.5, 6);
  expect(scrollProgress(0, 2000, 800)).toBe(0);
  expect(scrollProgress(1200, 2000, 800)).toBeCloseTo(1, 6);
});

test('scrollProgress stays 0 when content is shorter than the viewport', () => {
  // Zero/negative range must not divide by zero -> NaN/Infinity.
  expect(scrollProgress(0, 500, 800)).toBe(0);
  expect(Number.isFinite(scrollProgress(0, 800, 800))).toBe(true);
});
