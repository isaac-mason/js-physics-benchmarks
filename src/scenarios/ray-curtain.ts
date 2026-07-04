import * as THREE from 'three';
import { euler, quat } from 'mathcat';
import type { Quat, Vec3 } from 'mathcat';
import { createScenario } from './types';
import { MotionType, ShapeType, createRaycastResult } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Ray Curtain — a sweeping "curtain" of parallel downward rays cast across a
// row of spinning kinematic shapes. Ported from box3d's "Ray Curtain" collision
// sample. The rays stop at the first surface they hit, so the curtain traces
// the silhouette of the shapes as it sweeps back and forth.
//
// box3d draws hit normals too; our raycast API only returns a hit fraction, so
// we draw the hit points (green) and the shortened rays (yellow) instead.
// ---------------------------------------------------------------------------

const RAY_X_MIN = -8;
const RAY_X_MAX = 8;
const RAY_TOP_Y = 8;
const RAY_MAX_DIST = 8; // cast straight down to y = 0
const RAY_DIR: Vec3 = [0, -1, 0];

const SWEEP_MIN = -2;
const SWEEP_MAX = 2;
const SWEEP_SPEED = 0.9; // world units / second in z

const SPIN: Vec3 = [0.8, 0.4, 0.8]; // angular velocity of the targets (box3d value)
const TARGET_Y = 3;

const DEFAULT_RAYS = 161; // 0.1 spacing across [-8, 8]
const MAX_RAYS = 512;

// --- shared THREE resources ------------------------------------------------

const _dotGeometry = new THREE.SphereGeometry(0.06, 8, 8);
const _lineGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
const _originMaterial = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.6 });
// Hit markers draw on top of the target meshes — otherwise a hit point sitting
// exactly on a curved surface (e.g. the sphere) gets swallowed by the geometry
// and the target looks like it isn't being hit.
const _hitMaterial = new THREE.MeshBasicMaterial({ color: 0x33ff33, depthTest: false, depthWrite: false });
const _lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffee55, transparent: true, opacity: 0.35 });

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _identQuat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

const _deltaQuat = quat.create();

type Target = {
    bodyId: number;
    // Only set for shapes the renderer doesn't auto-draw (triangle meshes).
    // Box/sphere/convex targets are drawn by the renderer straight from the
    // collider, so their mesh can never drift from what the rays hit.
    visual?: THREE.Mesh;
    quaternion: Quat;
    position: Vec3;
};

type ScenarioState = {
    targets: Target[];
    disposables: (THREE.BufferGeometry | THREE.Material)[];
    originDots: THREE.InstancedMesh;
    hitDots: THREE.InstancedMesh;
    lines: THREE.InstancedMesh;
    rayResult: api.RaycastResult;
    offset: number;
    sweepDir: number;
};

/** Octagonal prism aligned along X — a stand-in for box3d's capsule target. */
function makePrismX(halfLength: number, radius: number, sides: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const y = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        pts.push(-halfLength, y, z);
        pts.push(halfLength, y, z);
    }
    return pts;
}

function spinTarget(target: Target, physics: PhysicsState, dt: number): void {
    quat.fromEuler(_deltaQuat, euler.fromValues(SPIN[0] * dt, SPIN[1] * dt, SPIN[2] * dt, 'xyz'));
    quat.multiply(target.quaternion, target.quaternion, _deltaQuat);

    const q = target.quaternion;
    target.visual?.quaternion.set(q[0], q[1], q[2], q[3]);
    api.setBodyTranslationRotation(physics, target.bodyId, target.position, [q[0], q[1], q[2], q[3]]);
}

