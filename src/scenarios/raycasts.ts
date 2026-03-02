import * as THREE from 'three';
import { euler, quat, vec3 } from 'mathcat';
import type { Quat, Vec3 } from 'mathcat';
import { createScenario } from './types';
import { MotionType, ShapeType, createRaycastResult } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

const POINT_DIST = 5;
const RAYCASTER_SPEED = 0.2;
const MESH_SPEED = 0.2;
const MAX_RAYCASTERS = 2000;

type RaycasterData = {
    quaternion: Quat;
    rotationSpeed: Vec3;
    origin: Vec3;
    direction: Vec3;
    hitDistance: number;
    didHit: boolean;
};

type ScenarioState = {
    containerObj: THREE.Object3D;
    torusKnotGeometry: THREE.TorusKnotGeometry;
    torusKnotMaterial: THREE.Material;
    meshBodyId: number;
    meshShapeId: number;
    meshQuaternion: Quat;
    meshRotationSpeed: Vec3;
    raycasters: RaycasterData[];
    rayResult: api.RaycastResult;
    originDots: THREE.InstancedMesh;
    hitDots: THREE.InstancedMesh;
    lines: THREE.InstancedMesh;
};

const _sphereGeometry = new THREE.SphereGeometry(0.05, 8, 8);
const _cylinderGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 4);
const _dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const _lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

const _deltaQuat = quat.create();
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();
const _worldPosVec3: Vec3 = [0, 0, 0];
const _worldQuatVec4: Quat = [0, 0, 0, 1];
const _rootQuat = new THREE.Quaternion();

function makeRaycasterData(): RaycasterData {
    const quaternion = quat.create();
    quat.fromEuler(quaternion, euler.fromValues(Math.random() * 10, Math.random() * 10, Math.random() * 10, 'xyz'));
    return {
        quaternion,
        rotationSpeed: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5],
        origin: vec3.create(),
        direction: vec3.create(),
        hitDistance: POINT_DIST,
        didHit: false,
    };
}

function updateRaycasterData(
    rc: RaycasterData,
    physics: PhysicsState,
    rayResult: ReturnType<typeof createRaycastResult>,
    dt: number,
): void {
    // advance quaternion
    quat.fromEuler(
        _deltaQuat,
        euler.fromValues(
            rc.rotationSpeed[0] * RAYCASTER_SPEED * dt,
            rc.rotationSpeed[1] * RAYCASTER_SPEED * dt,
            rc.rotationSpeed[2] * RAYCASTER_SPEED * dt,
            'xyz',
        ),
    );
    quat.multiply(rc.quaternion, rc.quaternion, _deltaQuat);

    // world-space origin: rotate [POINT_DIST, 0, 0] by quaternion
    _rootQuat.set(rc.quaternion[0], rc.quaternion[1], rc.quaternion[2], rc.quaternion[3]);
    _pos.set(POINT_DIST, 0, 0).applyQuaternion(_rootQuat);
    vec3.set(rc.origin, _pos.x, _pos.y, _pos.z);

    // direction toward center
    vec3.negate(rc.direction, rc.origin);
    vec3.normalize(rc.direction, rc.direction);

    // raycast
    api.raycastClosest(rayResult, physics, rc.origin, rc.direction, POINT_DIST);
    rc.didHit = rayResult.hit;
    rc.hitDistance = rayResult.hit ? rayResult.fraction * POINT_DIST : POINT_DIST;
}

