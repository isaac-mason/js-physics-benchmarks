type StatsPanel = {
    dom: HTMLCanvasElement;
    update(value: number, maxValue: number): void;
    reset(): void;
};

const HISTORY = 120;

function padNum(n: number, width: number): string {
    return n.toFixed(2).padStart(width, ' ');
}

function computeStats(values: number[]): { min: number; avg: number; max: number } {
    if (values.length === 0) return { min: 0, avg: 0, max: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    const avg = sum / sorted.length;

    return { min, avg, max };
}

export function createStats() {
    const panels: StatsPanel[] = [];

    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    function addPanel(name: string, fg: string, bg: string): StatsPanel {
        const round = Math.round;
        const PR = round(window.devicePixelRatio || 1);

        const WIDTH = 213 * PR,
            HEIGHT = 48 * PR,
            NAME_X = 3 * PR,
            NAME_Y = 2 * PR,
            STATS_X = 65 * PR,
            GRAPH_X = 3 * PR,
            GRAPH_Y = 15 * PR,
            GRAPH_WIDTH = 207 * PR,
            GRAPH_HEIGHT = 30 * PR;

        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        canvas.style.cssText = 'width:213px;height:48px';

        const context = canvas.getContext('2d')!;
        context.font = `bold ${9 * PR}px Helvetica,Arial,sans-serif`;
        context.textBaseline = 'top';

        context.fillStyle = bg;
        context.fillRect(0, 0, WIDTH, HEIGHT);

        const history: number[] = [];

        const panel: StatsPanel = {
            dom: canvas,
            reset: () => {
                history.length = 0;
                context.fillStyle = bg;
                context.globalAlpha = 1;
                context.fillRect(0, 0, WIDTH, HEIGHT);
            },
            update: (value: number, maxValue: number) => {
                history.push(value);
                if (history.length > HISTORY) history.shift();

                const stats = computeStats(history);

                context.fillStyle = bg;
                context.globalAlpha = 1;
                context.fillRect(0, 0, WIDTH, GRAPH_Y);

                context.fillStyle = fg;
                context.fillText(name, NAME_X, NAME_Y);
                context.fillText(
                    `min:${padNum(stats.min, 6)} | avg:${padNum(stats.avg, 6)} | max:${padNum(stats.max, 6)}`,
                    STATS_X,
                    NAME_Y,
                );

                context.fillStyle = bg;
                context.globalAlpha = 1;
                context.fillRect(GRAPH_X, GRAPH_Y, GRAPH_WIDTH, GRAPH_HEIGHT);

                const barWidth = GRAPH_WIDTH / HISTORY;
                const maxBarHeight = GRAPH_HEIGHT;

                context.fillStyle = fg;
                context.globalAlpha = 0.8;
                for (let i = 0; i < history.length; i++) {
                    const value = history[history.length - 1 - i];
                    if (value === undefined) continue;
                    const h = (value / maxValue) * maxBarHeight;
                    const x = GRAPH_X + GRAPH_WIDTH - (i + 1) * barWidth;
                    const y = GRAPH_Y + maxBarHeight - h;
                    context.fillRect(x, y, barWidth - 1, h);
                }
            },
        };

        container.appendChild(panel.dom);
        panels.push(panel);
        return panel;
    }

    const totalPanel = addPanel('TOTAL', '#fff', '#222');
    const preUpdatePanel = addPanel('PRE', '#fa0', '#210');
    const stepPanel = addPanel('STEP', '#f80', '#210');
    const postUpdatePanel = addPanel('POST', '#fb0', '#210');
    const syncPanel = addPanel('SYNC', '#80f', '#102');
    const renderPanel = addPanel('RENDER', '#0f8', '#021');

    let beginTime = performance.now();
    let preUpdateStart = performance.now();
    let stepStart = performance.now();
    let postUpdateStart = performance.now();
    let syncStart = performance.now();
    let renderStart = performance.now();

    return {
        dom: container,

        reset() {
            for (const panel of panels) panel.reset();
        },

        begin() {
            beginTime = performance.now();
        },

        beginPreUpdate() {
            preUpdateStart = performance.now();
        },

        endPreUpdate() {
            preUpdatePanel.update(performance.now() - preUpdateStart, 16);
        },

        beginStep() {
            stepStart = performance.now();
        },

        endStep() {
            stepPanel.update(performance.now() - stepStart, 16);
        },

        beginPostUpdate() {
            postUpdateStart = performance.now();
        },

        endPostUpdate() {
            postUpdatePanel.update(performance.now() - postUpdateStart, 16);
        },

        beginSync() {
            syncStart = performance.now();
        },

        endSync() {
            syncPanel.update(performance.now() - syncStart, 16);
        },

        beginRender() {
            renderStart = performance.now();
        },

        endRender() {
            renderPanel.update(performance.now() - renderStart, 16);
        },

        end() {
            totalPanel.update(performance.now() - beginTime, 16);
        },
    };
}