export const createRayCurtainScenario = () =>
    createScenario<ScenarioState, { rays: number }>({
        controls: (gui) => {
            const params = { rays: DEFAULT_RAYS };
            gui.title('Ray Curtain');
            gui.add(params, 'rays', 1, MAX_RAYS, 1).name('rays');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, 0, 0);

            renderer.camera.position.set(0, 6, 18);
            renderer.camera.lookAt(0, 2, 0);
            renderer.controls.target.set(0, 2, 0);
            renderer.controls.update();

            const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
            const targets: Target[] = [];

            // Static + per-frame teleport (as raycasts.ts does): triangle meshes
            // are only collidable on static bodies in most engines, and we only
            // need these as raycast targets, not simulated. A `visual` is only
            // created for shapes the renderer doesn't auto-draw (triangle mesh);
            // for the rest the renderer draws the collider itself, so the mesh
            // can never diverge from what the rays hit.
            const addTarget = (x: number, shapeId: number, visual?: THREE.Mesh): void => {
                const position: Vec3 = [x, TARGET_Y, 0];
                const bodyId = api.createRigidBody(physics, {
                    shape: shapeId,
                    motionType: MotionType.STATIC,
                    position,
                });
                if (visual) {
                    visual.position.set(x, TARGET_Y, 0);
                    renderer.scene.add(visual);
                }
                const quaternion = quat.create();
                quat.fromEuler(quaternion, euler.fromValues(0.3, 0.7, 0.1, 'xyz'));
                targets.push({ bodyId, visual, quaternion, position });
            };

            // Sphere / box / convex-hull prism — renderer draws these from the collider
            addTarget(-6, api.createShape(physics, { type: ShapeType.SPHERE, radius: 0.9 }));
            addTarget(-2, api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.6, 0.6, 0.6] }));
            addTarget(2, api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makePrismX(0.5, 0.8, 8) }));

            // Triangle-mesh torus — renderer skips triangle meshes, so give it a visual
            const torusGeometry = new THREE.TorusGeometry(0.65, 0.35, 12, 20);
            const positions = torusGeometry.attributes.position!.array as Float32Array;
            const rawIdx = torusGeometry.index!.array;
            const indices = rawIdx instanceof Uint32Array ? rawIdx : new Uint32Array(rawIdx);
            const torusMaterial = new THREE.MeshPhongMaterial({ color: 0xff9800 });
            disposables.push(torusGeometry, torusMaterial);
            addTarget(
                6,
                api.createShape(physics, { type: ShapeType.TRIANGLE_MESH, positions, indices }),
                new THREE.Mesh(torusGeometry, torusMaterial),
            );

            const originDots = new THREE.InstancedMesh(_dotGeometry, _originMaterial, MAX_RAYS);
            const hitDots = new THREE.InstancedMesh(_dotGeometry, _hitMaterial, MAX_RAYS);
            hitDots.renderOrder = 10; // draw hit markers last, on top of the targets
            const lines = new THREE.InstancedMesh(_lineGeometry, _lineMaterial, MAX_RAYS);
            originDots.count = 0;
            hitDots.count = 0;
            lines.count = 0;
            renderer.scene.add(originDots, hitDots, lines);

            return {
                targets,
                disposables,
                originDots,
                hitDots,
                lines,
                rayResult: createRaycastResult(),
                offset: 0,
                sweepDir: 1,
            };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, _controls, dt: number): void => {
            for (const target of state.targets) {
                spinTarget(target, physics, dt);
            }

            // sweep the curtain in z, bouncing between the limits
            state.offset += state.sweepDir * SWEEP_SPEED * dt;
            if (state.offset > SWEEP_MAX) {
                state.offset = SWEEP_MAX;
                state.sweepDir = -1;
            } else if (state.offset < SWEEP_MIN) {
                state.offset = SWEEP_MIN;
                state.sweepDir = 1;
            }
        },

        postUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls, _dt: number): void => {
            const n = controls.rays;
            const z = state.offset;
            state.originDots.count = n;
            state.hitDots.count = n;
            state.lines.count = n;

            for (let i = 0; i < n; i++) {
                const x = n === 1 ? 0 : RAY_X_MIN + ((RAY_X_MAX - RAY_X_MIN) * i) / (n - 1);
                const originY = RAY_TOP_Y;

                api.raycastClosest(state.rayResult, physics, [x, originY, z], RAY_DIR, RAY_MAX_DIST);
                const dist = state.rayResult.hit ? state.rayResult.fraction * RAY_MAX_DIST : RAY_MAX_DIST;

                // origin dot (top of the curtain)
                _pos.set(x, originY, z);
                _matrix.compose(_pos, _identQuat, _scale.setScalar(0.5));
                state.originDots.setMatrixAt(i, _matrix);

                // ray line: vertical, from origin down to the hit (or full length)
                _pos.set(x, originY - dist * 0.5, z);
                _matrix.compose(_pos, _identQuat, _scale.set(1, dist, 1));
                state.lines.setMatrixAt(i, _matrix);

                // hit dot at the surface, hidden on a miss
                if (state.rayResult.hit) {
                    _pos.set(x, originY - dist, z);
                    _matrix.compose(_pos, _identQuat, _scale.setScalar(1));
                    state.hitDots.setMatrixAt(i, _matrix);
                } else {
                    state.hitDots.setMatrixAt(i, _hidden);
                }
            }

            state.originDots.instanceMatrix.needsUpdate = true;
            state.hitDots.instanceMatrix.needsUpdate = true;
            state.lines.instanceMatrix.needsUpdate = true;
        },

        dispose: (state: ScenarioState, _physics: PhysicsState, renderer: Renderer): void => {
            for (const target of state.targets) {
                if (target.visual) renderer.scene.remove(target.visual);
            }
            renderer.scene.remove(state.originDots, state.hitDots, state.lines);
            for (const d of state.disposables) d.dispose();
        },
    });
