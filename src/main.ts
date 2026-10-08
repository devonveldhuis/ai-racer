import { parseUrlOverrides } from './core/config';

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'tiles') {
    const { runTilesView } = await import('./debug/tilesView');
    await runTilesView(params);
    return;
  }
  if (params.get('view') === 'track') {
    const { runTrackView } = await import('./debug/trackView');
    await runTrackView(params);
    return;
  }
  const { runGame } = await import('./game/Game');
  await runGame(parseUrlOverrides(window.location.search));
}

main().catch((err) => {
  console.error(err);
});
