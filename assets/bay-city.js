import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';
import { mergeGeometries } from './BufferGeometryUtils.js';

/** Batch only static architecture; animated car hierarchies remain independent. */
function batchArchitecture(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse(object => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    for (let parent = object; parent; parent = parent.parent) {
      if (/^Traffic[ _]car/.test(parent.name)) return;
    }
    const material = object.material;
    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push(object);
  });
  for (const [material, meshes] of groups) {
    const parts = meshes.map(mesh => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      // Solid PBR materials: no textures or texture coordinates in this asset.
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
      }
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      return geometry.applyMatrix4(mesh.matrixWorld);
    });
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!geometry) continue;
    const batch = new THREE.Mesh(geometry, material);
    batch.name = `Architecture / ${material.name}`;
    batch.castShadow = material.name !== 'Bay water';
    batch.receiveShadow = true;
    meshes.forEach(mesh => mesh.removeFromParent());
    root.add(batch);
  }
}

/** Authored Blender asset, with its camera, lighting and continuous traffic. */
export async function createBayCity(host, onContextLost) {
  const gltf = await new GLTFLoader().loadAsync(new URL('./insider-city.glb', import.meta.url).href);
  const camera = gltf.cameras.find(item => item.isOrthographicCamera);
  if (!camera) throw new Error('The city asset is missing its delivery camera.');
  batchArchitecture(gltf.scene);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#092526');
  scene.add(gltf.scene);
  scene.add(new THREE.HemisphereLight('#adc6cd', '#233c31', .65));
  gltf.scene.traverse(object => {
    if (object.isDirectionalLight && /Warm/.test(object.name)) {
      object.castShadow = true;
      object.shadow.mapSize.set(2048, 2048);
      Object.assign(object.shadow.camera, { left: -65, right: 65, top: 50, bottom: -50, near: .1, far: 180 });
      object.shadow.normalBias = .04;
    }
  });
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const halfWidth = (camera.right - camera.left) / 2;
  const halfHeight = (camera.top - camera.bottom) / 2;
  function resize() {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const y = Math.max(halfHeight, halfWidth / aspect);
    Object.assign(camera, { left: -y * aspect, right: y * aspect, top: y, bottom: -y });
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const mixer = new THREE.AnimationMixer(gltf.scene);
  gltf.animations.forEach(clip => mixer.clipAction(clip).play());
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  host.append(renderer.domElement);
  let lastTime;
  renderer.setAnimationLoop(time => {
    mixer.update(lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, .1));
    lastTime = time;
    renderer.render(scene, camera);
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    observer.disconnect();
    renderer.domElement.remove();
    renderer.dispose();
    onContextLost();
  }, { once: true });
  renderer.render(scene, camera);
}
