import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SVGRenderer } from "three/examples/jsm/renderers/SVGRenderer.js";
import "./style.css";

const $ = id => document.getElementById(id);
const viewport = $("viewport");
const host = $("sceneCanvas");
const loadNote = $("loadNote");
const statusText = $("statusText");
const statusDetail = $("statusDetail");

const LINKS = Object.freeze({ shoulder: 0.225, elbow: 0.225 });
const STARTING_AXES = Object.freeze({ j1: 24, j2: -46, z: 85, j4: 30 });
const CAMERA_START = new THREE.Vector3(0.78, -1.08, 0.82);
const CAMERA_TARGET = new THREE.Vector3(0.02, 0.0, 0.39);

let scene;
let camera;
let renderer;
let controls;
let robot;
let j1Pivot;
let j2Pivot;
let zCarriage;
let j4Tool;
let resizeObserver;
let animationFrame = 0;

function lineMaterial(color, opacity = 1, linewidth = 1) {
  return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, linewidth });
}

function addLine(parent, points, material) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
  const line = new THREE.Line(geometry, material);
  parent.add(line);
  return line;
}

function addLineSegments(parent, points, material) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
  const lines = new THREE.LineSegments(geometry, material);
  parent.add(lines);
  return lines;
}

function addCircle(parent, radius, z, material, segments = 72) {
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z));
  }
  const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
  parent.add(circle);
  return circle;
}

function addWireBox(parent, size, position, material) {
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...size));
  const box = new THREE.LineSegments(geometry, material);
  box.position.set(...position);
  parent.add(box);
  return box;
}

function addWireCylinder(parent, radiusTop, radiusBottom, height, position, material, segments = 24) {
  const geometry = new THREE.EdgesGeometry(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
    1
  );
  const cylinder = new THREE.LineSegments(geometry, material);
  cylinder.rotation.x = Math.PI / 2;
  cylinder.position.set(...position);
  parent.add(cylinder);
  return cylinder;
}

function addLinkFrame(parent, length, material, accent) {
  const width = 0.094;
  const height = 0.046;
  addWireBox(parent, [length, width, height], [length / 2, 0, 0], material);
  const inset = 0.025;
  addLineSegments(parent, [
    [inset, -width * 0.5, height * 0.5], [length - inset, -width * 0.5, height * 0.5],
    [inset, width * 0.5, height * 0.5], [length - inset, width * 0.5, height * 0.5],
    [inset, -width * 0.5, -height * 0.5], [length - inset, -width * 0.5, -height * 0.5],
    [inset, width * 0.5, -height * 0.5], [length - inset, width * 0.5, -height * 0.5],
    [inset, -width * 0.5, height * 0.5], [length - inset, -width * 0.5, -height * 0.5],
    [inset, width * 0.5, height * 0.5], [length - inset, width * 0.5, -height * 0.5]
  ], accent);
  addWireCylinder(parent, 0.057, 0.057, 0.034, [0, 0, 0], material, 32);
  addCircle(parent, 0.067, 0.024, accent, 40);
  addCircle(parent, 0.067, -0.024, material, 40);
}

function createBase() {
  const group = new THREE.Group();
  const shell = lineMaterial(0xb8c5d5, 0.92);
  const accent = lineMaterial(0x75aef7, 0.92);
  addWireBox(group, [0.25, 0.25, 0.055], [0, 0, 0.035], shell);
  addWireBox(group, [0.20, 0.20, 0.26], [0, 0, 0.19], shell);
  addWireBox(group, [0.15, 0.15, 0.04], [0, 0, 0.34], accent);
  addWireCylinder(group, 0.093, 0.093, 0.036, [0, 0, 0.372], shell, 32);
  addCircle(group, 0.113, 0.393, accent, 48);
  addCircle(group, 0.07, 0.398, shell, 48);
  for (const x of [-0.091, 0.091]) {
    for (const y of [-0.091, 0.091]) {
      addWireCylinder(group, 0.009, 0.009, 0.058, [x, y, 0.018], accent, 8);
    }
  }
  group.position.z = 0;
  robot.add(group);
}

function createZAxis(material, accent) {
  const housing = new THREE.Group();
  // The vertical rails span the full published 200 mm travel with visual clearance.
  addWireBox(housing, [0.075, 0.075, 0.24], [0, 0, -0.105], material);
  for (const x of [-0.027, 0.027]) {
    for (const y of [-0.027, 0.027]) {
      addLine(housing, [[x, y, 0.018], [x, y, -0.218]], accent);
    }
  }
  addCircle(housing, 0.052, 0.012, accent, 40);
  zCarriage = new THREE.Group();
  addWireBox(zCarriage, [0.088, 0.088, 0.055], [0, 0, -0.025], accent);
  addWireCylinder(zCarriage, 0.024, 0.024, 0.072, [0, 0, -0.085], material, 20);
  j4Tool = new THREE.Group();
  addCircle(j4Tool, 0.047, -0.126, accent, 40);
  addCircle(j4Tool, 0.033, -0.127, material, 40);
  addWireBox(j4Tool, [0.055, 0.055, 0.022], [0, 0, -0.139], material);
  addLineSegments(j4Tool, [
    [-0.055, 0, -0.139], [0.055, 0, -0.139],
    [0, -0.055, -0.139], [0, 0.055, -0.139]
  ], accent);
  zCarriage.add(j4Tool);
  housing.add(zCarriage);
  return housing;
}

