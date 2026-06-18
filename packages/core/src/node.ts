// Node-only entry point for @setu/core. Keep BROWSER/edge-only code out of here,
// and keep Node-only code (the jiti-based config loader) out of the main barrel
// (./index.ts) so the engine stays browser-bundleable. Import via '@setu/core/node'.
export { loadConfig } from './config/load'