function updateInstancedMeshes(state: ScenarioState): void {
    const n = state.raycasters.length;

    // Resize instance counts to active raycaster count
    state.originDots.count = n;
    state.hitDots.count = n;
    state.lines.count = n;

    for (let i = 0; i < n; i++) {
        const rc = state.raycasters[i]!;

        _rootQuat.set(rc.quaternion[0], rc.quaternion[1], rc.quaternion[2], rc.quaternion[3]);

        // origin dot — at [POINT_DIST, 0, 0] rotated by raycaster quaternion
        _pos.set(POINT_DIST, 0, 0).applyQuaternion(_rootQuat);
        _matrix.compose(_pos, _quat.identity(), _scale.setScalar(1));
        state.originDots.setMatrixAt(i, _matrix);

        // direction vector (from origin toward center)
        const dx = -rc.origin[0],
            dy = -rc.origin[1],
            dz = -rc.origin[2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

        // line — positioned at midpoint between origin and hit, aligned along ray
        const lineLength = rc.hitDistance;
        // midpoint: origin + direction * lineLength/2
        _pos.set(
            rc.origin[0] + (dx / len) * lineLength * 0.5,
            rc.origin[1] + (dy / len) * lineLength * 0.5,
            rc.origin[2] + (dz / len) * lineLength * 0.5,
        );
        // align cylinder (default along Y) to ray direction: rotate Y-axis onto direction
        _quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
        _scale.set(1, lineLength, 1);
        _matrix.compose(_pos, _quat, _scale);
        state.lines.setMatrixAt(i, _matrix);

        // hit dot — at hit point, or hidden if no hit
        if (rc.didHit) {
            _pos.set(
                rc.origin[0] + (dx / len) * rc.hitDistance,
                rc.origin[1] + (dy / len) * rc.hitDistance,
                rc.origin[2] + (dz / len) * rc.hitDistance,
            );
            _matrix.compose(_pos, _quat.identity(), _scale.setScalar(1));
            state.hitDots.setMatrixAt(i, _matrix);
        } else {
            // scale to zero to hide
            _matrix.makeScale(0, 0, 0);
            state.hitDots.setMatrixAt(i, _matrix);
        }
    }

    state.originDots.instanceMatrix.needsUpdate = true;
    state.hitDots.instanceMatrix.needsUpdate = true;
    state.lines.instanceMatrix.needsUpdate = true;
}

export const createRaycastsScenario = () =>
    createScenario<ScenarioState, { n: number }>({
        controls: (gui) => {
            const params = { n: 150 };
            gui.title('Raycasts');
            gui.add(params, 'n', 0, 2000, 1).name('raycasters');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, 0, 0);

            // camera
            renderer.camera.position.set(0, 3, 8);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            // build torus knot shape
            const torusKnotGeometry = new THREE.TorusKnotGeometry(1, 0.4, 64, 8);
            const positions = torusKnotGeometry.attributes.position!.array as Float32Array;
            const rawIdx = torusKnotGeometry.index!.array;
            const indices = rawIdx instanceof Uint32Array ? rawIdx : new Uint32Array(rawIdx);

            const meshShapeId = api.createShape(physics, {
                type: ShapeType.TRIANGLE_MESH,
                positions,
                indices,
            });

            const meshBodyId = api.createRigidBody(physics, {
                shape: meshShapeId,
                motionType: MotionType.STATIC,
                position: [0, 0, 0],
            });

            const meshQuaternion = quat.create();
            quat.fromEuler(meshQuaternion, euler.fromValues(Math.random() * 10, Math.random() * 10, 0, 'xyz'));

            const meshRotationSpeed: Vec3 = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];

            const torusKnotMaterial = new THREE.MeshPhongMaterial({ color: 0xe91e63 });
            const containerObj = new THREE.Object3D();
            const visualMesh = new THREE.Mesh(torusKnotGeometry, torusKnotMaterial);
            containerObj.add(visualMesh);
            renderer.scene.add(containerObj);

            const originDots = new THREE.InstancedMesh(_sphereGeometry, _dotMaterial, MAX_RAYCASTERS);
            const hitDots = new THREE.InstancedMesh(_sphereGeometry, _dotMaterial, MAX_RAYCASTERS);
            const lines = new THREE.InstancedMesh(_cylinderGeometry, _lineMaterial, MAX_RAYCASTERS);
            originDots.count = 0;
            hitDots.count = 0;
            lines.count = 0;
            renderer.scene.add(originDots, hitDots, lines);

            return {
                containerObj,
                torusKnotGeometry,
                torusKnotMaterial,
                meshBodyId,
                meshShapeId,
                meshQuaternion,
                meshRotationSpeed,
                raycasters: [],
                rayResult: createRaycastResult(),
                originDots,
                hitDots,
                lines,
            };
        },

        preUpdate: (
            state: ScenarioState,
            physics: PhysicsState,
            _renderer: Renderer,
            controls: { n: number },
            dt: number,
        ): void => {
            // add or remove raycaster data to match controls.n
            while (state.raycasters.length < controls.n) {
                state.raycasters.push(makeRaycasterData());
            }
            while (state.raycasters.length > controls.n) {
                state.raycasters.pop();
            }

            // advance mesh quaternion
            quat.fromEuler(
                _deltaQuat,
                euler.fromValues(
                    state.meshRotationSpeed[0] * MESH_SPEED * dt,
                    state.meshRotationSpeed[1] * MESH_SPEED * dt,
                    state.meshRotationSpeed[2] * MESH_SPEED * dt,
                    'xyz',
                ),
            );
            quat.multiply(state.meshQuaternion, state.meshQuaternion, _deltaQuat);

            // sync visual
            state.containerObj.quaternion.set(
                state.meshQuaternion[0],
                state.meshQuaternion[1],
                state.meshQuaternion[2],
                state.meshQuaternion[3],
            );
            state.containerObj.updateMatrixWorld();
            state.containerObj.matrixWorld.decompose(_worldPos, _worldQuat, _worldScale);

            // sync physics body
            vec3.set(_worldPosVec3, _worldPos.x, _worldPos.y, _worldPos.z);
            _worldQuatVec4[0] = _worldQuat.x;
            _worldQuatVec4[1] = _worldQuat.y;
            _worldQuatVec4[2] = _worldQuat.z;
            _worldQuatVec4[3] = _worldQuat.w;
            api.setBodyTranslationRotation(physics, state.meshBodyId, _worldPosVec3, _worldQuatVec4);
        },

        postUpdate: (
            state: ScenarioState,
            physics: PhysicsState,
            _renderer: Renderer,
            _controls: { n: number },
            dt: number,
        ): void => {
            // update raycaster directions and cast against post-step physics state
            for (const rc of state.raycasters) {
                updateRaycasterData(rc, physics, state.rayResult, dt);
            }

            // flush results to instanced meshes
            updateInstancedMeshes(state);
        },

        dispose: (state: ScenarioState, _physics: PhysicsState, renderer: Renderer): void => {
            renderer.scene.remove(state.containerObj);
            state.torusKnotGeometry.dispose();
            state.torusKnotMaterial.dispose();

            renderer.scene.remove(state.originDots, state.hitDots, state.lines);
        },
    });
