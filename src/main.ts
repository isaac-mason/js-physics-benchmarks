import GUI from 'lil-gui';
import bundleSizes from '../bundle-sizes/results.json';
import type { PhysicsState } from './api';
import { createPhysicsState, snapshot } from './api';
import * as ammo from './impls/ammo-impl';
import * as bounce from './impls/bounce-impl';
import * as cannon from './impls/cannon-impl';
import * as crashcat from './impls/crashcat-impl';
import type { PhysicsImpl } from './impls/impl';
import * as jolt from './impls/jolt-impl';
import * as rapier from './impls/rapier-impl';
import { createRenderer } from './renderer';
import { createContactListenersScenario } from './scenarios/contact-listeners';
import { createConvexHullsScenario } from './scenarios/convex-hulls';
import { createCubeHeapScenario } from './scenarios/cube-heap';
import { createPyramidScenario } from './scenarios/pyramid';
import { createRaycastsScenario } from './scenarios/raycasts';
import { createStableStackingScenario } from './scenarios/stable-stacking';
import type { Scenario } from './scenarios/types';
import { createStats } from './stats';

const PHYSICS_DT = 1 / 60;
const MAX_SUBSTEPS = 8;

let impl: PhysicsImpl;
let physics: PhysicsState;
const currentRenderer = createRenderer();
const stats = createStats();
document.getElementById('stats-container')!.appendChild(stats.dom);

// biome-ignore format: pretty
const ENGINES = [
    { id: 'crashcat', label: 'crashcat',  tag: 'js',   repoUrl: 'https://github.com/isaac-mason/crashcat' },
    { id: 'bounce',   label: 'bounce',    tag: 'js',   repoUrl: 'https://codeberg.org/perplexdotgg/bounce' },
    { id: 'cannon',   label: 'cannon-es', tag: 'js',   repoUrl: 'https://github.com/pmndrs/cannon-es' },
    { id: 'rapier',   label: 'rapier',    tag: 'wasm', repoUrl: 'https://github.com/dimforge/rapier.js' },
    { id: 'jolt',     label: 'jolt',      tag: 'wasm', repoUrl: 'https://github.com/jrouwe/JoltPhysics.js' },
    { id: 'ammo',     label: 'ammo.js',   tag: 'wasm', repoUrl: 'https://github.com/kripken/ammo.js' },
]

// biome-ignore format: pretty
const SCENARIOS = [
    { id: 'cube-heap',          label: 'Cube Heap',          create: createCubeHeapScenario },
    { id: 'convex-hulls',       label: 'Convex Hull Heap',   create: createConvexHullsScenario },
    { id: 'contact-listeners',  label: 'Contact Listeners',  create: createContactListenersScenario },
    { id: 'pyramid',            label: 'Pyramid',            create: createPyramidScenario },
    { id: 'stable-stacking',    label: 'Stacking Stability', create: createStableStackingScenario },
    { id: 'raycasts',           label: 'Raycasts',           create: createRaycastsScenario },
]

