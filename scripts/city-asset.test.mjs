import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const bytes = await readFile(new URL('../assets/insider-city.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const cars = gltf.scene.children.filter(object => /^Traffic_car_/.test(object.name));
const mixer = new AnimationMixer(gltf.scene);
gltf.animations.forEach(clip => mixer.clipAction(clip).play());

test('Blender delivery contains the camera, connector and six animated cars', () => {
  assert.ok(gltf.cameras.some(camera => camera.isOrthographicCamera));
  assert.ok(gltf.scene.getObjectByName('Coastal_connector_asphalt'));
  assert.equal(cars.length, 6);
  assert.equal(gltf.animations.filter(clip => clip.name.startsWith('Traffic car')).length, 6);
});

test('Traffic traverses bridge, descending connector and avenue', () => {
  const samples = [];
  for (let time = 0; time < 29.9; time += .1) {
    mixer.setTime(time);
    const p = cars[0].position;
    assert.ok([p.x, p.y, p.z].every(Number.isFinite));
    samples.push(p.clone());
  }
  // glTF converts Blender Z-up to Y-up; horizontal road Y becomes -Z.
  assert.ok(samples.some(p => p.x < -10 && Math.abs(p.y - 3.42) < .05));
  assert.ok(samples.some(p => p.x > 2 && p.x < 8 && p.y > .4 && p.y < 3.4));
  assert.ok(samples.some(p => p.x > 12 && Math.abs(p.y - .31) < .05));
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].distanceTo(samples[i - 1]) < .35, 'Traffic must not jump between roads');
  }
});

test('Animated geometry stays attached to each car and loop endpoints are unobtrusive', () => {
  for (const time of [0, 8, 15, 29.94]) {
    mixer.setTime(time);
    for (const car of cars) {
      assert.equal(car.children.length, 3);
      assert.equal(car.children.length, 3);
    }
  }
  mixer.setTime(0);
  assert.ok(cars[0].scale.x < .02);
  mixer.setTime(29.94);
  assert.ok(cars[0].scale.x < .2);
  const before = cars[0].position.clone();
  mixer.setTime(30);
  assert.ok(cars[0].position.distanceTo(before) > 50, 'Wrap should happen only at the route endpoints');
  assert.ok(cars[0].scale.x < .02, 'The wrapped car is nearly invisible');
});
