import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import loadMujoco from "@mujoco/mujoco";
import mujocoWasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import { CupPlacementTask } from "./cup-task.js";
import "./style.css";

const $ = id => document.getElementById(id);
const viewport = $("viewport");
const canvas = $("sceneCanvas");
const loadNote = $("loadNote");
const statusText = $("statusText");
const statusDetail = $("statusDetail");
const CAMERA_START = [-2.65, 2.4, 1.55];
const CAMERA_TARGET = [0.28, 0.18, 0.72];

let mujoco;
let model;
let data;
let standKeyframe = -1;
let mjvScene;
let mjvOption;
let mjvPerturb;
let mjvCamera;
let threeScene;
let camera;
let renderer;
let controls;
let cupTask;
let frameItems = [];
let geometryCache = new Map();
let solidSurfaces = true;
let simulationPlaying = false;
let activePersona = "sarah";
let previousFrameTime = performance.now();
let animationFrame = 0;

function setStatus(title, detail, running = false) {
  statusText.textContent = title;
  statusDetail.textContent = detail;
  $("statusMark").classList.toggle("live", running);
  $("liveDot").classList.toggle("visible", running);
}

function setLoadNote(text, state = "") {
  loadNote.textContent = text;
  loadNote.className = "load-note" + (state ? " " + state : "");
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function probeWebGL(type) {
  const probeCanvas = document.createElement("canvas");
  try {
    const context = probeCanvas.getContext(type);
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function createWebGLRenderer() {
  const attempts = [
    { canvas, antialias: false, alpha: false, powerPreference: "low-power" },
    { canvas, antialias: false, alpha: false, powerPreference: "default" }
  ];
  let lastError;
  for (const options of attempts) {
    try {
      return new THREE.WebGLRenderer(options);
    } catch (error) {
      lastError = error;
    }
  }

  const webgl2Available = probeWebGL("webgl2");
  const webgl1Available = webgl2Available || probeWebGL("webgl");
  if (!webgl2Available && webgl1Available) {
    throw new Error("This browser only provides WebGL 1, but the simulation requires WebGL 2. Update your browser and reload.");
  }
  if (!webgl2Available) {
    throw new Error("This browser or device is not providing WebGL 2. Enable hardware acceleration in browser settings, then reload. If it still fails, use a browser and device with WebGL 2 support.");
  }
  throw new Error(`The browser supports WebGL 2 but could not allocate a rendering context. Close other GPU-heavy tabs and reload. ${lastError?.message || ""}`.trim());
}

function createRenderer() {
  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x090b0f);
  threeScene.fog = new THREE.Fog(0x090b0f, 3.8, 9);
  camera = new THREE.PerspectiveCamera(39, 1, 0.03, 30);
  camera.up.set(0, 0, 1);
  camera.position.set(...CAMERA_START);
  renderer = createWebGLRenderer();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const hemi = new THREE.HemisphereLight(0xe9eff8, 0x20252d, 1.9);
  threeScene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1.5, -1.6, 3.2);
  threeScene.add(key);
  const fill = new THREE.DirectionalLight(0x91baff, 1.15);
  fill.position.set(-1.8, 1.8, 2.1);
  threeScene.add(fill);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAMERA_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 1.25;
  controls.maxDistance = 4.8;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  resizeRenderer();
  window.addEventListener("resize", resizeRenderer);
  if ("ResizeObserver" in window) new ResizeObserver(resizeRenderer).observe(viewport);

  const grid = new THREE.GridHelper(6, 40, 0x3c516b, 0x202c3b);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  threeScene.add(grid);
}

function getGeometry(meshId) {
  if (geometryCache.has(meshId)) return geometryCache.get(meshId);
  const vertexStart = Number(model.mesh_vertadr[meshId]);
  const vertexCount = Number(model.mesh_vertnum[meshId]);
  const faceStart = Number(model.mesh_faceadr[meshId]);
  const faceCount = Number(model.mesh_facenum[meshId]);
  const sourceVertices = model.mesh_vert.subarray(vertexStart * 3, (vertexStart + vertexCount) * 3);
  const sourceFaces = model.mesh_face.subarray(faceStart * 3, (faceStart + faceCount) * 3);
  // MuJoCo stores each mesh's face indices relative to that mesh's vertex slice.
  const localFaces = new Uint32Array(sourceFaces);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sourceVertices), 3));
  geometry.setIndex(new THREE.BufferAttribute(localFaces, 1));
  // Compiled mesh orientation and scale are already represented by MuJoCo's MjvGeom pose.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometryCache.set(meshId, geometry);
  return geometry;
}

