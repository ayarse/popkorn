import { test, expect, describe } from 'bun:test';
import { applyEasing, stepEasing } from './easing';
import type { StepsEasing } from '../scene/types';

const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('steps() easing (CSS Easing L1 value tables)', () => {
  // steps(4, jump-end) — default: no jump at t=0, jump at t=1.
  test('steps(4, jump-end)', () => {
    const s: StepsEasing = { type: 'steps', count: 4, position: 'jump-end' };
    expect(applyEasing(0, s)).toBe(0);
    expect(applyEasing(0.1, s)).toBe(0);
    expect(applyEasing(0.3, s)).toBe(0.25);
    expect(applyEasing(0.6, s)).toBe(0.5);
    expect(applyEasing(0.9, s)).toBe(0.75);
    expect(applyEasing(1, s)).toBe(1);
  });

  // steps(4, jump-start): jumps immediately at t=0.
  test('steps(4, jump-start)', () => {
    const s: StepsEasing = { type: 'steps', count: 4, position: 'jump-start' };
    expect(applyEasing(0, s)).toBe(0.25);
    expect(applyEasing(0.1, s)).toBe(0.25);
    expect(applyEasing(0.3, s)).toBe(0.5);
    expect(applyEasing(0.6, s)).toBe(0.75);
    expect(applyEasing(0.9, s)).toBe(1);
    expect(applyEasing(1, s)).toBe(1);
  });

  // steps(4, jump-none): n distinct levels 0..1, no jump at either edge.
  test('steps(4, jump-none)', () => {
    const s: StepsEasing = { type: 'steps', count: 4, position: 'jump-none' };
    expect(applyEasing(0, s)).toBe(0);
    expect(approx(applyEasing(0.3, s), 1 / 3)).toBe(true);
    expect(approx(applyEasing(0.6, s), 2 / 3)).toBe(true);
    expect(applyEasing(0.9, s)).toBe(1);
    expect(applyEasing(1, s)).toBe(1);
  });

  // steps(4, jump-both): jump at both edges, n+1 intervals.
  test('steps(4, jump-both)', () => {
    const s: StepsEasing = { type: 'steps', count: 4, position: 'jump-both' };
    expect(applyEasing(0, s)).toBe(0.2);
    expect(applyEasing(0.3, s)).toBe(0.4);
    expect(applyEasing(0.6, s)).toBe(0.6);
    expect(applyEasing(0.9, s)).toBe(0.8);
    expect(applyEasing(1, s)).toBe(1);
  });

  test('step-start === steps(1, jump-start): holds at end value', () => {
    expect(applyEasing(0, 'step-start')).toBe(1);
    expect(applyEasing(0.5, 'step-start')).toBe(1);
    expect(applyEasing(1, 'step-start')).toBe(1);
    expect(stepEasing(0.5, 1, 'jump-start')).toBe(1);
  });

  test('step-end === steps(1, jump-end): holds at start value (unchanged)', () => {
    expect(applyEasing(0, 'step-end')).toBe(0);
    expect(applyEasing(0.5, 'step-end')).toBe(0);
    expect(applyEasing(0.999, 'step-end')).toBe(0);
    expect(applyEasing(1, 'step-end')).toBe(1);
  });
});
