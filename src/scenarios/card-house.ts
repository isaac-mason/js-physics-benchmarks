import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Card House — port of box3d's "Card House" stacking sample. Thin cards lean
// against each other in an A-frame pyramid with flat cards bridging the tops.
// A delicate stability test: friction and solver quality decide whether the
// house stands or collapses. box3d uses 0.001-thick cards; convex hulls can't
// go that thin, so ours are a bit thicker (noted below).
// ---------------------------------------------------------------------------

const CARD_HEIGHT = 0.2;
const CARD_THICKNESS = 0.02; // box3d uses 0.001 but hull minimum thickness limits us
const CARD_DEPTH = 0.1;
const FRICTION = 0.7;

const ANGLE0 = (25 * Math.PI) / 180;
const ANGLE1 = (-25 * Math.PI) / 180;
const ANGLE2 = 0.5 * Math.PI;

/** Rotation about the world Z axis. */
function quatZ(angle: number): Quat {
    return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

export const createCardHouseScenario = () =>
    createScenario<null, void>({
        init: (physics: PhysicsState, renderer: Renderer): null => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(3.0, 2.0, 3.0);
            renderer.camera.lookAt(0.95, 1.0, 0);
            renderer.controls.target.set(0.95, 1.0, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [10, 0.5, 10], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const cardShape = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: [CARD_THICKNESS, CARD_HEIGHT, CARD_DEPTH],
                convexRadius: 0.005,
            });

            const card = (x: number, y: number, quat: Quat): void => {
                api.createRigidBody(physics, {
                    shape: cardShape,
                    motionType: MotionType.DYNAMIC,
                    position: [x, y, 0],
                    quaternion: quat,
                    mass: 1,
                    friction: FRICTION,
                    restitution: 0,
                });
            };

            const qA0 = quatZ(ANGLE0);
            const qA1 = quatZ(ANGLE1);
            const qA2 = quatZ(ANGLE2);

            const α = Math.abs(ANGLE0);
            // Half-extent of a leaning card projected to world Y (for floor clearance)
            const leanedHalfY = CARD_HEIGHT * Math.cos(α) + CARD_THICKNESS * Math.sin(α);
            // Half-extent of a leaning card projected to world X (base tip reach)
            const leanedHalfX = CARD_HEIGHT * Math.sin(α) + CARD_THICKNESS * Math.cos(α);
            // Step from \ to / centre so base corners just clear each other (~5 mm gap)
            const pairStep = 2 * leanedHalfX + 0.002;

            let nb = 5;
            let z0 = 0;
            let y = leanedHalfY; // cards rest exactly on floor, no penetration

            while (nb > 0) {
                let z = z0;
                for (let i = 0; i < nb; i++) {
                    if (i !== nb - 1) {
                        // Flat card rests on A-frame apex; its world half-height = CARD_THICKNESS
                        card(z + pairStep * 1.5, y + leanedHalfY + CARD_THICKNESS, qA2);
                    }
                    card(z, y, qA1);   // \ leaning card
                    z += pairStep;
                    card(z, y, qA0);   // / leaning card
                    z += pairStep;     // inter-pair gap equals intra-pair step
                }
                // Next layer rests on top of flat cards (top = y + leanedHalfY + 2*CARD_THICKNESS)
                y += 2 * leanedHalfY + 2 * CARD_THICKNESS;
                z0 += pairStep; // offset each row by one pair-step to interleave
                nb--;
            }

            return null;
        },

        preUpdate: (): void => {},
    });
