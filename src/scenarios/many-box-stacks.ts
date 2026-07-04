import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Many Box Stacks — faithful port of PEEL's "ManySmallBoxStacks10" via its
// CreateBoxStack(nb_stacks, base=10) helper: a row of box pyramids (10 boxes at
// the base narrowing to 1). Many independent resting islands — a broadphase /
// island-management scale test on top of stacking stability.
// ---------------------------------------------------------------------------

const BOX_EXTENT = 1; // half-extent -> 2x2x2 boxes
const BASE_BOXES = 10;
const STACK_Z_SPACING = BOX_EXTENT * 4;

const DEFAULT_STACKS = 30;
const MAX_STACKS = 60;

type ScenarioState = {
    handles: number[];
    boxShapeId: number;
    builtStacks: number;
};

type Controls = { stacks: number };

function build(physics: PhysicsState, boxShapeId: number, stacks: number): number[] {
    const handles: number[] = [];
    const halfGrid = ((stacks - 1) * STACK_Z_SPACING) / 2; // centre the row on the origin
    for (let j = 0; j < stacks; j++) {
        let nbBoxes = BASE_BOXES;
        let posY = BOX_EXTENT;
        while (nbBoxes > 0) {
            for (let i = 0; i < nbBoxes; i++) {
                const coeff = i - nbBoxes * 0.5;
                handles.push(
                    api.createRigidBody(physics, {
                        shape: boxShapeId,
                        motionType: MotionType.DYNAMIC,
                        position: [coeff * BOX_EXTENT * 2, posY, j * STACK_Z_SPACING - halfGrid],
                        mass: 1,
                        friction: 0.5,
                        restitution: 0,
                    }),
                );
            }
            nbBoxes--;
            posY += BOX_EXTENT * 2;
        }
    }
    return handles;
}

export const createManyBoxStacksScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { stacks: DEFAULT_STACKS };
            gui.title('Many Box Stacks');
            gui.add(params, 'stacks', 1, MAX_STACKS, 1).name('stacks');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(24, 26, 90);
            renderer.camera.lookAt(0, 6, 0);
            renderer.controls.target.set(0, 6, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [120, 0.5, 120], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const boxShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_EXTENT, BOX_EXTENT, BOX_EXTENT] });
            const handles = build(physics, boxShapeId, DEFAULT_STACKS);

            return { handles, boxShapeId, builtStacks: DEFAULT_STACKS };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            if (controls.stacks === state.builtStacks) return;
            for (const id of state.handles) api.removeRigidBody(physics, id);
            state.handles = build(physics, state.boxShapeId, controls.stacks);
            state.builtStacks = controls.stacks;
        },
    });
