import { quat, vec3 } from 'mathcat';
import type { Quat, Vec3 } from '../api';

// Module-level scratch — helpers never allocate.
const _conj: Quat = [0, 0, 0, 1];
const _diff: Vec3 = [0, 0, 0];

/** Rotate v by the conjugate (inverse) of q, writing the result into out. */
export function rotateByConjugate(out: Vec3, v: Vec3, q: Quat): Vec3 {
    quat.conjugate(_conj, q);
    return vec3.transformQuat(out, v, _conj);
}

/** Transform a world-space point into body-local space, writing the result into out. */
export function worldToLocal(out: Vec3, worldPt: Vec3, bodyPos: Vec3, bodyQuat: Quat): Vec3 {
    _diff[0] = worldPt[0] - bodyPos[0];
    _diff[1] = worldPt[1] - bodyPos[1];
    _diff[2] = worldPt[2] - bodyPos[2];
    return rotateByConjugate(out, _diff, bodyQuat);
}

/** Quaternion that rotates X=[1,0,0] onto the given unit axis, writing result into out. */
export function quatFromXToAxis(out: Quat, ax: number, ay: number, az: number): Quat {
    if (ax > 0.9999)  { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; }
    if (ax < -0.9999) { out[0] = 0; out[1] = 1; out[2] = 0; out[3] = 0; return out; }
    // cross(X, axis) = (0, -az, ay)
    const cy = -az, cz = ay;
    const len = Math.sqrt(cy * cy + cz * cz);
    const half = Math.acos(Math.max(-1, Math.min(1, ax))) / 2;
    const s = Math.sin(half);
    out[0] = 0; out[1] = (cy / len) * s; out[2] = (cz / len) * s; out[3] = Math.cos(half);
    return out;
}

/** Quaternion that rotates Z=[0,0,1] onto the given unit axis, writing result into out. */
export function quatFromZToAxis(out: Quat, ax: number, ay: number, az: number): Quat {
    if (az > 0.9999)  { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return out; }
    if (az < -0.9999) { out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0; return out; }
    // cross(Z, axis) = (-ay, ax, 0)
    const cx = -ay, cy = ax;
    const len = Math.sqrt(cx * cx + cy * cy);
    const half = Math.acos(Math.max(-1, Math.min(1, az))) / 2;
    const s = Math.sin(half);
    out[0] = (cx / len) * s; out[1] = (cy / len) * s; out[2] = 0; out[3] = Math.cos(half);
    return out;
}
