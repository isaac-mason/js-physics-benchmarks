// the scenarios without a browser: scripts/run.ts bundles this and steps each scenario as main.ts's animate loop does,
// timing the same phases

import * as THREE from 'three';
import { createPhysicsState, MotionType, type PhysicsState, snapshot, type Vec3 } from './api';
import * as ammo from './impls/ammo-impl';
import * as bounce from './impls/bounce-impl';
import * as box3d from './impls/box3d-impl';
import * as cannon from './impls/cannon-impl';
import * as crashcat from './impls/crashcat-impl';
import type { PhysicsImpl } from './impls/impl';
import * as jolt from './impls/jolt-impl';
import * as meep from './impls/meep-impl';
import * as rapier from './impls/rapier-impl';
import * as tumble from './impls/tumble-impl';
import type { Renderer } from './renderer';
import { SCENARIOS } from './scenarios/registry';

type Engine = PhysicsImpl<any, any, any, any> & { capabilities: ReadonlySet<string> };

export const ENGINES: Record<string, Engine> = {
    ammo,
    bounce,
    box3d,
    cannon,
    crashcat,
    jolt,
    meep,
    rapier,
    tumble,
};

export const SCENARIO_IDS: string[] = SCENARIOS.map((s) => s.id);

export async function initEngine(id: string): Promise<void> {
    const engine = ENGINES[id];
    if (!engine) throw new Error(`unknown engine '${id}', one of ${Object.keys(ENGINES).join(', ')}`);
    await engine.init();
}

/** why the engine can't run the scenario, or null when it can */
export function unsupported(engineId: string, scenarioId: string): string | null {
    const entry = SCENARIOS.find((s) => s.id === scenarioId);
    if (!entry) return `unknown scenario '${scenarioId}'`;
    const requires: readonly string[] = entry.requires ?? [];
    const missing = requires.filter((c) => !ENGINES[engineId]!.capabilities.has(c));
    return missing.length > 0 ? `missing ${missing.join(', ')}` : null;
}

export type RunOptions = {
    warmup: number;
    steps: number;
    dt: number;
    seed: number;
};

export type RunResult = {
    /** ms per timed step: the engine's step alone */
    step: Float64Array;
    /** ms per timed step: the scenario's pre and post update (a query scenario's rays) */
    update: Float64Array;
    /** ms per timed step: reading every body's pose back, as the browser's snapshot does */
    sync: Float64Array;
    dynamicBodies: number;
    /** dynamic bodies with a non-finite pose or past 1 km of the origin */
    escaped: number;
    meanY: number;
    meanSpeed: number;
    maxSpeed: number;
};

// a lil-gui stand in: every call chains, so a scenario's controls keep the defaults it writes
function createGuiStub(): any {
    const stub: any = new Proxy(() => stub, { get: () => () => stub });
    return stub;
}

function createRendererStub(): Renderer {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const controls = { target: new THREE.Vector3(), update: () => {} };
    return {
        scene,
        camera,
        renderer: null,
        controls,
        update: () => {},
        clear: () => {},
        resetCamera: () => {},
        dispose: () => {},
    } as unknown as Renderer;
}

// mulberry32: every engine sees the same spawn positions for a seed
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _velocity: Vec3 = [0, 0, 0];

/**
 * a discarded run of `warmup` steps warms the engine's code, then a fresh world with the same seed is timed from its
 * first step, so every engine is timed over the same stretch of the scenario
 */
export async function runScenario(engineId: string, scenarioId: string, options: RunOptions): Promise<RunResult> {
    if (options.warmup > 0) await simulate(engineId, scenarioId, options, options.warmup, null);
    const result: RunResult = {
        step: new Float64Array(options.steps),
        update: new Float64Array(options.steps),
        sync: new Float64Array(options.steps),
        dynamicBodies: 0,
        escaped: 0,
        meanY: 0,
        meanSpeed: 0,
        maxSpeed: 0,
    };
    (globalThis as any).gc?.();
    await simulate(engineId, scenarioId, options, options.steps, result);
    return result;
}

async function simulate(engineId: string, scenarioId: string, options: RunOptions, steps: number, out: RunResult | null): Promise<void> {
    const engine = ENGINES[engineId]!;
    const entry = SCENARIOS.find((s) => s.id === scenarioId)!;
    const nativeRandom = Math.random;
    Math.random = seededRandom(options.seed);
    const physics: PhysicsState = createPhysicsState(engine, engine.createWorld());
    const renderer = createRendererStub();
    const scenario = entry.create() as any;
    try {
        const controls = scenario.controls ? scenario.controls(createGuiStub()) : undefined;
        const state = scenario.init(physics, renderer);
        // the browser's first step comes a frame after init, and meep's world finishes its async startup in between
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let i = 0; i < steps; i++) {
            const t0 = performance.now();
            scenario.preUpdate(state, physics, renderer, controls, options.dt);
            const t1 = performance.now();
            engine.stepSimulation(physics.world, options.dt);
            const t2 = performance.now();
            snapshot(physics);
            const t3 = performance.now();
            scenario.postUpdate?.(state, physics, renderer, controls, options.dt);
            const t4 = performance.now();
            if (out !== null) {
                out.step[i] = t2 - t1;
                out.update[i] = t1 - t0 + (t4 - t3);
                out.sync[i] = t3 - t2;
            }
        }
        if (out !== null) measureBodies(out, engine, physics);
        scenario.dispose?.(state, physics, renderer);
    } finally {
        engine.disposeContactListener(physics.world);
        engine.disposeWorld(physics.world);
        Math.random = nativeRandom;
    }
}

function measureBodies(out: RunResult, engine: Engine, physics: PhysicsState): void {
    let sumY = 0;
    let sumSpeed = 0;
    for (const body of physics.bodies.values()) {
        if (body.motionType !== MotionType.DYNAMIC) continue;
        out.dynamicBodies++;
        const [x, y, z] = body.position;
        if (!Number.isFinite(x + y + z) || Math.abs(x) > 1000 || Math.abs(y) > 1000 || Math.abs(z) > 1000) {
            out.escaped++;
            continue;
        }
        engine.getBodyLinearVelocity(_velocity, physics.world, body.handle);
        const speed = Math.hypot(_velocity[0], _velocity[1], _velocity[2]);
        sumY += y;
        sumSpeed += speed;
        if (speed > out.maxSpeed) out.maxSpeed = speed;
    }
    const counted = Math.max(1, out.dynamicBodies - out.escaped);
    out.meanY = sumY / counted;
    out.meanSpeed = sumSpeed / counted;
}
