export type ProviderId = "codex" | "claude" | "gemini";
export type ComposerTarget = ProviderId | "shared";

export type AuthState = "ready" | "auth_required" | "unsupported";

export type PanelStatus = "idle" | "running" | "locked" | "error";
export type PanelLockReason = "auth" | "quota" | "workspace";

export type TranscriptRole = "system" | "user" | "assistant";

export type TranscriptEntry = {
  role: TranscriptRole;
  text: string;
  displayText?: string;
  timestamp: string;
};

export type ProviderAuth = {
  provider: ProviderId;
  state: AuthState;
  summary: string;
  detail: string;
};

export type PanelState = {
  provider: ProviderId;
  title: string;
  status: PanelStatus;
  auth: ProviderAuth;
  entries: TranscriptEntry[];
  composerText: string;
  worktreePath: string | undefined;
  sessionId: string;
  planModeOverride: boolean | undefined;
  lastError: string | undefined;
  lockReason: PanelLockReason | undefined;
  lockMessage: string | undefined;
  latestBundle: ResultBundle | undefined;
};

export type PersistedSession = {
  cwd: string;
  planMode: boolean;
  panels: Record<
    ProviderId,
    Pick<
      PanelState,
      "entries" | "lockReason" | "lockMessage" | "planModeOverride" | "sessionId" | "worktreePath"
    >
  >;
};

export type ProviderRunResult = {
  ok: boolean;
  text: string;
  rawOutput: string;
  interrupted: boolean;
  lockReason: PanelLockReason | undefined;
  lockMessage: string | undefined;
};

export type ResultBundle = {
  provider: ProviderId;
  baseSha: string;
  patch: string;
  summary: string;
  worktreePath: string;
  capturedAt: string;
};

export type WorktreeSetup = {
  enabled: boolean;
  gitRoot: string | undefined;
  targetRoot: string | undefined;
  baseSha: string | undefined;
  panelWorktrees: Partial<Record<ProviderId, string>>;
  fusionWorktreePath: string | undefined;
  error: string | undefined;
};

export type ProviderRunArgs = {
  provider: ProviderId;
  prompt: string;
  cwd: string;
  planMode: boolean;
  history: TranscriptEntry[];
  signal?: AbortSignal;
  sessionId?: string;
};
