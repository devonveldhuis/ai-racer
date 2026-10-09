/** Game-level keys (not driving): reset, pause, restart, new track, camera, help, sensor overlay, decision log download. */

export interface GameKeyHandlers {
  reset(): void;
  pause(): void;
  restart(): void;
  newTrack(): void;
  cycleCamera(): void;
  toggleHelp(): void;
  toggleSensors(): void;
  downloadLog(): void;
}

/** The part of `Window` the keys need; lets tests pass a fake. */
export interface KeyTarget {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void;
}

/** Installs the key handlers on `target`; returns a function that removes them. */
export function installGameKeys(handlers: GameKeyHandlers, target: KeyTarget = window): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'F1') {
      e.preventDefault(); // not the browser's help
      if (!e.repeat) handlers.toggleSensors();
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 'r':
        handlers.reset();
        break;
      case 'c':
        handlers.cycleCamera();
        break;
      case 'h':
        handlers.toggleHelp();
        break;
      case 'escape':
        handlers.pause();
        break;
      case 'enter':
        handlers.restart();
        break;
      case 'n':
        handlers.newTrack();
        break;
      case 'l':
        handlers.downloadLog();
        break;
    }
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
