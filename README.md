# js-physics-benchmarks

A collection of benchmarks for JavaScript (pure JS and WebAssembly) physics engines, measuring bundle sizes and runtime performance.

https://isaac-mason.github.io/js-physics-benchmarks

## Methodology

Engines are benchmarked in their best **single-threaded** configuration, with SIMD enabled wherever the engine supports it.

Where a published package doesn't ship a single-threaded + SIMD build, one is built from source and committed under `src/lib/` — see [`scripts/`](scripts).

## Contributing

Feel free to contribute by adding new physics engines, scenarios, or improving existing ones.

## License

MIT License, see [LICENSE](LICENSE).