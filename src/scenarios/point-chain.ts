import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Point Chain — a vertical chain of spheres suspended from a static anchor by
// ball-socket (point) joints. The bottom link is given a lateral impulse to
// start it swinging as a pendulum chain. Exercises joint chain propagation,
// stability under oscillation, and energy dissipation.
// ---------------------------------------------------------------------------

const LINK_RADIUS = 0.3;
const LINK_SPACING = LINK_RADIUS * 2 + 0.02; // slight gap so spheres don't overlap
const ANCHOR_Y = 12;
const DEFAULT_LINKS = 16;
const DEFAULT_RESTART = 14;

type ChainData = {
    n: number;
    anchorId: number;
    linkIds: number[];
    jointIds: number[];
    anchorShapeId: number;
    linkShapeId: number;
};

type ScenarioState = {
    chain: ChainData;
    elapsed: number;
    swingPending: boolean;
};

type Controls = { links: number; restart: number };

function buildChain(physics: PhysicsState, n: number): ChainData {
    const anchorShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.2, 0.2, 0.2] });
    const linkShapeId = api.createShape(physics, { type: ShapeType.SPHERE, radius: LINK_RADIUS });

    const anchorId = api.createRigidBody(physics, {
        shape: anchorShapeId,
        motionType: MotionType.STATIC,
        position: [0, ANCHOR_Y, 0],
    });

    const linkIds: number[] = [];
    for (let i = 0; i < n; i++) {
        const y = ANCHOR_Y - LINK_RADIUS - (i + 1) * LINK_SPACING;
        linkIds.push(api.createRigidBody(physics, {
            shape: linkShapeId,
            motionType: MotionType.DYNAMIC,
            position: [0, y, 0],
            mass: 1,
            restitution: 0.2,
            friction: 0.1,
        }));
    }

    const jointIds: number[] = [];

    // Anchor → first link: anchor point at top of first link
    jointIds.push(api.createPointConstraint(physics, anchorId, linkIds[0]!, [0, ANCHOR_Y - LINK_RADIUS, 0]));

    // Link-to-link joints
    for (let i = 0; i < n - 1; i++) {
        const ay = ANCHOR_Y - LINK_RADIUS - (i + 1) * LINK_SPACING - LINK_RADIUS;
        jointIds.push(api.createPointConstraint(physics, linkIds[i]!, linkIds[i + 1]!, [0, ay, 0]));
    }

    return { n, anchorId, linkIds, jointIds, anchorShapeId, linkShapeId };
}

function teardownChain(physics: PhysicsState, c: ChainData): void {
    for (const jId of c.jointIds) api.removeConstraint(physics, jId);
    for (const lId of c.linkIds) api.removeRigidBody(physics, lId);
    api.removeRigidBody(physics, c.anchorId);
    api.destroyShape(physics, c.linkShapeId);
    api.destroyShape(physics, c.anchorShapeId);
}

function applySwingImpulse(physics: PhysicsState, c: ChainData): void {
    const lastId = c.linkIds[c.linkIds.length - 1];
    if (lastId !== undefined) {
        api.applyImpulse(physics, lastId, [6, 0, 0]);
    }
}

export const createPointChainScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { links: DEFAULT_LINKS, restart: DEFAULT_RESTART };
            gui.title('Point Chain');
            gui.add(params, 'links', 4, 32, 1).name('links');
            gui.add(params, 'restart', 0, 30, 1).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, ANCHOR_Y * 0.5, 20);
            renderer.camera.lookAt(0, ANCHOR_Y * 0.5, 0);
            renderer.controls.target.set(0, ANCHOR_Y * 0.5, 0);
            renderer.controls.update();

            const groundShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [15, 0.5, 15] });
            api.createRigidBody(physics, { shape: groundShape, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const chain = buildChain(physics, DEFAULT_LINKS);
            return { chain, elapsed: 0, swingPending: true };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.links !== state.chain.n) {
                teardownChain(physics, state.chain);
                state.chain = buildChain(physics, controls.links);
                state.elapsed = 0;
                state.swingPending = true;
            }

            if (state.swingPending) {
                state.swingPending = false;
                applySwingImpulse(physics, state.chain);
            }

            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            teardownChain(physics, state.chain);
            state.chain = buildChain(physics, controls.links);
            state.swingPending = true;
        },
    });
