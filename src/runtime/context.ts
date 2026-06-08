import { RootRegistry } from "../services/root-registry.js";
import type { BridgeRuntimeDiagnostics } from "./session-observability.js";

export type RuntimeContext = {
  registry: RootRegistry;
  diagnostics?: BridgeRuntimeDiagnostics;
};
