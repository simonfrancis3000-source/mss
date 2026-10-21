const ARM_JOINT_NAMES = [
  "left_shoulder_pitch_joint",
  "left_shoulder_roll_joint",
  "left_shoulder_yaw_joint",
  "left_elbow_joint",
  "left_wrist_roll_joint",
  "left_wrist_pitch_joint",
  "left_wrist_yaw_joint"
];

const FINGER_JOINT_NAMES = [
  "left_hand_thumb_0_joint",
  "left_hand_thumb_1_joint",
  "left_hand_thumb_2_joint",
  "left_hand_index_0_joint",
  "left_hand_index_1_joint",
  "left_hand_middle_0_joint",
  "left_hand_middle_1_joint"
];

const OPEN_FINGERS = [0.95, 0, 0, 0, 0, 0, 0];
const CLOSED_FINGERS = [-0.25, 0.7, 1.05, -0.85, -1.1, -0.85, -1.1];
const GRIP_HEIGHT = 0.08;
const LIFT_HEIGHT = 0.155;
const READY_POSE = [0.12, 0.24, 0.82];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

function solveLinear(matrix, vector, size) {
  const rows = Array.from({ length: size }, (_, row) => [
    ...matrix.slice(row * size, row * size + size),
    vector[row]
  ]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return Array(size).fill(0);
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const scale = rows[column][column];
    for (let k = column; k <= size; k += 1) rows[column][k] /= scale;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let k = column; k <= size; k += 1) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map(row => row[size]);
}

export class CupPlacementTask {
  constructor(mujoco, model, data, onUpdate = () => {}) {
    this.mujoco = mujoco;
    this.model = model;
    this.data = data;
    this.onUpdate = onUpdate;
    this.isRunning = false;
    this.isPaused = false;
    this.isFinished = false;
    this.isFailed = false;
    this.stepIndex = -1;
    this.phaseTime = 0;
    this.controlClock = 0;
    this.persona = "sarah";
    this.personalized = true;
    this.contactCount = 0;
    this.bestContactCount = 0;

    this.siteId = this.find(mujoco.mjtObj.mjOBJ_SITE, "left_palm_center");
    this.cupBodyId = this.find(mujoco.mjtObj.mjOBJ_BODY, "cup");
    this.cupJointId = this.find(mujoco.mjtObj.mjOBJ_JOINT, "cup_free");
    if (this.siteId < 0 || this.cupBodyId < 0 || this.cupJointId < 0) {
      throw new Error("The G1 palm site or free cup body is missing from the MuJoCo scene.");
    }

    this.arm = this.mapJoints(ARM_JOINT_NAMES);
    this.fingers = this.mapJoints(FINGER_JOINT_NAMES);
    this.jacpBuffer = new mujoco.DoubleBuffer(model.nv * 3);
    this.jacrBuffer = new mujoco.DoubleBuffer(model.nv * 3);
    this.leftHandBodies = new Set([
      "left_wrist_yaw_link",
      "left_hand_palm_link",
      "left_hand_thumb_0_link",
      "left_hand_thumb_1_link",
      "left_hand_thumb_2_link",
      "left_hand_index_0_link",
      "left_hand_index_1_link",
      "left_hand_middle_0_link",
      "left_hand_middle_1_link"
    ].map(name => this.find(mujoco.mjtObj.mjOBJ_BODY, name)).filter(id => id >= 0));
    this.cupGeoms = new Set();
    for (let geom = 0; geom < model.ngeom; geom += 1) {
      if (Number(model.geom_bodyid[geom]) === this.cupBodyId) this.cupGeoms.add(geom);
    }
    this.home = this.readSite();
    this.homeOrientation = this.readSiteOrientation();
    this.cupStart = this.readCup();
    this.cupPlace = [this.cupStart[0] + 0.05, this.cupStart[1], this.cupStart[2]];
    this.gripOffset = GRIP_HEIGHT;
  }

  find(objectType, name) {
    return this.mujoco.mj_name2id(this.model, objectType.value, name);
  }

