import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAntiDriftTimer } from "../client/src/countdown";

let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function runNextFrame(): void {
  const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!entry) {
    throw new Error("No animation frame is scheduled");
  }
  frames.delete(entry[0]);
  entry[1](Date.now());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  frames = new Map();
  nextFrameId = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("recomputes remaining time from the absolute deadline after delayed frames", () => {
  const ticks: number[] = [];
  createAntiDriftTimer(1_000, (remainingMs) => ticks.push(remainingMs));

  runNextFrame();
  vi.setSystemTime(750);
  runNextFrame();
  vi.setSystemTime(1_800);
  runNextFrame();

  expect(ticks).toEqual([1_000, 250, 0]);
  expect(frames.size).toBe(0);
});

it("cancels the scheduled frame and ignores callbacks after cleanup", () => {
  const onTick = vi.fn();
  const cleanup = createAntiDriftTimer(10_000, onTick);
  const pendingFrame = frames.values().next().value as FrameRequestCallback | undefined;

  cleanup();
  pendingFrame?.(Date.now());

  expect(onTick).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

it("reports zero immediately when the deadline has already passed", () => {
  const ticks: number[] = [];
  createAntiDriftTimer(-1, (remainingMs) => ticks.push(remainingMs));

  runNextFrame();

  expect(ticks).toEqual([0]);
  expect(frames.size).toBe(0);
});
