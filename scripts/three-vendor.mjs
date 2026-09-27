import { readFile, writeFile } from 'node:fs/promises';

export const threeModules = new Map([
  ['three.core.js', 'build/three.core.js'],
  ['three.module.js', 'build/three.module.js'],
  ['GLTFLoader.js', 'examples/jsm/loaders/GLTFLoader.js'],
  ['BufferGeometryUtils.js', 'examples/jsm/utils/BufferGeometryUtils.js'],
  ['SkeletonUtils.js', 'examples/jsm/utils/SkeletonUtils.js'],
]);

// Preview and production use the same pinned, local Three.js modules.
export async function readThreeModule(name) {
  const source = threeModules.get(name);
  if (!source) throw new Error('Unknown Three.js module');
  return (await readFile(new URL(`../node_modules/three/${source}`, import.meta.url), 'utf8'))
    .replaceAll("from 'three'", "from './three.module.js'")
    .replaceAll("from '../utils/", "from './");
}

if (process.argv.includes('--build')) {
  for (const name of threeModules.keys()) {
    await writeFile(new URL(`../dist/site/assets/${name}`, import.meta.url), await readThreeModule(name));
  }
}
