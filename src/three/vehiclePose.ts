import { ArrowHelper, Bone, Group, MathUtils, Object3D, Quaternion, Vector3 } from 'three';

export interface VehiclePose { steering: number; spin: number; reactor: 'off' | 'up' | 'down' }
export const REST_VEHICLE_POSE: VehiclePose = { steering: 0, spin: 0, reactor: 'off' };
export const poseIsActive = (pose: VehiclePose) => pose.steering !== 0 || pose.spin !== 0 || pose.reactor !== 'off';
const KEYS = ['FL', 'FR', 'RL', 'RR'] as const;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const bounded = (value: number, max: number) => MathUtils.degToRad(Number.isFinite(value) ? MathUtils.clamp(value, -max, max) : 0);

/** Inspect actual GLB skinning without saving simulated poses in the skin. */
export class VehicleRigPreview {
  readonly guides = new Group();
  readonly ready: boolean;
  private bones = new Map<string, { bone: Bone; rest: Quaternion }>();
  private arrows = new Map<string, ArrowHelper>();
  private model: Object3D;
  constructor(model: Object3D) {
    this.model = model;
    model.traverse((object) => {
      if (object instanceof Bone) this.bones.set(object.name, { bone: object, rest: object.quaternion.clone() });
    });
    this.ready = KEYS.every((key) => ['Hub', 'Guard', 'Wheel', 'Reactor'].every((suffix) => this.bones.has(key + suffix)) &&
      this.bones.get(key + 'Guard')!.bone.parent === this.bones.get(key + 'Hub')!.bone &&
      this.bones.get(key + 'Reactor')!.bone.parent === this.bones.get(key + 'Guard')!.bone &&
      this.bones.get(key + 'Wheel')!.bone.parent?.name === key + (key.startsWith('F') ? 'Reactor' : 'Cardan') &&
      (key.startsWith('F') || this.bones.get(key + 'Cardan')?.bone.parent === this.bones.get(key + 'Reactor')!.bone));
    this.guides.visible = false;
    if (this.ready) for (const key of KEYS) {
      const arrow = new ArrowHelper(X, new Vector3(), .6, 0x76e5c9, .14, .065);
      this.arrows.set(key, arrow); this.guides.add(arrow);
    }
  }
  apply(pose: VehiclePose) {
    if (!this.ready) return;
    for (const { bone, rest } of this.bones.values()) bone.quaternion.copy(rest);
    const steering = bounded(pose.steering, 35), spin = bounded(pose.spin, 180);
    const tilt = pose.reactor === 'up' ? MathUtils.degToRad(35) : pose.reactor === 'down' ? -MathUtils.degToRad(35) : 0;
    const rotate = (name: string, axis: Vector3, angle: number) => this.bones.get(name)!.bone.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, angle));
    for (const key of KEYS) {
      const side = key.endsWith('L') ? 1 : -1;
      if (key.startsWith('F')) rotate(key + 'Guard', Y, steering);
      rotate(key + 'Wheel', X, spin);
      // The tyre, complete rim and jet share this articulation. The upper
      // tyre edge leans out for UP, while its outward normal (the jet) points down.
      rotate(key + 'Reactor', Z, -side * tilt);
    }
    this.model.updateWorldMatrix(true, true);
    this.guides.visible = tilt !== 0;
    for (const key of KEYS) {
      const bone = this.bones.get(key + 'Reactor')!.bone;
      const arrow = this.arrows.get(key)!;
      bone.getWorldPosition(arrow.position);
      const direction = new Vector3(key.endsWith('L') ? 1 : -1, 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
      arrow.position.addScaledVector(direction, .22);
      arrow.setDirection(direction);
    }
  }
  dispose() {
    this.apply(REST_VEHICLE_POSE);
    this.guides.removeFromParent();
    for (const arrow of this.arrows.values()) arrow.dispose();
  }
}