function createRobot() {
  robot = new THREE.Group();
  const frame = lineMaterial(0xc4cedb, 0.88);
  const accent = lineMaterial(0x83b6ff, 0.95);
  const detail = lineMaterial(0x72839a, 0.72);

  createBase();

  j1Pivot = new THREE.Group();
  j1Pivot.position.set(0, 0, 0.413);
  addCircle(j1Pivot, 0.079, 0, accent, 48);
  addWireCylinder(j1Pivot, 0.054, 0.054, 0.046, [0, 0, 0], frame, 32);
  addWireBox(j1Pivot, [0.16, 0.13, 0.053], [0.04, 0, 0.055], frame);
  addCircle(j1Pivot, 0.061, 0.084, detail, 40);
  addLinkFrame(j1Pivot, LINKS.shoulder, frame, accent);
  robot.add(j1Pivot);

  j2Pivot = new THREE.Group();
  j2Pivot.position.set(LINKS.shoulder, 0, 0);
  addCircle(j2Pivot, 0.064, 0, accent, 48);
  addWireCylinder(j2Pivot, 0.05, 0.05, 0.04, [0, 0, 0], frame, 32);
  addCircle(j2Pivot, 0.048, 0.025, detail, 40);
  addLinkFrame(j2Pivot, LINKS.elbow, frame, accent);
  const zAxis = createZAxis(frame, accent);
  zAxis.position.set(LINKS.elbow, 0, 0.018);
  j2Pivot.add(zAxis);
  j1Pivot.add(j2Pivot);

  // Fine engraved rails and joint ticks give the schematic a technical-drawing character.
  for (let index = 0; index <= 8; index += 1) {
    const x = (index / 8) * LINKS.shoulder;
    addLineSegments(j1Pivot, [[x, -0.061, -0.03], [x, -0.055, -0.03]], detail);
    const x2 = LINKS.shoulder + (index / 8) * LINKS.elbow;
    addLineSegments(j2Pivot, [[x2 - LINKS.shoulder, -0.061, -0.03], [x2 - LINKS.shoulder, -0.055, -0.03]], detail);
  }
  robot.scale.setScalar(1);
  scene.add(robot);
}

function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b0f);
  camera = new THREE.PerspectiveCamera(39, 1, 0.025, 12);
  camera.up.set(0, 0, 1);
  camera.position.copy(CAMERA_START);

  renderer = new SVGRenderer();
  renderer.setPrecision(2);
  renderer.setClearColor(0x090b0f, 1);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.replaceChildren(renderer.domElement);

  const grid = new THREE.GridHelper(1.55, 31, 0x36465d, 0x202b3a);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.48;
  scene.add(grid);

  const floorMark = lineMaterial(0x668ab7, 0.44);
  addCircle(scene, 0.45, 0.009, floorMark, 96);
  addCircle(scene, 0.225, 0.008, lineMaterial(0x4b596b, 0.28), 72);
  addLine(scene, [[-0.56, 0, 0.01], [0.56, 0, 0.01]], lineMaterial(0x42536a, 0.36));
  addLine(scene, [[0, -0.56, 0.01], [0, 0.56, 0.01]], lineMaterial(0x42536a, 0.36));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(CAMERA_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.72;
  controls.maxDistance = 2.7;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  createRobot();
  resizeRenderer();
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(viewport);
  }
  window.addEventListener("resize", resizeRenderer, { passive: true });
  renderer.render(scene, camera);
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function formatAngle(value) {
  const number = Number(value);
  const sign = number < 0 ? "−" : "";
  return `${sign}${Math.abs(number)}°`;
}

function readAxes() {
  return {
    j1: Number($("axisJ1").value),
    j2: Number($("axisJ2").value),
    z: Number($("axisZ").value),
    j4: Number($("axisJ4").value)
  };
}

function updateAxes() {
  const axes = readAxes();
  j1Pivot.rotation.z = THREE.MathUtils.degToRad(axes.j1);
  j2Pivot.rotation.z = THREE.MathUtils.degToRad(axes.j2);
  zCarriage.position.z = -axes.z / 1000;
  j4Tool.rotation.z = THREE.MathUtils.degToRad(axes.j4);
  $("valueJ1").textContent = formatAngle(axes.j1);
  $("valueJ2").textContent = formatAngle(axes.j2);
  $("valueZ").textContent = `${axes.z} mm`;
  $("valueJ4").textContent = formatAngle(axes.j4);
  statusDetail.textContent = `J1 ${formatAngle(axes.j1)} · J2 ${formatAngle(axes.j2)} · Z ${axes.z} mm · J4 ${formatAngle(axes.j4)}`;
  renderer.render(scene, camera);
}

function resetAxes() {
  $("axisJ1").value = STARTING_AXES.j1;
  $("axisJ2").value = STARTING_AXES.j2;
  $("axisZ").value = STARTING_AXES.z;
  $("axisJ4").value = STARTING_AXES.j4;
  updateAxes();
}

function resetCamera() {
  camera.position.copy(CAMERA_START);
  controls.target.copy(CAMERA_TARGET);
  controls.update();
  renderer.render(scene, camera);
}

function animate() {
  animationFrame = window.requestAnimationFrame(animate);
  if (controls.update()) renderer.render(scene, camera);
}

function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  loadNote.textContent = `Wire model could not start: ${message}`;
  loadNote.classList.add("error");
  statusText.textContent = "Wire model failed to load";
  statusDetail.textContent = "Reload the page. If the problem continues, check the browser console for details.";
  console.error("JS3 wire model failed to start", error);
}

try {
  createScene();
  updateAxes();
  $("axisJ1").addEventListener("input", updateAxes);
  $("axisJ2").addEventListener("input", updateAxes);
  $("axisZ").addEventListener("input", updateAxes);
  $("axisJ4").addEventListener("input", updateAxes);
  $("resetAxes").addEventListener("click", resetAxes);
  $("cameraReset").addEventListener("click", resetCamera);
  loadNote.textContent = "Interactive JS3 wire model ready · no WebGL required";
  animate();
} catch (error) {
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  showStartupError(error);
}
