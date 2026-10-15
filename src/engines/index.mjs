// Engine name -> module. Each module exports `render(scene, ctx) -> {clip}`.
const ENGINES = {
  html: () => import('./html.mjs'),
  onetake: () => import('./onetake.mjs'),
  opuscar: () => import('./opuscar.mjs'),
  'animation-base': () => import('./animation-base.mjs'),
  hyperframes: () => import('./hyperframes.mjs'),
  collage: () => import('./collage.mjs'),
  video: () => import('./video.mjs'),
  image: () => import('./image.mjs'),
};

export const ENGINE_NAMES = Object.keys(ENGINES);

export async function getEngine(name) {
  const load = ENGINES[name];
  if (!load) throw new Error(`Unknown engine "${name}". Known: ${ENGINE_NAMES.join(', ')}`);
  return load();
}
