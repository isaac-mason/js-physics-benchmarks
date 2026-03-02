import type GUI from 'lil-gui';
import type { Renderer } from '../renderer';
import type { PhysicsState } from '../api';

export type ScenarioControls<Controls> = (gui: GUI) => Controls;

export type ScenarioInit<State> = (state: PhysicsState, renderer: Renderer) => State;

export type ScenarioUpdate<State, Controls = void> = (
    state: State,
    physics: PhysicsState,
    renderer: Renderer,
    controls: Controls,
    dt: number,
) => void;

export type ScenarioDispose<State> = (state: State, physics: PhysicsState, renderer: Renderer) => void;

export type Scenario<State, Controls = void> = {
    controls?: ScenarioControls<Controls>;
    init: ScenarioInit<State>;
    preUpdate: ScenarioUpdate<State, Controls>;
    postUpdate?: ScenarioUpdate<State, Controls>;
    dispose?: ScenarioDispose<State>;
};

export function createScenario<State, Controls = void>(fns: {
    controls?: ScenarioControls<Controls>;
    init: ScenarioInit<State>;
    preUpdate: ScenarioUpdate<State, Controls>;
    postUpdate?: ScenarioUpdate<State, Controls>;
    dispose?: ScenarioDispose<State>;
}): Scenario<State, Controls> {
    return fns;
}