  mapJoints(names) {
    const actuators = new Map();
    for (let actuator = 0; actuator < this.model.nu; actuator += 1) {
      const jointId = Number(this.model.actuator_trnid[actuator * 2]);
      actuators.set(jointId, actuator);
    }
    return names.map(name => {
      const id = this.find(this.mujoco.mjtObj.mjOBJ_JOINT, name);
      if (id < 0) throw new Error(`Missing articulated G1 joint: ${name}.`);
      const actuator = actuators.get(id);
      if (actuator === undefined) throw new Error(`The G1 joint ${name} has no position actuator.`);
      return {
        id,
        actuator,
        qpos: Number(this.model.jnt_qposadr[id]),
        dof: Number(this.model.jnt_dofadr[id]),
        low: Number(this.model.jnt_range[id * 2]),
        high: Number(this.model.jnt_range[id * 2 + 1])
      };
    });
  }

  readSite() {
    const offset = this.siteId * 3;
    return [Number(this.data.site_xpos[offset]), Number(this.data.site_xpos[offset + 1]), Number(this.data.site_xpos[offset + 2])];
  }

  readCup() {
    const offset = this.cupBodyId * 3;
    return [Number(this.data.xpos[offset]), Number(this.data.xpos[offset + 1]), Number(this.data.xpos[offset + 2])];
  }

  readSiteOrientation() {
    const offset = this.siteId * 9;
    return Array.from(this.data.site_xmat.slice(offset, offset + 9), Number);
  }

  phaseSpecs() {
    const sarah = this.personalized && this.persona === "sarah";
    const quick = this.personalized && this.persona === "alex";
    const duration = (measured, quickened) => quick ? quickened : measured;
    const initialAbove = [...this.cupStart];
    initialAbove[2] += 0.16;
    const raisedSide = [READY_POSE[0], READY_POSE[1], this.cupStart[2] + 0.16];
    const initialGrip = [...this.cupStart];
    initialGrip[2] += this.gripOffset;
    const initialLift = [...this.cupStart];
    initialLift[2] += LIFT_HEIGHT;
    const placeAbove = [...this.cupPlace];
    placeAbove[2] += LIFT_HEIGHT;
    const placeGrip = [...this.cupPlace];
    placeGrip[2] += this.gripOffset;
    return [
      { key: "clear", label: "Clear the cup", detail: "Move to a verified neutral waypoint before approaching the counter.", target: READY_POSE, duration: duration(1.2, 0.8) },
      { key: "raise", label: "Raise beside the cup", detail: "Lift the hand on a clear side path before moving over the cup.", target: raisedSide, duration: duration(3.8, 2.8) },
      { key: "approach", label: "Reach above the cup", detail: "Move over the cup while the down-facing hand stays clear of the counter.", target: initialAbove, duration: duration(1.8, 1.2) },
      { key: "align", label: "Lower into grasp position", detail: "Align the down-facing hand around the cup body.", target: initialGrip, duration: duration(1.4, 1.0) },
      { key: "close", label: "Close the three-finger hand", detail: "The thumb, index and middle fingers close under position control.", fingers: CLOSED_FINGERS, duration: duration(0.8, 0.5) },
      { key: "settle", label: "Check the physical grasp", detail: "MuJoCo contact and friction determine whether the cup is held.", duration: sarah ? 1.2 : (quick ? 0.45 : 0.75) },
      { key: "lift", label: "Lift the cup", detail: "Raise the hand and cup together through contact forces.", target: initialLift, duration: duration(1.2, 0.9) },
      { key: "carry", label: "Move to the counter position", detail: "Carry the cup 5 cm while the fingers maintain contact.", target: placeAbove, duration: duration(1.2, 0.9) },
      { key: "lower", label: "Lower onto the counter", detail: "Place the cup above the counter surface before releasing.", target: placeGrip, duration: duration(1.4, 1.0) },
      { key: "open", label: "Release the cup", detail: "Open the hand and let the cup settle under gravity.", fingers: OPEN_FINGERS, duration: 0.45 },
      { key: "place-settle", label: "Check the placement", detail: "Wait for the free cup body to settle on the counter.", duration: sarah ? 1.0 : 0.55 },
      { key: "return", label: "Return to a clear ready pose", detail: "Move the articulated arm back to a verified ready waypoint.", target: READY_POSE, duration: duration(1.5, 1.1) }
    ];
  }

  start({ persona = "sarah", personalized = true } = {}) {
    if (this.isFinished || this.isFailed) return false;
    this.persona = persona;
    this.personalized = personalized;
    this.phases = this.phaseSpecs();
    this.isRunning = true;
    this.isPaused = false;
    this.enterPhase(0);
    return true;
  }

