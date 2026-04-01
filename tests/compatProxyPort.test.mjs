import test from "node:test";
import assert from "node:assert/strict";

import { resolveCompatPortAssignment } from "../shared/compatProxyPort.js";

test("resolveCompatPortAssignment prefers a fresh port for default sessions", async () => {
  const port = await resolveCompatPortAssignment({
    preferredPort: "8787",
    explicitPort: false,
    provider: "openai",
    model: "gpt-5.4",
    isHealthyProxy: async (url) => url === "http://127.0.0.1:8787",
    canListenOnPort: async (candidatePort) => candidatePort === "8788",
  });

  assert.equal(port, "8788");
});

test("resolveCompatPortAssignment can reuse an explicitly requested healthy port", async () => {
  const port = await resolveCompatPortAssignment({
    preferredPort: "8787",
    explicitPort: true,
    provider: "openai",
    model: "gpt-5.4",
    isHealthyProxy: async (url) => url === "http://127.0.0.1:8787",
    canListenOnPort: async () => false,
  });

  assert.equal(port, "8787");
});

test("resolveCompatPortAssignment falls back to the first available port", async () => {
  const port = await resolveCompatPortAssignment({
    preferredPort: "8787",
    explicitPort: false,
    provider: "openai",
    model: "gpt-5.4",
    isHealthyProxy: async () => false,
    canListenOnPort: async (candidatePort) => candidatePort === "8790",
  });

  assert.equal(port, "8790");
});
