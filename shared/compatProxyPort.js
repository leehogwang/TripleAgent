export async function resolveCompatPortAssignment({
  preferredPort,
  explicitPort = false,
  provider,
  model,
  isHealthyProxy,
  canListenOnPort,
  maxAttempts = 25,
}) {
  const preferredUrl = `http://127.0.0.1:${preferredPort}`;

  if (explicitPort && (await isHealthyProxy(preferredUrl, provider, model))) {
    return preferredPort;
  }

  if (await canListenOnPort(preferredPort)) {
    return preferredPort;
  }

  let candidate = Number.parseInt(preferredPort, 10) + 1;
  for (let attempts = 0; attempts < maxAttempts; attempts += 1, candidate += 1) {
    const candidatePort = String(candidate);
    const candidateUrl = `http://127.0.0.1:${candidatePort}`;

    if (explicitPort && (await isHealthyProxy(candidateUrl, provider, model))) {
      return candidatePort;
    }

    if (await canListenOnPort(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(`Could not find a free compatibility proxy port starting from ${preferredPort}.`);
}