function geometryFor(mjGeom) {
  const type = Number(mjGeom.type);
  const size = Array.from(mjGeom.size, Number);
  const meshId = Number(mjGeom.dataid);
  if (type === mujoco.mjtGeom.mjGEOM_MESH.value && meshId >= 0) return getGeometry(meshId);
  const key = `${type}:${size.join(",")}:${meshId}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  let geometry;
  if (type === mujoco.mjtGeom.mjGEOM_PLANE.value) {
    geometry = new THREE.PlaneGeometry(2 * (size[0] || 6), 2 * (size[1] || 6));
  } else if (type === mujoco.mjtGeom.mjGEOM_SPHERE.value) {
    geometry = new THREE.SphereGeometry(size[0], 24, 16);
  } else if (type === mujoco.mjtGeom.mjGEOM_CAPSULE.value) {
    geometry = new THREE.CapsuleGeometry(size[0], 2 * size[2], 6, 18);
    geometry.rotateX(Math.PI / 2);
  } else if (type === mujoco.mjtGeom.mjGEOM_BOX.value) {
    geometry = new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
  } else if (type === mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
    geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 28, 1);
    geometry.rotateX(Math.PI / 2);
  } else if (type === mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) {
    geometry = new THREE.SphereGeometry(1, 24, 16);
    geometry.scale(size[0], size[1], size[2]);
  } else {
    geometry = new THREE.BufferGeometry();
  }
  geometryCache.set(key, geometry);
  return geometry;
}

function makeSceneItem(mjGeom, groupId) {
  const geometry = geometryFor(mjGeom);
  const isHumanoid = groupId === 2;
  const item = new THREE.Group();
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: isHumanoid ? 0xaabbd0 : new THREE.Color().setRGB(Number(mjGeom.rgba[0]), Number(mjGeom.rgba[1]), Number(mjGeom.rgba[2])),
    roughness: isHumanoid ? 0.48 : 0.48,
    metalness: isHumanoid ? 0.18 : 0.09,
    transparent: isHumanoid || Number(mjGeom.rgba[3]) < 0.999,
    opacity: isHumanoid ? (solidSurfaces ? 1 : 0.88) : Number(mjGeom.rgba[3]),
    side: THREE.DoubleSide,
    depthWrite: !isHumanoid || solidSurfaces
  });
  const surface = new THREE.Mesh(geometry, surfaceMaterial);
  surface.castShadow = true;
  surface.receiveShadow = true;
  item.add(surface);
  item.userData.humanoid = isHumanoid;
  item.userData.surfaceMaterial = surfaceMaterial;
  return item;
}

function syncScene() {
  if (!mjvScene) return;
  mujoco.mjv_updateScene(model, data, mjvOption, mjvPerturb, mjvCamera, mujoco.mjtCatBit.mjCAT_ALL.value, mjvScene);
  const geoms = mjvScene.geoms;
  const count = Number(geoms.size());
  for (let index = 0; index < count; index += 1) {
    const mjGeom = geoms.get(index);
    const objectType = Number(mjGeom.objtype);
    const objectId = Number(mjGeom.objid);
    const sourceGroup = objectType === mujoco.mjtObj.mjOBJ_GEOM.value && objectId >= 0 ? Number(model.geom_group[objectId]) : 0;
    let item = frameItems[index];
    if (!item) {
      item = makeSceneItem(mjGeom, sourceGroup);
      frameItems[index] = item;
      threeScene.add(item);
    }
    const rgba = Array.from(mjGeom.rgba, Number);
    const matrix = Array.from(mjGeom.mat, Number);
    const position = Array.from(mjGeom.pos, Number);
    const hidden = sourceGroup === 3 || rgba[3] <= 0.001;
    item.visible = !hidden;
    item.matrixAutoUpdate = false;
    item.matrix.set(
      matrix[0], matrix[1], matrix[2], position[0],
      matrix[3], matrix[4], matrix[5], position[1],
      matrix[6], matrix[7], matrix[8], position[2],
      0, 0, 0, 1
    );
    item.matrixWorldNeedsUpdate = true;
    if (!item.userData.humanoid) {
      item.userData.surfaceMaterial.color.setRGB(rgba[0], rgba[1], rgba[2]);
      item.userData.surfaceMaterial.opacity = rgba[3];
      item.userData.surfaceMaterial.transparent = rgba[3] < 0.999;
    } else {
      item.userData.surfaceMaterial.opacity = solidSurfaces ? 1 : 0.88;
      item.userData.surfaceMaterial.depthWrite = solidSurfaces;
      item.userData.surfaceMaterial.wireframe = !solidSurfaces;
    }
    mjGeom.delete();
  }
  for (let index = count; index < frameItems.length; index += 1) frameItems[index].visible = false;
  geoms.delete();
}

function baseUrl(relativePath) {
  return new URL(relativePath, new URL(import.meta.env.BASE_URL, window.location.href));
}

async function fetchText(relativePath) {
  const response = await fetch(baseUrl(relativePath));
  if (!response.ok) throw new Error(`${relativePath} returned HTTP ${response.status}.`);
  return response.text();
}

async function fetchBytes(relativePath) {
  const response = await fetch(baseUrl(relativePath));
  if (!response.ok) throw new Error(`${relativePath} returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadG1Scene() {
  const modelPath = "models/unitree_g1/";
  setLoadNote("Checking the single-threaded MuJoCo WebAssembly asset…");
  const wasmResponse = await fetch(new URL(mujocoWasmUrl, window.location.href));
  if (!wasmResponse.ok) throw new Error(`MuJoCo WebAssembly returned HTTP ${wasmResponse.status}.`);
  if (!wasmResponse.headers.get("content-type")?.includes("wasm")) {
    throw new Error(`MuJoCo WebAssembly has unexpected content type: ${wasmResponse.headers.get("content-type") || "missing"}.`);
  }
  mujoco = await loadMujoco({ locateFile: file => file.endsWith(".wasm") ? new URL(mujocoWasmUrl, window.location.href).href : file });

  setLoadNote("Loading the G1 humanoid mesh assets…");
  const [g1Xml, sceneXml] = await Promise.all([
    fetchText(modelPath + "g1_with_hands.xml"),
    fetchText(modelPath + "scene.xml")
  ]);
  const meshFiles = [...new Set(Array.from(g1Xml.matchAll(/<mesh\b[^>]*\bfile="([^"]+)"/g), match => match[1]))];
  if (meshFiles.length < 40) throw new Error(`Expected the full G1 model mesh set; found ${meshFiles.length} mesh assets.`);
  const vfs = new mujoco.MjVFS();
  try {
    vfs.addBuffer("g1_with_hands.xml", new TextEncoder().encode(g1Xml));
    let loaded = 0;
    await Promise.all(meshFiles.map(async file => {
      const bytes = await fetchBytes(`${modelPath}assets/${file}`);
      vfs.addBuffer(`assets/${file}`, bytes);
      loaded += 1;
      setLoadNote(`Loading G1 mesh assets · ${loaded} of ${meshFiles.length}`);
    }));
    model = mujoco.MjModel.from_xml_string(sceneXml, vfs);
  } finally {
    vfs.delete();
  }

  data = new mujoco.MjData(model);
  standKeyframe = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY.value, "stand");
  if (standKeyframe < 0) throw new Error("The G1 model did not include its standing keyframe.");
  mujoco.mj_resetDataKeyframe(model, data, standKeyframe);
  mujoco.mj_forward(model, data);

  const requiredGeoms = ["torso_link", "head_link", "left_hand_palm_link", "right_hand_palm_link", "left_ankle_roll_link", "right_ankle_roll_link"];
  const absent = requiredGeoms.filter(name => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_MESH.value, name) < 0);
  if (absent.length) throw new Error(`The full G1 mesh set is incomplete: ${absent.join(", " )}.`);
  const badKeyframeJoints = [];
  for (let joint = 0; joint < model.njnt; joint += 1) {
    if (Number(model.jnt_type[joint]) === mujoco.mjtJoint.mjJNT_FREE.value || !model.jnt_limited[joint]) continue;
    const address = Number(model.jnt_qposadr[joint]);
    const value = Number(data.qpos[address]);
    const low = Number(model.jnt_range[joint * 2]);
    const high = Number(model.jnt_range[joint * 2 + 1]);
    if (value < low || value > high) badKeyframeJoints.push(joint);
  }
  if (badKeyframeJoints.length) throw new Error(`The standing keyframe contains ${badKeyframeJoints.length} joint value(s) outside their limits.`);

  mjvScene = new mujoco.MjvScene(model, 2048);
  mjvOption = new mujoco.MjvOption();
  mjvPerturb = new mujoco.MjvPerturb();
  mjvCamera = new mujoco.MjvCamera();
  mujoco.mjv_defaultFreeCamera(model, mjvCamera);

  mujoco.mj_forward(model, data);
  syncScene();
  return { meshCount: meshFiles.length, jointCount: model.njnt - 1, actuatorCount: model.nu };
}

function renderTimeline(index = -1, complete = false, progress = 0) {
  const phases = cupTask?.phases || [];
  const timeline = $("timelineSteps");
  timeline.replaceChildren(...phases.map((phase, phaseIndex) => {
    const item = document.createElement("span");
    item.className = "timeline-step";
    item.textContent = phase.label;
    if (complete || phaseIndex < index) item.classList.add("done");
    else if (phaseIndex === index) item.classList.add("active");
    return item;
  }));
  $("progressFill").style.width = `${progress}%`;
  $("progressTrack").setAttribute("aria-valuenow", String(progress));
  $("stepCount").textContent = complete ? "Complete" : index >= 0 ? `${index + 1} / ${phases.length}` : "Ready";
}

function onTaskUpdate(event) {
  if (event.type === "phase") {
    renderTimeline(event.index, false, event.progress);
    setStatus(event.label, event.detail, true);
    setLoadNote(`Running · ${event.label}`, "ready");
    $("runBtn").disabled = true;
    $("runBtn").textContent = "Cup placement running";
    return;
  }
  if (event.type === "complete") {
    simulationPlaying = false;
    renderTimeline(cupTask.phases.length, true, 100);
    const placed = event.placed;
    setStatus(
      placed ? "Cup placed on the counter" : "Motion sequence complete",
      placed ? "MuJoCo contacts and gravity settled the free cup at its target location." : "The cup completed the motion sequence but finished outside the target placement tolerance."
    );
    setLoadNote(placed ? "Cup placed · Run again or reset" : "Cup missed · Retry or reset", placed ? "ready" : "error");
    $("runBtn").disabled = false;
    $("runBtn").textContent = placed ? "Run again" : "Retry cup placement";
    $("pauseBtn").disabled = true;
    $("pauseBtn").textContent = "Pause";
    $("resetBtn").disabled = false;
    $("confirmBtn").hidden = true;
    return;
  }
  if (event.type === "failed") {
    simulationPlaying = false;
    renderTimeline(cupTask.stepIndex, false, event.progress);
    setStatus("Cup task stopped", event.detail);
    setLoadNote("Task stopped · Retry or reset", "error");
    $("runBtn").disabled = false;
    $("runBtn").textContent = "Retry cup placement";
    $("pauseBtn").disabled = true;
    $("resetBtn").disabled = false;
    $("confirmBtn").hidden = true;
    return;
  }
  if (event.type === "reset") {
    renderTimeline(-1, false, 0);
    setStatus("Ready to place the cup", "Start the physics-based cup task. The G1 pelvis remains fixed for this tabletop demonstration.");
    setLoadNote("MuJoCo ready · Start cup placement", "ready");
    $("runBtn").disabled = false;
    $("runBtn").textContent = "Start cup placement";
    $("pauseBtn").disabled = true;
    $("pauseBtn").textContent = "Pause";
    $("resetBtn").disabled = false;
    $("confirmBtn").hidden = true;
  }
}

function updatePersonaDisplay() {
  const personalized = $("personalization").checked;
  const sarah = activePersona === "sarah";
  $("stageMode").textContent = personalized ? `SECONDSELF · ${activePersona.toUpperCase()}` : "STANDARD ROUTINE";
  $("preferenceTitle").textContent = sarah ? "Sarah’s preferences" : "Alex’s preferences";
  $("preferences").replaceChildren(...(sarah
    ? ["Prefers a quiet morning", "Familiar, authorised steps may proceed independently", "A measured pace with a settling pause"]
    : ["Prefers a short explanation first", "Confirm before the cup is handled", "A quicker pace after approval"]
  ).map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
  $("behaviorBadge").innerHTML = `Behaviour mode · <strong>${personalized ? `${sarah ? "Sarah" : "Alex"}’s SecondSelf` : "Standard routine"}</strong>`;
  $("explainTitle").textContent = !personalized ? "A consistent cup routine" : sarah ? "A measured, familiar routine" : "Explain, confirm, then act";
  $("explainText").textContent = !personalized
    ? "Persona-specific pauses and confirmation are turned off; the standard motion sequence remains physics-driven."
    : sarah
      ? "Sarah’s profile uses a slower reach and an additional settling pause before the cup is moved."
      : "Alex’s profile requires confirmation before the task starts, then uses a quicker movement.";
  $("modeHelp").textContent = personalized
    ? `${sarah ? "Sarah’s" : "Alex’s"} profile changes movement pace and pause steps${!sarah ? "; Alex also confirms before the task starts" : ""}.`
    : "The standard cup task runs without persona-specific pauses or confirmation.";
}

function beginCupTask() {
  if (cupTask.isFailed || cupTask.isFinished) resetCupTask();
  if (cupTask.isPaused) cupTask.resume();
  else cupTask.start({ persona: activePersona, personalized: $("personalization").checked });
  simulationPlaying = cupTask.isRunning;
  $("runBtn").disabled = true;
  $("pauseBtn").disabled = !simulationPlaying;
  $("pauseBtn").textContent = "Pause";
  $("resetBtn").disabled = false;
  $("confirmBtn").hidden = true;
  $("sarahBtn").disabled = true;
  $("alexBtn").disabled = true;
  $("personalization").disabled = true;
}

function resetCupTask() {
  simulationPlaying = false;
  mujoco.mj_resetDataKeyframe(model, data, standKeyframe);
  mujoco.mj_forward(model, data);
  cupTask.reset();
  syncScene();
  $("sarahBtn").disabled = false;
  $("alexBtn").disabled = false;
  $("personalization").disabled = false;
}

function wireControls() {
  $("cameraReset").addEventListener("click", () => {
    camera.position.set(...CAMERA_START);
    controls.target.set(...CAMERA_TARGET);
    controls.update();
  });
  $("solidToggle").addEventListener("change", event => {
    solidSurfaces = event.currentTarget.checked;
    frameItems.forEach(item => {
      if (!item.userData.humanoid) return;
      item.userData.surfaceMaterial.opacity = solidSurfaces ? 1 : 0.88;
      item.userData.surfaceMaterial.depthWrite = solidSurfaces;
      item.userData.surfaceMaterial.wireframe = !solidSurfaces;
    });
  });
  const selectPersona = name => {
    if (simulationPlaying || cupTask?.isPaused || cupTask?.isFinished || cupTask?.isFailed) return;
    activePersona = name;
    $("sarahBtn").setAttribute("aria-pressed", String(name === "sarah"));
    $("alexBtn").setAttribute("aria-pressed", String(name === "alex"));
    updatePersonaDisplay();
  };
  $("sarahBtn").addEventListener("click", () => selectPersona("sarah"));
  $("alexBtn").addEventListener("click", () => selectPersona("alex"));
  $("personalization").addEventListener("change", updatePersonaDisplay);
  $("runBtn").addEventListener("click", () => {
    if (activePersona === "alex" && $("personalization").checked) {
      $("confirmBtn").hidden = false;
      $("runBtn").disabled = true;
      $("sarahBtn").disabled = true;
      $("alexBtn").disabled = true;
      $("personalization").disabled = true;
      setStatus("Waiting for Alex’s confirmation", "The task will not begin until the new cup handling action is confirmed.");
      return;
    }
    beginCupTask();
  });
  $("confirmBtn").addEventListener("click", beginCupTask);
  $("pauseBtn").addEventListener("click", () => {
    if (simulationPlaying) {
      simulationPlaying = false;
      cupTask.pause();
      $("pauseBtn").textContent = "Resume";
      setStatus("Simulation paused", "The MuJoCo state is held. Resume to continue the same action sequence.");
    } else if (cupTask?.isPaused) {
      simulationPlaying = true;
      cupTask.resume();
      $("pauseBtn").textContent = "Pause";
      setStatus(cupTask.phases[cupTask.stepIndex].label, cupTask.phases[cupTask.stepIndex].detail, true);
    }
  });
  $("resetBtn").addEventListener("click", resetCupTask);
}

function renderLoop(timestamp) {
  animationFrame = requestAnimationFrame(renderLoop);
  const elapsed = Math.min(0.05, Math.max(0, (timestamp - previousFrameTime) / 1000));
  previousFrameTime = timestamp;
  if (model && data && simulationPlaying && elapsed > 0) {
    try {
      const timestep = Number(model.opt.timestep);
      const stepCount = Math.min(30, Math.ceil(elapsed / timestep));
      for (let index = 0; index < stepCount && simulationPlaying; index += 1) {
        cupTask.advance(timestep);
        mujoco.mj_step(model, data);
      }
      syncScene();
    } catch (error) {
      console.error(error);
      cupTask.fail(`The browser simulation stopped on an error: ${error?.message || String(error)}`);
    }
  }
  controls?.update();
  if (renderer && threeScene && camera) renderer.render(threeScene, camera);
}

function dispose() {
  cancelAnimationFrame(animationFrame);
  if (mjvScene) mjvScene.delete();
  if (mjvCamera) mjvCamera.delete();
  if (mjvPerturb) mjvPerturb.delete();
  if (mjvOption) mjvOption.delete();
  if (cupTask) cupTask.dispose();
  if (data) data.delete();
  if (model) model.delete();
  frameItems.forEach(item => {
    item.children.forEach(child => {
      if (child.userData.ownedGeometry) child.geometry.dispose();
      child.material.dispose();
    });
    threeScene?.remove(item);
  });
  geometryCache.forEach(geometry => geometry.dispose());
  geometryCache.clear();
  controls?.dispose();
  renderer?.dispose();
}

async function init() {
  try {
    createRenderer();
    setStatus("Preparing the full humanoid", "Checking the browser WebAssembly build, G1 meshes and standing pose.");
    const details = await loadG1Scene();
    cupTask = new CupPlacementTask(mujoco, model, data, onTaskUpdate);
    cupTask.phases = cupTask.phaseSpecs();
    renderTimeline(-1, false, 0);
    $("runBtn").disabled = false;
    $("pauseBtn").disabled = true;
    $("resetBtn").disabled = false;
    updatePersonaDisplay();
    if (import.meta.env.DEV) window.__mssDebug = { mujoco, model, data, cupTask };
    setLoadNote(`MuJoCo ready · Unitree G1 · ${details.jointCount} articulated joints · ${details.actuatorCount} actuators`, "ready");
    setStatus("Full humanoid loaded", `${details.meshCount} official G1 meshes loaded. Cup grasp and placement use articulated controls, contact and gravity.`);
    $("stageMode").textContent = "SECONDSELF · SARAH";
    canvas.setAttribute("aria-label", "Full articulated Unitree G1 humanoid with head, torso, both arms and hands, both legs and feet, standing beside a MuJoCo kitchen counter and cup.");
  } catch (error) {
    console.error(error);
    setLoadNote(`Simulation failed to start: ${error?.message || String(error)}`, "error");
    setStatus("Simulation unavailable", "The browser could not create the 3D renderer or load MuJoCo and its assets. The error above identifies the failed step.");
    $("runBtn").disabled = true;
    $("pauseBtn").disabled = true;
    $("resetBtn").disabled = true;
  }
}

wireControls();
requestAnimationFrame(renderLoop);
window.addEventListener("beforeunload", dispose, { once: true });
init();