  resume() {
    if (this.isFinished || this.isFailed) return;
    this.isRunning = true;
    this.isPaused = false;
  }

  pause() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.isPaused = true;
  }

  reset() {
    this.isRunning = false;
    this.isPaused = false;
    this.isFinished = false;
    this.isFailed = false;
    this.stepIndex = -1;
    this.phaseTime = 0;
    this.controlClock = 0;
    this.contactCount = 0;
    this.bestContactCount = 0;
    this.home = this.readSite();
    this.homeOrientation = this.readSiteOrientation();
    this.cupStart = this.readCup();
    this.cupPlace = [this.cupStart[0] + 0.05, this.cupStart[1], this.cupStart[2]];
    this.gripOffset = GRIP_HEIGHT;
    this.onUpdate({ type: "reset", progress: 0 });
  }

  enterPhase(index) {
    if (index >= this.phases.length) {
      this.isRunning = false;
      this.isFinished = true;
      this.onUpdate({
        type: "complete",
        progress: 100,
        cup: this.readCup(),
        placed: this.isCupAtPlace()
      });
      return;
    }
    this.stepIndex = index;
    this.phaseTime = 0;
    const phase = this.phases[index];
    phase.start = this.readSite();
    phase.fingerStart = this.fingers.map(joint => Number(this.data.ctrl[joint.actuator]));
    this.onUpdate({
      type: "phase",
      index,
      total: this.phases.length,
      label: phase.label,
      detail: phase.detail,
      progress: Math.round(index / this.phases.length * 100),
      key: phase.key
    });
  }

  advance(dt) {
    if (!this.isRunning || this.stepIndex < 0) return;
    const phase = this.phases[this.stepIndex];
    this.phaseTime += dt;
    this.controlClock += dt;
    const fraction = smooth(this.phaseTime / Math.max(phase.duration, 0.001));
    if (phase.fingers) this.driveFingers(phase, fraction);
    if (phase.target && this.controlClock >= 0.02) {
      this.controlClock = 0;
      const target = phase.start.map((value, axis) => value + (phase.target[axis] - value) * fraction);
      this.solveArmToward(target);
    }
    if (phase.key === "settle") {
      this.contactCount = this.countHandContacts();
      this.bestContactCount = Math.max(this.bestContactCount, this.contactCount);
    }
    if (this.phaseTime < phase.duration) return;
    if (phase.target) {
      const miss = Math.hypot(...this.readSite().map((value, axis) => phase.target[axis] - value));
      if (miss > 0.025 && this.phaseTime < phase.duration + 5) return;
      if (miss > 0.065) {
        this.fail(`The G1 arm could not reach the ${phase.label.toLowerCase()} pose within the workspace. The cup remains under MuJoCo physics.`);
        return;
      }
    }

    if (phase.key === "settle" && this.bestContactCount < 2) {
      this.fail("The G1 fingers did not establish a stable two-finger contact with the cup. The cup stayed under physics control.");
      return;
    }
    if (phase.key === "lift" && this.readCup()[2] < this.cupStart[2] + 0.035) {
      this.fail("The hand contacted the cup, but friction did not hold it through the lift. No carry was simulated.");
      return;
    }
    if (phase.key === "carry" && this.readCup()[2] < this.cupStart[2] + 0.035) {
      this.fail("The cup slipped during the carry. It remained a free MuJoCo body and was not attached to the hand.");
      return;
    }
    if (phase.key === "place-settle" && !this.isCupAtPlace()) {
      this.fail("The cup was released, but it did not settle at the requested counter position.");
      return;
    }
    this.enterPhase(this.stepIndex + 1);
  }

  driveFingers(phase, fraction) {
    for (let index = 0; index < this.fingers.length; index += 1) {
      const joint = this.fingers[index];
      const start = phase.fingerStart[index] ?? Number(this.data.ctrl[joint.actuator]);
      const target = clamp(phase.fingers[index], joint.low, joint.high);
      this.data.ctrl[joint.actuator] = start + (target - start) * fraction;
    }
  }

  solveArmToward(target) {
    this.mujoco.mj_forward(this.model, this.data);
    this.jacpBuffer.GetView().fill(0);
    this.jacrBuffer.GetView().fill(0);
    this.mujoco.mj_jacSite(this.model, this.data, this.jacpBuffer, this.jacrBuffer, this.siteId);
    const jacp = this.jacpBuffer.GetView();
    const jacr = this.jacrBuffer.GetView();
    const current = this.readSite();
    const positionError = target.map((value, axis) => value - current[axis]);
    const positionMagnitude = Math.hypot(...positionError);
    if (positionMagnitude > 0.05) {
      for (let axis = 0; axis < 3; axis += 1) positionError[axis] *= 0.05 / positionMagnitude;
    }

    const currentRotation = this.readSiteOrientation();
    const rotationError = Array(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        for (let inner = 0; inner < 3; inner += 1) {
          rotationError[row * 3 + column] += this.homeOrientation[row * 3 + inner] * currentRotation[column * 3 + inner];
        }
      }
    }
    const cosine = clamp((rotationError[0] + rotationError[4] + rotationError[8] - 1) * 0.5, -1, 1);
    const angle = Math.acos(cosine);
    const rotationVector = angle < 1e-5
      ? [
          0.5 * (rotationError[7] - rotationError[5]),
          0.5 * (rotationError[2] - rotationError[6]),
          0.5 * (rotationError[3] - rotationError[1])
        ]
      : (() => {
          const factor = angle / (2 * Math.max(1e-5, Math.sin(angle)));
          return [
            factor * (rotationError[7] - rotationError[5]),
            factor * (rotationError[2] - rotationError[6]),
            factor * (rotationError[3] - rotationError[1])
          ];
        })();
    const weight = 0.22;
    const error = [...positionError, ...rotationVector.map(value => clamp(value, -0.22, 0.22) * weight)];
    const jacobian = Array(6 * this.arm.length).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let jointIndex = 0; jointIndex < this.arm.length; jointIndex += 1) {
        const joint = this.arm[jointIndex];
        jacobian[row * this.arm.length + jointIndex] = jacp[row * this.model.nv + joint.dof];
        jacobian[(row + 3) * this.arm.length + jointIndex] = jacr[row * this.model.nv + joint.dof] * weight;
      }
    }

    const gram = Array(36).fill(0);
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        let sum = 0;
        for (let joint = 0; joint < this.arm.length; joint += 1) sum += jacobian[row * this.arm.length + joint] * jacobian[column * this.arm.length + joint];
        gram[row * 6 + column] = sum + (row === column ? 0.0144 : 0);
      }
    }
    const dual = solveLinear(gram, error, 6);
    for (let jointIndex = 0; jointIndex < this.arm.length; jointIndex += 1) {
      const joint = this.arm[jointIndex];
      let delta = 0;
      for (let axis = 0; axis < 6; axis += 1) delta += jacobian[axis * this.arm.length + jointIndex] * dual[axis];
      const currentAngle = Number(this.data.qpos[joint.qpos]);
      const requested = clamp(currentAngle + clamp(delta * 0.75, -0.07, 0.07), joint.low, joint.high);
      this.data.ctrl[joint.actuator] = requested;
    }
  }

  countHandContacts() {
    const bodies = new Set();
    for (let index = 0; index < this.data.ncon; index += 1) {
      const contact = this.data.contact.get(index);
      if (!contact) continue;
      const first = Number(contact.geom1);
      const second = Number(contact.geom2);
      const firstIsCup = this.cupGeoms.has(first);
      const secondIsCup = this.cupGeoms.has(second);
      if (!firstIsCup && !secondIsCup) {
        contact.delete();
        continue;
      }
      const other = firstIsCup ? second : first;
      const bodyId = Number(this.model.geom_bodyid[other]);
      if (this.leftHandBodies.has(bodyId)) bodies.add(bodyId);
      contact.delete();
    }
    return bodies.size;
  }

  isCupAtPlace() {
    const cup = this.readCup();
    const dx = cup[0] - this.cupPlace[0];
    const dy = cup[1] - this.cupPlace[1];
    return Math.hypot(dx, dy) < 0.03 && Math.abs(cup[2] - this.cupPlace[2]) < 0.04;
  }

  fail(detail) {
    this.isRunning = false;
    this.isFailed = true;
    this.onUpdate({ type: "failed", progress: Math.round((this.stepIndex + 1) / this.phases.length * 100), detail, cup: this.readCup(), contacts: this.bestContactCount });
  }

  dispose() {
    this.jacpBuffer.delete();
    this.jacrBuffer.delete();
  }
}
