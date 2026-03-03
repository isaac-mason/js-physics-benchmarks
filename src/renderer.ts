import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ShapeType, MotionType, type PhysicsShape, type PhysicsState } from './api';

const UNIT_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX_GEOMETRY.deleteAttribute('uv');
const UNIT_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 16);
UNIT_SPHERE_GEOMETRY.deleteAttribute('uv');

const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
});

const INITIAL_MAX_INSTANCES = 2000;
const MAX_VERTICES = 100_000;
const MAX_INDICES = 100_000;

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _prevPosition = new THREE.Vector3();
const _prevQuaternion = new THREE.Quaternion();
const _interpPosition = new THREE.Vector3();
const _interpQuaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();

type BodyEntry = {
    geometryId: number;
    instanceId: number;
};

export type Renderer = {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    update(state: PhysicsState, alpha: number): void;
    clear(): void;
    resetCamera(): void;
    dispose(): void;
};

export function createRenderer(container?: HTMLElement): Renderer {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;

    const target = container ?? document.body;
    target.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 5, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    let maxInstances = INITIAL_MAX_INSTANCES;
    let batchedMesh = new THREE.BatchedMesh(maxInstances, MAX_VERTICES, MAX_INDICES, material);
    batchedMesh.castShadow = true;
    batchedMesh.receiveShadow = true;
    scene.add(batchedMesh);

    let boxGeometryId = batchedMesh.addGeometry(UNIT_BOX_GEOMETRY);
    let sphereGeometryId = batchedMesh.addGeometry(UNIT_SPHERE_GEOMETRY);

    // Convex hull geometries keyed by the points array reference (object identity = unique shape)
    const convexGeometryMap = new Map<number[], { geometry: THREE.BufferGeometry; batchId: number }>();

    function getOrCreateConvexGeometryId(points: number[]): number {
        const existing = convexGeometryMap.get(points);
        if (existing) return existing.batchId;
        const vecs: THREE.Vector3[] = [];
        for (let i = 0; i < points.length; i += 3) {
            vecs.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
        }
        // ConvexGeometry is non-indexed; mergeVertices deduplicates and adds an index
        // so it is consistent with the indexed BoxGeometry/SphereGeometry in the BatchedMesh
        const geometry = mergeVertices(new ConvexGeometry(vecs));
        const batchId = batchedMesh.addGeometry(geometry);
        convexGeometryMap.set(points, { geometry, batchId });
        return batchId;
    }

    function resizeBatchedMesh(neededInstances: number): void {
        // Grow to next power of two above neededInstances
        while (maxInstances < neededInstances) maxInstances *= 2;

        scene.remove(batchedMesh);
        batchedMesh.dispose();

        batchedMesh = new THREE.BatchedMesh(maxInstances, MAX_VERTICES, MAX_INDICES, material);
        batchedMesh.castShadow = true;
        batchedMesh.receiveShadow = true;
        scene.add(batchedMesh);

        boxGeometryId = batchedMesh.addGeometry(UNIT_BOX_GEOMETRY);
        sphereGeometryId = batchedMesh.addGeometry(UNIT_SPHERE_GEOMETRY);

        // Re-register convex hull geometries and update their batch IDs
        for (const [points, entry] of convexGeometryMap) {
            entry.batchId = batchedMesh.addGeometry(entry.geometry);
            // Update any existing body entries that reference the old batch ID
            for (const bodyEntry of bodyEntries.values()) {
                if (bodyEntry.geometryId === entry.batchId) {
                    bodyEntry.geometryId = entry.batchId;
                }
            }
            // Silence unused-variable warning — points is the map key
            void points;
        }

        // Re-add instances for all existing entries
        for (const [bodyId, entry] of bodyEntries) {
            entry.instanceId = batchedMesh.addInstance(entry.geometryId);
            instanceColors.delete(bodyId); // force color re-set on next update
        }
    }

    const bodyEntries = new Map<number, BodyEntry>();
    const activeInstanceIds = new Set<number>();
    const instanceColors = new Map<number, THREE.Color>();

    function getInstanceColor(bodyId: number, motionType: MotionType): THREE.Color {
        let color = instanceColors.get(bodyId);
        if (!color) {
            color = new THREE.Color();
            const hash = bodyId * 137.5;
            if (motionType === MotionType.STATIC) {
                const lightness = 0.22 + ((hash % 100) / 100) * 0.2;
                color.setHSL(0, 0, lightness);
            } else {
                const hue = (hash % 360) / 360;
                color.setHSL(hue, 0.7, 0.6);
            }
            instanceColors.set(bodyId, color);
        }
        return color;
    }

    function getShapeGeometryId(shape: PhysicsShape): number | null {
        switch (shape.type) {
            case ShapeType.BOX:
                return boxGeometryId;
            case ShapeType.SPHERE:
                return sphereGeometryId;
            case ShapeType.CONVEX_HULL:
                return getOrCreateConvexGeometryId(shape.points);
            default:
                return null;
        }
    }

    function getShapeScale(shape: PhysicsShape): [number, number, number] {
        switch (shape.type) {
            case ShapeType.BOX:
                return [shape.halfExtents[0] * 2, shape.halfExtents[1] * 2, shape.halfExtents[2] * 2];
            case ShapeType.SPHERE:
                return [shape.radius * 2, shape.radius * 2, shape.radius * 2];
            case ShapeType.CONVEX_HULL:
                return [1, 1, 1]; // geometry is already in world-scale units
            default:
                return [1, 1, 1];
        }
    }

    function ensureEntry(bodyId: number, geometryId: number): BodyEntry {
        let entry = bodyEntries.get(bodyId);
        if (!entry) {
            if (bodyEntries.size >= maxInstances) {
                resizeBatchedMesh(bodyEntries.size + 1);
            }
            entry = { geometryId, instanceId: batchedMesh.addInstance(geometryId) };
            bodyEntries.set(bodyId, entry);
        } else if (entry.geometryId !== geometryId) {
            batchedMesh.deleteInstance(entry.instanceId);
            entry = { geometryId, instanceId: batchedMesh.addInstance(geometryId) };
            bodyEntries.set(bodyId, entry);
        }
        return entry;
    }

    function update(state: PhysicsState, alpha: number): void {
        activeInstanceIds.clear();

        for (const [bodyId, body] of state.bodies) {
            const geometryId = getShapeGeometryId(body.shapeDesc);
            if (geometryId === null) continue;

            const entry = ensureEntry(bodyId, geometryId);
            activeInstanceIds.add(entry.instanceId);

            const scale = getShapeScale(body.shapeDesc);

            _prevPosition.set(body.prevPosition[0], body.prevPosition[1], body.prevPosition[2]);
            _prevQuaternion.set(body.prevQuaternion[0], body.prevQuaternion[1], body.prevQuaternion[2], body.prevQuaternion[3]);
            _position.set(body.position[0], body.position[1], body.position[2]);
            _quaternion.set(body.quaternion[0], body.quaternion[1], body.quaternion[2], body.quaternion[3]);

            _interpPosition.lerpVectors(_prevPosition, _position, alpha);
            _interpQuaternion.slerpQuaternions(_prevQuaternion, _quaternion, alpha);

            _scale.set(scale[0], scale[1], scale[2]);
            _matrix.compose(_interpPosition, _interpQuaternion, _scale);

            batchedMesh.setMatrixAt(entry.instanceId, _matrix);

            const color = getInstanceColor(bodyId, body.motionType);
            batchedMesh.setColorAt(entry.instanceId, color);
        }

        for (const [bodyId, entry] of bodyEntries) {
            if (!activeInstanceIds.has(entry.instanceId)) {
                batchedMesh.deleteInstance(entry.instanceId);
                bodyEntries.delete(bodyId);
            }
        }

        const im = (batchedMesh as any).instanceMatrix;
        if (im) im.needsUpdate = true;
        const ic = (batchedMesh as any).instanceColor;
        if (ic) ic.needsUpdate = true;
    }

    function clear(): void {
        for (const [_, entry] of bodyEntries) {
            batchedMesh.deleteInstance(entry.instanceId);
        }
        bodyEntries.clear();
        activeInstanceIds.clear();
        instanceColors.clear();
        const im = (batchedMesh as any).instanceMatrix;
        if (im) im.needsUpdate = true;
    }

    function resetCamera(): void {
        camera.position.set(0, 10, 10);
        camera.lookAt(0, 5, 0);
        controls.target.set(0, 5, 0);
        controls.update();
    }

    const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', onResize);

    function dispose(): void {
        window.removeEventListener('resize', onResize);
        renderer.domElement.remove();
        renderer.dispose();
        for (const entry of convexGeometryMap.values()) {
            entry.geometry.dispose();
        }
        convexGeometryMap.clear();
    }

    return {
        scene,
        camera,
        renderer,
        controls,
        update,
        clear,
        resetCamera,
        dispose,
    };
}
