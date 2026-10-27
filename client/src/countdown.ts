export function createAntiDriftTimer(
  expiresAt: number,
  onTick: (remainingMs: number) => void
): () => void {
  let frameId: number | undefined;
  let active = true;

  const tick = (): void => {
    if (!active) {
      return;
    }

    const remainingMs = Math.max(0, expiresAt - Date.now());
    onTick(remainingMs);
    if (remainingMs > 0) {
      frameId = requestAnimationFrame(tick);
    } else {
      frameId = undefined;
    }
  };

  frameId = requestAnimationFrame(tick);
  return () => {
    active = false;
    if (frameId !== undefined) {
      cancelAnimationFrame(frameId);
      frameId = undefined;
    }
  };
}