function fmtKb(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} kB`;
}

let accumulator = 0;
let lastTime = performance.now();

// Active scenario — erased types so any scenario fits
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeScenario: Scenario<any, any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeScenarioState: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeScenarioControls: any;
let activeScenarioGui: GUI | undefined;
let activeScenarioControlsMounted = false;
let activeScenarioName = 'cube-heap';
let activeEngineName = 'crashcat';

// --- URL query param helpers ---

function encodeParams(engine: string, scenario: string, controls: unknown): void {
    let qs = `engine=${encodeURIComponent(engine)}&scenario=${encodeURIComponent(scenario)}`;
    if (controls !== undefined && controls !== null) {
        qs += `&controls=${JSON.stringify(controls)}`;
    }
    history.replaceState(null, '', `?${qs}`);
}

function decodeParams(): { engine: string; scenario: string; controls: Record<string, unknown> | null } {
    const defaultEngine = ENGINES[0]!.id;
    const defaultScenario = SCENARIOS[0]!.id;
    const params = new URLSearchParams(window.location.search);

    const rawEngine = params.get('engine') ?? defaultEngine;
    const rawScenario = params.get('scenario') ?? defaultScenario;
    const rawControls = params.get('controls');

    const engine = ENGINES.find((e) => e.id === rawEngine) ? rawEngine : defaultEngine;
    const scenario = SCENARIOS.find((s) => s.id === rawScenario) ? rawScenario : defaultScenario;

    let controls: Record<string, unknown> | null = null;
    if (rawControls) {
        try {
            const parsed = JSON.parse(rawControls);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                controls = parsed as Record<string, unknown>;
            }
        } catch {
            // ignore malformed JSON
        }
    }

    return { engine, scenario, controls };
}

function applyRestoredControls(controls: Record<string, unknown>): void {
    if (!activeScenarioControls || !activeScenarioGui) return;
    for (const key of Object.keys(controls)) {
        if (key in activeScenarioControls) {
            activeScenarioControls[key] = controls[key];
        }
    }
    for (const c of activeScenarioGui.controllersRecursive()) c.updateDisplay();
}

const engineButtonsContainer = document.getElementById('engine-buttons')!;
ENGINES.forEach(({ id, label, tag, repoUrl }) => {
    const sizes = bundleSizes.results[id as keyof typeof bundleSizes.results];
    const version = bundleSizes.meta.versions[id as keyof typeof bundleSizes.meta.versions];

    const jsOk = sizes && 'js' in sizes;
    const wasmOk = sizes && 'wasm' in sizes && sizes.wasm;
    const jsMin = jsOk ? (sizes as any).js.minified : null;
    const jsMinGz = jsOk ? (sizes as any).js.minifiedGzip : null;
    const wasmRaw = wasmOk ? (sizes as any).wasm.total : null;
    const wasmGzip = wasmOk ? (sizes as any).wasm.totalGzip : null;

    const totalMin = jsMin != null ? jsMin + (wasmRaw ?? 0) : null;
    const totalMinGz = jsMinGz != null ? jsMinGz + (wasmGzip ?? 0) : null;

    const wasmCols = wasmOk
        ? `
            <div class="card-col-divider"></div>
            <div class="card-col">
                <div class="card-col-label">WASM</div>
                <div class="card-col-stat"><span class="card-stat-label">raw</span><span class="card-stat-value">${wasmRaw != null ? fmtKb(wasmRaw) : '—'}</span></div>
                <div class="card-col-stat"><span class="card-stat-label">gz</span><span class="card-stat-value">${wasmGzip != null ? fmtKb(wasmGzip) : '—'}</span></div>
            </div>`
        : '';

    const btn = document.createElement('button');
    btn.className = `engine-btn${id === 'crashcat' ? ' active' : ''}`;
    btn.dataset.engine = id;
    btn.innerHTML = `
        <div class="card-header">
            <a class="card-name" href="${repoUrl}" target="_blank" rel="noopener noreferrer">${label}</a>
            <span class="engine-tag tag-${tag}">${tag}</span>
        </div>
        <div class="card-version">v${version}</div>
        <div class="card-cols">
            <div class="card-col">
                <div class="card-col-label">JS</div>
                <div class="card-col-stat"><span class="card-stat-label">min</span><span class="card-stat-value">${jsMin != null ? fmtKb(jsMin) : '—'}</span></div>
                <div class="card-col-stat"><span class="card-stat-label">min+gz</span><span class="card-stat-value">${jsMinGz != null ? fmtKb(jsMinGz) : '—'}</span></div>
            </div>
            ${wasmCols}
        </div>
        <div class="card-totals">
            <div class="card-total-stat"><span class="card-stat-label">total min</span><span class="card-stat-value">${totalMin != null ? fmtKb(totalMin) : '—'}</span></div>
            <div class="card-total-stat"><span class="card-stat-label">total min+gz</span><span class="card-stat-value card-stat-value--highlight">${totalMinGz != null ? fmtKb(totalMinGz) : '—'}</span></div>
        </div>
    `;
    engineButtonsContainer.appendChild(btn);

    // Prevent the link click from also triggering the engine-switch button handler
    btn.querySelector<HTMLAnchorElement>('.card-name')!.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});

const scenarioButtonsContainer = document.getElementById('scenario-buttons')!;
SCENARIOS.forEach(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = `scenario-btn${id === activeScenarioName ? ' active' : ''}`;
    btn.dataset.scenario = id;
    btn.textContent = label;
    scenarioButtonsContainer.appendChild(btn);
});

const engineButtons = document.querySelectorAll('.engine-btn') as NodeListOf<HTMLButtonElement>;
const scenarioButtons = document.querySelectorAll('.scenario-btn') as NodeListOf<HTMLButtonElement>;

function getScenario(name: string): Scenario<any, any> {
    const entry = SCENARIOS.find((s) => s.id === name);
    if (!entry) throw new Error(`Unknown scenario: ${name}`);
    return entry.create();
}

function mountControls(scenario: Scenario<any, any>): { controls: any; gui: GUI | undefined } {
    if (!scenario.controls) return { controls: undefined, gui: undefined };
    const gui = new GUI({ autoPlace: false, width: 213 });
    document.getElementById('scenario-gui')!.appendChild(gui.domElement);
    const controls = scenario.controls(gui);
    gui.onChange(() => encodeParams(activeEngineName, activeScenarioName, controls));
    return { controls, gui };
}

function teardownControls(): void {
    activeScenarioGui?.destroy();
    activeScenarioGui = undefined;
    activeScenarioControls = undefined;
    activeScenarioControlsMounted = false;
}

async function startEngine(name: string): Promise<void> {
    activeEngineName = name;
    // Teardown only physics state — controls/gui survive engine switches
    if (impl && physics) {
        if (activeScenario?.dispose && activeScenarioState) {
            activeScenario.dispose(activeScenarioState, physics, currentRenderer);
        }
        impl.disposeContactListener(physics.world);
        impl.disposeWorld(physics.world);
    }

    if (name === 'crashcat') {
        impl = crashcat;
    } else if (name === 'rapier') {
        impl = rapier;
    } else if (name === 'jolt') {
        impl = jolt;
    } else if (name === 'cannon') {
        impl = cannon;
    } else if (name === 'bounce') {
        impl = bounce;
    } else if (name === 'ammo') {
        impl = ammo;
    } else {
        throw new Error(`Unknown engine: ${name}`);
    }

    physics = createPhysicsState(impl, impl.createWorld());
    currentRenderer.clear();
    currentRenderer.resetCamera();
    stats.reset();

    activeScenario = getScenario(activeScenarioName);

    // Mount controls only on first load; reuse on subsequent engine switches
    if (!activeScenarioControlsMounted) {
        const mounted = mountControls(activeScenario);
        activeScenarioControls = mounted.controls;
        activeScenarioGui = mounted.gui;
        activeScenarioControlsMounted = true;
    }

    activeScenarioState = activeScenario.init(physics, currentRenderer);
    encodeParams(activeEngineName, activeScenarioName, activeScenarioControls);
}

function startScenario(name: string): void {
    activeScenarioName = name;
    if (!impl || !physics) return;

    // Full teardown — physics + controls/gui
    if (activeScenario?.dispose && activeScenarioState) {
        activeScenario.dispose(activeScenarioState, physics, currentRenderer);
    }
    teardownControls();
    impl.disposeContactListener(physics.world);
    impl.disposeWorld(physics.world);
    physics = createPhysicsState(impl, impl.createWorld());
    currentRenderer.clear();
    currentRenderer.resetCamera();
    stats.reset();

    activeScenario = getScenario(name);

    const mounted = mountControls(activeScenario);
    activeScenarioControls = mounted.controls;
    activeScenarioGui = mounted.gui;
    activeScenarioControlsMounted = true;

    activeScenarioState = activeScenario.init(physics, currentRenderer);
    encodeParams(activeEngineName, activeScenarioName, activeScenarioControls);
}

function animate(): void {
    requestAnimationFrame(animate);

    stats.begin();

    const currentTime = performance.now();
    let frameTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    if (frameTime > 0.25) frameTime = 0.25;

    accumulator += frameTime;

    let stepped = 0;
    while (accumulator >= PHYSICS_DT && stepped < MAX_SUBSTEPS) {
        if (activeScenario && activeScenarioState && physics) {
            stats.beginPreUpdate();
            activeScenario.preUpdate(activeScenarioState, physics, currentRenderer, activeScenarioControls, PHYSICS_DT);
            stats.endPreUpdate();
        }
        if (physics) {
            stats.beginStep();
            physics.impl.stepSimulation(physics.world, PHYSICS_DT);
            snapshot(physics);
            stats.endStep();
        }
        stats.beginPostUpdate();
        if (activeScenario?.postUpdate && activeScenarioState && physics) {
            activeScenario.postUpdate(activeScenarioState, physics, currentRenderer, activeScenarioControls, PHYSICS_DT);
        }
        stats.endPostUpdate();
        accumulator -= PHYSICS_DT;
        stepped++;
    }

    stats.beginSync();
    if (physics) {
        currentRenderer.update(physics, accumulator / PHYSICS_DT);
    }
    stats.endSync();

    stats.beginRender();
    currentRenderer.controls.update();
    currentRenderer.renderer.render(currentRenderer.scene, currentRenderer.camera);
    stats.endRender();

    stats.end();
}

engineButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
        for (const b of engineButtons) b.classList.remove('active');
        btn.classList.add('active');
        await startEngine(btn.dataset.engine!);
    });
});

scenarioButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        for (const b of scenarioButtons) b.classList.remove('active');
        btn.classList.add('active');
        startScenario(btn.dataset.scenario!);
    });
});

async function init(): Promise<void> {
    const { engine, scenario, controls: restoredControls } = decodeParams();
    activeEngineName = engine;
    activeScenarioName = scenario;

    // Sync button active states to restored hash values
    for (const b of engineButtons) b.classList.toggle('active', b.dataset.engine === engine);
    for (const b of scenarioButtons) b.classList.toggle('active', b.dataset.scenario === scenario);

    await Promise.all([crashcat.init(), rapier.init(), jolt.init(), cannon.init(), bounce.init(), ammo.init()]);
    await startEngine(engine);

    // Restore controls from hash after they've been mounted
    if (restoredControls) {
        applyRestoredControls(restoredControls);
        encodeParams(activeEngineName, activeScenarioName, activeScenarioControls);
    }

    animate();
}

init();
