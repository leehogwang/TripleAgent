import { randomUUID } from "node:crypto";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import { getAuthStatuses } from "./auth.js";
import { buildHelpText, parseSlashCommand } from "./commands.js";
import { loadPersistedSession, savePersistedSession } from "./persistence.js";
import { startProviderTurn, type ProviderTurnHandle } from "./providers.js";
import {
  applyResultBundle,
  captureFusionBundle,
  captureResultBundle,
  ensureFusionWorktree,
  ensurePanelWorktrees,
} from "./worktree.js";
import type {
  ComposerTarget,
  PanelLockReason,
  PanelState,
  PersistedSession,
  ProviderAuth,
  ProviderId,
  ResultBundle,
  TranscriptEntry,
  WorktreeSetup,
} from "./types.js";

type AppProps = {
  cwd: string;
};

type RunTurnOptions = {
  trackingKey?: string;
  overrideCwd?: string;
  persistBundle?: boolean;
};

type CollapsedPaste = {
  raw: string;
  display: string;
  placeholder: string;
};

const PROVIDERS: ProviderId[] = ["codex", "claude", "gemini"];
const COMPOSER_ORDER: ComposerTarget[] = ["codex", "claude", "gemini", "shared"];
const PASTE_COLLAPSE_THRESHOLD = 800;
const PASTE_COLLAPSE_MAX_LINES = 2;

const AUTH_LOCK_MESSAGE =
  "Authentication required. This panel is dimmed and excluded from normal broadcasts until login succeeds.";

const WORKTREE_WARNING =
  "Git worktrees are unavailable in this directory. TripleAgent can still answer prompts, but /pick and /fuse are disabled.";

function now(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

function panelTitle(provider: ProviderId): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
  }
}

function makeEntry(role: TranscriptEntry["role"], text: string): TranscriptEntry {
  return { role, text, timestamp: now() };
}

function countLineBreaks(text: string): number {
  return (text.match(/\r\n|\r|\n/g) || []).length;
}

function buildPastedContentPlaceholder(charCount: number): string {
  return `[Pasted Content ${charCount} chars]`;
}

function describeInsertedSegment(previousValue: string, nextValue: string): {
  prefix: string;
  inserted: string;
  suffix: string;
} {
  let prefixLength = 0;
  while (
    prefixLength < previousValue.length &&
    prefixLength < nextValue.length &&
    previousValue[prefixLength] === nextValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousValue.length - prefixLength &&
    suffixLength < nextValue.length - prefixLength &&
    previousValue[previousValue.length - 1 - suffixLength] === nextValue[nextValue.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    prefix: nextValue.slice(0, prefixLength),
    inserted: nextValue.slice(prefixLength, nextValue.length - suffixLength),
    suffix: nextValue.slice(nextValue.length - suffixLength),
  };
}

function maybeCollapsePastedContent(previousValue: string, nextValue: string): CollapsedPaste | undefined {
  if (nextValue.length <= previousValue.length) {
    return undefined;
  }

  const insertion = describeInsertedSegment(previousValue, nextValue);
  if (!insertion.inserted) {
    return undefined;
  }

  const insertedLineBreaks = countLineBreaks(insertion.inserted);
  if (insertion.inserted.length <= PASTE_COLLAPSE_THRESHOLD && insertedLineBreaks <= PASTE_COLLAPSE_MAX_LINES) {
    return undefined;
  }

  const placeholder = buildPastedContentPlaceholder(insertion.inserted.length);
  return {
    raw: nextValue,
    display: `${insertion.prefix}${placeholder}${insertion.suffix}`,
    placeholder,
  };
}

function quotaLockMessage(provider: ProviderId): string {
  switch (provider) {
    case "codex":
      return "Codex quota appears exhausted. This panel is disabled until the quota resets.";
    case "claude":
      return "Claude plan quota appears exhausted. This panel is locked to prevent paid overage token usage.";
    case "gemini":
      return "Gemini quota appears exhausted. This panel is disabled until the quota resets.";
  }
}

function providerAccentColor(provider: ProviderId): string {
  switch (provider) {
    case "codex":
      return "#5f5f5f";
    case "claude":
      return "#ff9d3d";
    case "gemini":
      return "#8ecbff";
  }
}

function providerRunningPalette(provider: ProviderId): string[] {
  switch (provider) {
    case "codex":
      return ["#4f4f4f", "#6a6a6a", "#8a8a8a", "#6a6a6a"];
    case "claude":
      return ["#ff7e2f", "#ff9d3d", "#ffbe73", "#ff9d3d"];
    case "gemini":
      return ["#67b8ff", "#8ecbff", "#b9ddff", "#8ecbff"];
  }
}

function statusLabel(status: PanelState["status"]): string {
  switch (status) {
    case "idle":
      return "ready";
    case "running":
      return "running";
    case "locked":
      return "locked";
    case "error":
      return "error";
  }
}

function isPanelLocked(panel: PanelState): boolean {
  return panel.status === "locked" || panel.auth.state !== "ready";
}

function panelCanReceivePrompts(panel: PanelState): boolean {
  return panel.auth.state === "ready" && panel.status !== "locked" && panel.status !== "running";
}

function effectivePlanMode(globalPlanMode: boolean, panel: PanelState): boolean {
  return panel.planModeOverride ?? globalPlanMode;
}

function buildPanelState(
  provider: ProviderId,
  auth: ProviderAuth,
  worktreePath: string | undefined,
  previous?: PersistedSession["panels"][ProviderId],
): PanelState {
  const entries = [...(previous?.entries ?? [])];
  let status: PanelState["status"] = "idle";
  let lockReason: PanelLockReason | undefined = previous?.lockReason;
  let lockMessage = previous?.lockMessage;

  if (auth.state !== "ready") {
    status = "locked";
    lockReason = "auth";
    lockMessage = AUTH_LOCK_MESSAGE;
    if (entries.length === 0) {
      entries.push(makeEntry("system", AUTH_LOCK_MESSAGE));
    }
  } else if (lockReason === "quota") {
    status = "locked";
    lockMessage = lockMessage ?? quotaLockMessage(provider);
    if (entries.length === 0) {
      entries.push(makeEntry("system", lockMessage));
    }
  }

  return {
    provider,
    title: panelTitle(provider),
    status,
    auth,
    entries,
    composerText: "",
    worktreePath,
    sessionId: previous?.sessionId ?? randomUUID(),
    planModeOverride: previous?.planModeOverride,
    lastError: undefined,
    lockReason,
    lockMessage,
    latestBundle: undefined,
  };
}

function summarizeStatus(panel: PanelState, globalPlanMode: boolean): string {
  const parts = [
    `${panel.title}: ${statusLabel(panel.status)}`,
    `mode=${effectivePlanMode(globalPlanMode, panel) ? "plan" : "normal"}`,
    `cwd=${panel.worktreePath ?? "(current directory)"}`,
  ];
  if (panel.lockReason) {
    parts.push(`lock=${panel.lockReason}`);
  }
  return parts.join(" · ");
}

function nextComposerTarget(current: ComposerTarget, panels: Record<ProviderId, PanelState>, direction: 1 | -1): ComposerTarget {
  const start = COMPOSER_ORDER.indexOf(current);
  for (let offset = 1; offset <= COMPOSER_ORDER.length; offset += 1) {
    const index = (start + offset * direction + COMPOSER_ORDER.length) % COMPOSER_ORDER.length;
    const candidate = COMPOSER_ORDER[index];
    if (candidate === "shared") {
      return candidate;
    }
    if (candidate && panelCanReceivePrompts(panels[candidate])) {
      return candidate;
    }
  }
  return "shared";
}

function ComposerView(props: {
  label: string;
  active: boolean;
  locked: boolean;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const prefixColor = props.locked ? "gray" : props.active ? "white" : "gray";
  const content =
    props.active && !props.locked ? (
      <TextInput value={props.value} onChange={props.onChange} onSubmit={props.onSubmit} />
    ) : (
      <Text color={props.value ? "white" : "gray"} dimColor={props.locked}>
        {props.value || props.placeholder}
      </Text>
    );

  return (
    <Box backgroundColor="#202020" paddingX={1}>
      <Text color={prefixColor}>
        {props.label}
        {"> "}
      </Text>
      {content}
    </Box>
  );
}

function PanelView(props: {
  panel: PanelState;
  animationFrame: number;
  globalPlanMode: boolean;
  scrollOffset: number;
  composerActive: boolean;
  onComposerChange: (value: string) => void;
  onComposerSubmit: (value: string) => void;
}) {
  const locked = isPanelLocked(props.panel);
  const runningPalette = providerRunningPalette(props.panel.provider);
  const accentColor =
    !locked && props.panel.status === "running"
      ? runningPalette[props.animationFrame % runningPalette.length] ?? providerAccentColor(props.panel.provider)
      : providerAccentColor(props.panel.provider);
  const statusColor = locked ? "gray" : props.panel.status === "running" ? "yellow" : props.panel.status === "error" ? "red" : "gray";
  const maxOffset = Math.max(0, props.panel.entries.length - 6);
  const boundedOffset = Math.min(props.scrollOffset, maxOffset);
  const sliceEnd = props.panel.entries.length - boundedOffset;
  const sliceStart = Math.max(0, sliceEnd - 6);
  const visibleEntries = props.panel.entries.slice(sliceStart, sliceEnd);
  const emptyMessage = locked
    ? props.panel.lockMessage ?? "This panel is disabled."
    : props.panel.worktreePath
      ? `Worktree: ${props.panel.worktreePath}`
      : "Waiting for a prompt.";

  return (
    <Box flexGrow={1} paddingX={1} flexDirection="column">
      <Text bold={!locked} dimColor={locked}>
        <Text color={accentColor}>{props.panel.title}</Text>
        <Text color={statusColor}> · {statusLabel(props.panel.status)}</Text>
        <Text color="gray"> · {effectivePlanMode(props.globalPlanMode, props.panel) ? "plan" : "normal"}</Text>
        {boundedOffset > 0 ? <Text color="gray"> · scroll {boundedOffset}</Text> : null}
      </Text>
      <Box marginTop={1}>
        <ComposerView
          label={props.panel.title.toLowerCase()}
          active={props.composerActive}
          locked={locked}
          value={props.panel.composerText}
          placeholder={locked ? "panel disabled" : "panel-local prompt or slash command"}
          onChange={props.onComposerChange}
          onSubmit={props.onComposerSubmit}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.length === 0 ? <Text dimColor>{emptyMessage}</Text> : null}
        {visibleEntries.map((entry, index) => (
          <Box key={`${props.panel.provider}-${entry.timestamp}-${index}`} flexDirection="column" marginBottom={1}>
            <Text color={entry.role === "assistant" ? "green" : entry.role === "user" ? "cyan" : "yellow"} dimColor={locked}>
              [{entry.timestamp}] {entry.role}
            </Text>
            <Text dimColor={locked}>{entry.text}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function App({ cwd }: AppProps) {
  const { exit } = useApp();
  const worktreeSetup = useMemo<WorktreeSetup>(() => ensurePanelWorktrees(cwd), [cwd]);
  const [planMode, setPlanMode] = useState(false);
  const [sharedInput, setSharedInput] = useState("");
  const [activeComposer, setActiveComposer] = useState<ComposerTarget>("shared");
  const [notice, setNotice] = useState<string | undefined>(worktreeSetup.error);
  const [animationFrame, setAnimationFrame] = useState(0);
  const [panelScrollOffsets, setPanelScrollOffsets] = useState<Record<ProviderId, number>>({
    codex: 0,
    claude: 0,
    gemini: 0,
  });
  const [collapsedPastes, setCollapsedPastes] = useState<Partial<Record<ComposerTarget, CollapsedPaste>>>({});
  const [panels, setPanels] = useState<Record<ProviderId, PanelState>>(() => {
    const auths = getAuthStatuses();
    const restored = loadPersistedSession();
    const persisted = restored?.cwd === cwd ? restored : undefined;
    if (persisted) {
      return {
        codex: buildPanelState("codex", auths.codex, worktreeSetup.panelWorktrees.codex, persisted.panels.codex),
        claude: buildPanelState("claude", auths.claude, worktreeSetup.panelWorktrees.claude, persisted.panels.claude),
        gemini: buildPanelState("gemini", auths.gemini, worktreeSetup.panelWorktrees.gemini, persisted.panels.gemini),
      };
    }
    return {
      codex: buildPanelState("codex", auths.codex, worktreeSetup.panelWorktrees.codex),
      claude: buildPanelState("claude", auths.claude, worktreeSetup.panelWorktrees.claude),
      gemini: buildPanelState("gemini", auths.gemini, worktreeSetup.panelWorktrees.gemini),
    };
  });

  const panelsRef = useRef(panels);
  const planModeRef = useRef(planMode);
  const activeTurnsRef = useRef<Map<string, ProviderTurnHandle>>(new Map());
  const fusionBundleRef = useRef<ResultBundle | undefined>(undefined);
  const escapeArmedAtRef = useRef<number | undefined>(undefined);
  const noticeTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    planModeRef.current = planMode;
  }, [planMode]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      for (const handle of activeTurnsRef.current.values()) {
        handle.cancel();
      }
    };
  }, []);

  const hasRunningPanels = useMemo(
    () => PROVIDERS.some((provider) => panels[provider].status === "running"),
    [panels],
  );

  const readyCount = useMemo(
    () => PROVIDERS.filter((provider) => panels[provider].auth.state === "ready" && panels[provider].status !== "locked").length,
    [panels],
  );

  useEffect(() => {
    if (!hasRunningPanels) {
      setAnimationFrame(0);
      return;
    }
    const timer = setInterval(() => {
      setAnimationFrame((current) => current + 1);
    }, 180);
    return () => clearInterval(timer);
  }, [hasRunningPanels]);

  useEffect(() => {
    if (activeComposer !== "shared" && !panelCanReceivePrompts(panels[activeComposer])) {
      setActiveComposer("shared");
    }
  }, [activeComposer, panels]);

  useEffect(() => {
    const payload: PersistedSession = {
      cwd,
      planMode,
      panels: {
        codex: {
          entries: panels.codex.entries,
          lockReason: panels.codex.lockReason,
          lockMessage: panels.codex.lockMessage,
          planModeOverride: panels.codex.planModeOverride,
          sessionId: panels.codex.sessionId,
          worktreePath: panels.codex.worktreePath,
        },
        claude: {
          entries: panels.claude.entries,
          lockReason: panels.claude.lockReason,
          lockMessage: panels.claude.lockMessage,
          planModeOverride: panels.claude.planModeOverride,
          sessionId: panels.claude.sessionId,
          worktreePath: panels.claude.worktreePath,
        },
        gemini: {
          entries: panels.gemini.entries,
          lockReason: panels.gemini.lockReason,
          lockMessage: panels.gemini.lockMessage,
          planModeOverride: panels.gemini.planModeOverride,
          sessionId: panels.gemini.sessionId,
          worktreePath: panels.gemini.worktreePath,
        },
      },
    };
    savePersistedSession(payload);
  }, [cwd, panels, planMode]);

  function showNotice(message: string): void {
    setNotice(message);
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => setNotice(undefined), 1800);
  }

  function appendEntry(provider: ProviderId, role: TranscriptEntry["role"], text: string): void {
    setPanels((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        entries: [...current[provider].entries, makeEntry(role, text)],
      },
    }));
  }

  function appendSystem(provider: ProviderId, text: string): void {
    appendEntry(provider, "system", text);
  }

  function appendSystemAll(text: string): void {
    setPanels((current) => {
      const next = { ...current };
      for (const provider of PROVIDERS) {
        next[provider] = {
          ...current[provider],
          entries: [...current[provider].entries, makeEntry("system", text)],
        };
      }
      return next;
    });
  }

  function clearPanels(scope: ComposerTarget): void {
    setCollapsedPastes((current) => {
      if (scope === "shared") {
        return {};
      }
      return {
        ...current,
        [scope]: undefined,
      };
    });
    const auths = getAuthStatuses();
    setPanels((current) => {
      const next = { ...current };
      const targets = scope === "shared" ? PROVIDERS : [scope];
      for (const provider of targets) {
        next[provider] = {
          ...buildPanelState(provider, auths[provider], worktreeSetup.panelWorktrees[provider]),
          entries: [],
          sessionId: current[provider].sessionId,
          worktreePath: worktreeSetup.panelWorktrees[provider],
        };
      }
      return next;
    });
  }

  function refreshAuth(scope: ComposerTarget, noticeMessage?: string): void {
    const auths = getAuthStatuses();
    setPanels((current) => {
      const next = { ...current };
      const targets = scope === "shared" ? PROVIDERS : [scope];
      for (const provider of targets) {
        const auth = auths[provider];
        const authLocked = auth.state !== "ready";
        const currentPanel = current[provider];
        next[provider] = {
          ...currentPanel,
          auth,
          status: authLocked ? "locked" : currentPanel.status === "running" ? "running" : "idle",
          lockReason: authLocked ? "auth" : undefined,
          lockMessage: authLocked ? AUTH_LOCK_MESSAGE : undefined,
          entries: noticeMessage
            ? [...currentPanel.entries, makeEntry("system", authLocked ? `${noticeMessage} Authentication required.` : `${noticeMessage} Ready.`)]
            : currentPanel.entries,
        };
      }
      return next;
    });
  }

  function interruptAllRunning(): void {
    if (activeTurnsRef.current.size === 0) {
      return;
    }
    for (const handle of activeTurnsRef.current.values()) {
      handle.cancel();
    }
    showNotice("Stopping all running agents...");
  }

  function adjustPanelScroll(provider: ProviderId, delta: number): void {
    setPanelScrollOffsets((current) => {
      const entryCount = panelsRef.current[provider].entries.length;
      const maxOffset = Math.max(0, entryCount - 1);
      const nextOffset = Math.max(0, Math.min(maxOffset, current[provider] + delta));
      return {
        ...current,
        [provider]: nextOffset,
      };
    });
  }

  useInput((value, key) => {
    if (activeComposer !== "shared") {
      if (key.pageUp || (key.shift && key.upArrow)) {
        adjustPanelScroll(activeComposer, 1);
        return;
      }
      if (key.pageDown || (key.shift && key.downArrow)) {
        adjustPanelScroll(activeComposer, -1);
        return;
      }
    }

    if (key.tab) {
      setActiveComposer((current) => nextComposerTarget(current, panelsRef.current, key.shift ? -1 : 1));
      return;
    }

    if (key.escape) {
      if (!hasRunningPanels) {
        return;
      }
      const nowValue = Date.now();
      const armedAt = escapeArmedAtRef.current;
      if (armedAt && nowValue - armedAt <= 600) {
        escapeArmedAtRef.current = undefined;
        interruptAllRunning();
        return;
      }
      escapeArmedAtRef.current = nowValue;
      showNotice("Press Esc again to stop all running agents.");
      return;
    }

    if (key.ctrl && value === "c") {
      if (hasRunningPanels) {
        interruptAllRunning();
      } else {
        exit();
      }
    }
  });

  function setComposerDisplayValue(target: ComposerTarget, value: string): void {
    if (target === "shared") {
      setSharedInput(value);
      return;
    }
    setPanels((current) => ({
      ...current,
      [target]: {
        ...current[target],
        composerText: value,
      },
    }));
  }

  function clearComposerDraft(target: ComposerTarget): void {
    setCollapsedPastes((current) => ({
      ...current,
      [target]: undefined,
    }));
    setComposerDisplayValue(target, "");
  }

  function resolveComposerSubmission(target: ComposerTarget, submittedValue: string): string {
    const collapsed = collapsedPastes[target];
    if (collapsed && submittedValue === collapsed.display) {
      return collapsed.raw;
    }
    return submittedValue;
  }

  function handleComposerChange(target: ComposerTarget, nextValue: string): void {
    const currentValue = target === "shared" ? sharedInput : panelsRef.current[target].composerText;
    const collapsed = collapsedPastes[target];

    if (collapsed) {
      if (nextValue === collapsed.display) {
        return;
      }
      setCollapsedPastes((current) => ({
        ...current,
        [target]: undefined,
      }));
      setComposerDisplayValue(target, nextValue);
      return;
    }

    const nextCollapsed = maybeCollapsePastedContent(currentValue, nextValue);
    if (!nextCollapsed) {
      setComposerDisplayValue(target, nextValue);
      return;
    }

    setCollapsedPastes((current) => ({
      ...current,
      [target]: nextCollapsed,
    }));
    setComposerDisplayValue(target, nextCollapsed.display);
  }

  async function runTurn(provider: ProviderId, prompt: string, options: RunTurnOptions = {}): Promise<void> {
    const snapshot = panelsRef.current[provider];
    if (!panelCanReceivePrompts(snapshot)) {
      appendSystem(provider, snapshot.lockMessage ?? "This panel is currently unavailable.");
      return;
    }

    const handle = startProviderTurn({
      provider,
      prompt,
      cwd: options.overrideCwd ?? snapshot.worktreePath ?? cwd,
      planMode: effectivePlanMode(planModeRef.current, snapshot),
      history: snapshot.entries,
      sessionId: snapshot.sessionId,
    });

    const trackingKey = options.trackingKey ?? provider;
    activeTurnsRef.current.set(trackingKey, handle);
    setPanels((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        status: "running",
        lastError: undefined,
        entries: [...current[provider].entries, makeEntry("user", prompt)],
      },
    }));
    setPanelScrollOffsets((current) => ({
      ...current,
      [provider]: 0,
    }));

    const result = await handle.promise;
    activeTurnsRef.current.delete(trackingKey);

    setPanels((current) => {
      const panel = current[provider];
      const auth =
        result.lockReason === "auth"
          ? {
              ...panel.auth,
              state: "auth_required" as const,
              summary: `${panel.title} authentication lost`,
              detail: `Run: tripleagent auth login ${provider}`,
            }
          : panel.auth;
      const lockReason = result.lockReason;
      const lockMessage =
        result.lockMessage ??
        (lockReason === "quota"
          ? quotaLockMessage(provider)
          : lockReason === "auth"
            ? AUTH_LOCK_MESSAGE
            : undefined);

      return {
        ...current,
        [provider]: {
          ...panel,
          auth,
          status: lockReason ? "locked" : result.interrupted ? "idle" : result.ok ? "idle" : "error",
          lastError: result.ok || result.interrupted ? undefined : result.rawOutput,
          lockReason,
          lockMessage,
          latestBundle: current[provider].latestBundle,
          entries: [
            ...panel.entries,
            makeEntry(result.ok && !lockReason ? "assistant" : "system", lockReason ? lockMessage ?? result.text : result.text),
          ],
        },
      };
    });

    if (result.ok && options.persistBundle !== false) {
      const bundle = captureResultBundle(worktreeSetup, provider, result.text);
      if (bundle) {
        setPanels((current) => ({
          ...current,
          [provider]: {
            ...current[provider],
            latestBundle: bundle,
          },
        }));
      }
    }
  }

  async function runFusion(): Promise<void> {
    if (hasRunningPanels) {
      showNotice("Wait for the current run to finish before starting fusion.");
      return;
    }

    const codexPanel = panelsRef.current.codex;
    if (!panelCanReceivePrompts(codexPanel)) {
      appendSystem("codex", codexPanel.lockMessage ?? "Codex is unavailable for fusion.");
      return;
    }

    if (!worktreeSetup.enabled || !worktreeSetup.gitRoot || !worktreeSetup.baseSha) {
      appendSystemAll(worktreeSetup.error ?? WORKTREE_WARNING);
      return;
    }

    const bundles = PROVIDERS.map((provider) => panelsRef.current[provider].latestBundle).filter(
      (bundle): bundle is ResultBundle => Boolean(bundle),
    );

    if (bundles.length === 0) {
      appendSystemAll("No provider diffs are available yet. Ask the agents to make changes first.");
      return;
    }

    const fusionWorktree = ensureFusionWorktree(worktreeSetup);
    if (!fusionWorktree.ok || !fusionWorktree.path) {
      appendSystemAll(fusionWorktree.message ?? "Failed to prepare the fusion worktree.");
      return;
    }

    const fusionPrompt = [
      "Fuse the following candidate implementations into the current worktree.",
      "You are working in a dedicated fusion worktree created from the base commit.",
      "Inspect the repository as needed, then produce the best merged implementation.",
      "",
      ...bundles.map((bundle) =>
        [
          `## ${bundle.provider.toUpperCase()}`,
          `Summary: ${bundle.summary}`,
          "Patch:",
          bundle.patch || "(no file diff captured)",
        ].join("\n"),
      ),
    ].join("\n\n");

    appendSystemAll("Starting Codex fusion pass...");

    const handle = startProviderTurn({
      provider: "codex",
      prompt: fusionPrompt,
      cwd: fusionWorktree.path,
      planMode: effectivePlanMode(planModeRef.current, codexPanel),
      history: codexPanel.entries,
      sessionId: codexPanel.sessionId,
    });

    activeTurnsRef.current.set("fusion", handle);
    setPanels((current) => ({
      ...current,
      codex: {
        ...current.codex,
        status: "running",
        lastError: undefined,
        entries: [...current.codex.entries, makeEntry("user", "/fuse")],
      },
    }));

    const result = await handle.promise;
    activeTurnsRef.current.delete("fusion");

    setPanels((current) => ({
      ...current,
      codex: {
        ...current.codex,
        status: result.lockReason ? "locked" : result.interrupted ? "idle" : result.ok ? "idle" : "error",
        lastError: result.ok || result.interrupted ? undefined : result.rawOutput,
        lockReason: result.lockReason,
        lockMessage: result.lockMessage,
        entries: [
          ...current.codex.entries,
          makeEntry(result.ok && !result.lockReason ? "assistant" : "system", result.lockMessage ?? result.text),
        ],
      },
    }));

    if (!result.ok || result.interrupted) {
      return;
    }

    const bundle = captureFusionBundle(fusionWorktree.path, worktreeSetup.baseSha, result.text);
    fusionBundleRef.current = bundle;
    const applyResult = applyResultBundle(worktreeSetup.gitRoot, bundle);
    appendSystemAll(applyResult.message);
  }

  async function handleAppCommand(target: ComposerTarget, name: string, args: string[]): Promise<void> {
    switch (name) {
      case "exit":
        exit();
        return;
      case "help":
        target === "shared" ? appendSystemAll(buildHelpText()) : appendSystem(target, buildHelpText());
        return;
      case "clear":
        clearPanels(target);
        if (target === "shared") {
          setPlanMode(false);
          fusionBundleRef.current = undefined;
        } else {
          setPanels((current) => ({
            ...current,
            [target]: {
              ...current[target],
              planModeOverride: undefined,
              latestBundle: undefined,
            },
          }));
        }
        return;
      case "status": {
        refreshAuth(target, "Auth status refreshed.");
        const statusText =
          target === "shared"
            ? [...PROVIDERS.map((provider) => summarizeStatus(panelsRef.current[provider], planModeRef.current)), worktreeSetup.error ?? "worktrees=ready"].join("\n")
            : summarizeStatus(panelsRef.current[target], planModeRef.current);
        target === "shared" ? appendSystemAll(statusText) : appendSystem(target, statusText);
        return;
      }
      case "plan": {
        const toggle = args[0] ?? "on";
        const enabled = !["off", "false", "0"].includes(toggle);
        if (target === "shared") {
          setPlanMode(enabled);
          appendSystemAll(enabled ? "Plan mode enabled for all ready panels." : "Plan mode disabled.");
        } else {
          setPanels((current) => ({
            ...current,
            [target]: {
              ...current[target],
              planModeOverride: enabled,
            },
          }));
          appendSystem(target, enabled ? "Panel plan override enabled." : "Panel plan override disabled.");
        }
        return;
      }
      case "resume": {
        const session = loadPersistedSession();
        if (!session) {
          target === "shared" ? appendSystemAll("No saved TripleAgent session found.") : appendSystem(target, "No saved TripleAgent session found.");
          return;
        }
        setCollapsedPastes({});
        const auths = getAuthStatuses();
        setPlanMode(session.planMode);
        setPanels({
          codex: buildPanelState("codex", auths.codex, worktreeSetup.panelWorktrees.codex, session.panels.codex),
          claude: buildPanelState("claude", auths.claude, worktreeSetup.panelWorktrees.claude, session.panels.claude),
          gemini: buildPanelState("gemini", auths.gemini, worktreeSetup.panelWorktrees.gemini, session.panels.gemini),
        });
        appendSystemAll("Restored saved session.");
        return;
      }
      case "init":
        if (target === "shared") {
          for (const provider of PROVIDERS) {
            appendSystem(provider, `Initialized on ${panelsRef.current[provider].worktreePath ?? cwd}`);
          }
        } else {
          appendSystem(target, `Initialized on ${panelsRef.current[target].worktreePath ?? cwd}`);
        }
        return;
      case "login":
      case "logout": {
        const provider = args[0] ?? (target === "shared" ? "all" : target);
        const message = `Run outside the UI: tripleagent auth ${name} ${provider}`;
        target === "shared" ? appendSystemAll(message) : appendSystem(target, message);
        return;
      }
      case "pick": {
        if (target !== "shared") {
          appendSystem(target, "Use /pick from the shared composer.");
          return;
        }
        const picked = args[0] as ProviderId | undefined;
        if (!picked || !PROVIDERS.includes(picked)) {
          appendSystemAll("Usage: /pick <codex|claude|gemini>");
          return;
        }
        if (!worktreeSetup.enabled || !worktreeSetup.gitRoot) {
          appendSystemAll(worktreeSetup.error ?? WORKTREE_WARNING);
          return;
        }
        const bundle = panelsRef.current[picked].latestBundle;
        if (!bundle) {
          appendSystemAll(`No captured diff is available from ${picked}.`);
          return;
        }
        appendSystemAll(applyResultBundle(worktreeSetup.gitRoot, bundle).message);
        return;
      }
      case "fuse":
        if (target !== "shared") {
          appendSystem(target, "Use /fuse from the shared composer.");
          return;
        }
        await runFusion();
        return;
      default:
        target === "shared"
          ? appendSystemAll(`Command /${name} is registered but not implemented in TripleAgent.`)
          : appendSystem(target, `Command /${name} is registered but not implemented in TripleAgent.`);
    }
  }

  async function submitShared(value: string): Promise<void> {
    const submittedValue = resolveComposerSubmission("shared", value);
    const line = submittedValue.trim();
    if (!line) {
      return;
    }
    clearComposerDraft("shared");

    const parsed = parseSlashCommand(line);
    if (parsed) {
      if (parsed.kind === "unknown") {
        appendSystemAll(`Unknown command: /${parsed.name}`);
        return;
      }
      if (parsed.kind === "claude-only") {
        appendSystemAll(`/${parsed.name} is panel-local. Focus the Claude panel and run it there.`);
        return;
      }
      await handleAppCommand("shared", parsed.name, parsed.args);
      return;
    }

    if (hasRunningPanels) {
      showNotice("Wait for the current run to finish before sending another shared prompt.");
      setComposerDisplayValue("shared", line);
      return;
    }

    const runnable = PROVIDERS.filter((provider) => panelCanReceivePrompts(panelsRef.current[provider]));
    if (runnable.length === 0) {
      appendSystemAll("No ready panels are currently able to receive the shared prompt.");
      return;
    }

    await Promise.allSettled(runnable.map((provider) => runTurn(provider, line)));
  }

  async function submitPanel(provider: ProviderId, value: string): Promise<void> {
    const submittedValue = resolveComposerSubmission(provider, value);
    const line = submittedValue.trim();
    if (!line) {
      return;
    }
    clearComposerDraft(provider);

    const parsed = parseSlashCommand(line);
    if (parsed) {
      if (parsed.kind === "unknown") {
        appendSystem(provider, `Unknown command: /${parsed.name}`);
        return;
      }
      if (parsed.kind === "app") {
        await handleAppCommand(provider, parsed.name, parsed.args);
        return;
      }
      if (provider !== "claude") {
        appendSystem(provider, `/${parsed.name} follows the Claude harness and is only available on the Claude panel.`);
        return;
      }
    }

    if (hasRunningPanels) {
      showNotice("Wait for the current run to finish before sending another prompt.");
      setComposerDisplayValue(provider, line);
      return;
    }

    await runTurn(provider, line);
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="magentaBright" bold>
        TripleAgent
      </Text>
      <Text color="gray">
        Claude harness shell · Ready panels: {readyCount}/3 · Mode: {planMode ? "PLAN" : "NORMAL"} · CWD: {cwd}
      </Text>
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <Box marginTop={1}>
        {PROVIDERS.map((provider, index) => (
          <React.Fragment key={provider}>
            <PanelView
              panel={panels[provider]}
              animationFrame={animationFrame}
              globalPlanMode={planMode}
              scrollOffset={panelScrollOffsets[provider]}
              composerActive={activeComposer === provider}
              onComposerChange={(value) => handleComposerChange(provider, value)}
              onComposerSubmit={(value) => submitPanel(provider, value)}
            />
            {index < PROVIDERS.length - 1 ? (
              <Box
                borderStyle="single"
                borderTop={false}
                borderBottom={false}
                borderRight={false}
                borderLeft
                borderColor="gray"
                borderLeftDimColor
                marginX={1}
              />
            ) : null}
          </React.Fragment>
        ))}
      </Box>
      <Box marginTop={1}>
        <ComposerView
          label="shared"
          active={activeComposer === "shared"}
          locked={false}
          value={sharedInput}
          placeholder="broadcast prompt or global command"
          onChange={(value) => handleComposerChange("shared", value)}
          onSubmit={submitShared}
        />
      </Box>
      <Text color="gray">Tab focus · Shift+Up/Down scroll active panel · Shared: /help /status /plan /init /clear /resume /pick /fuse · Esc Esc stops all</Text>
    </Box>
  );
}

export async function startTripleAgentApp(cwd: string): Promise<void> {
  const instance = render(<App cwd={cwd} />);
  await instance.waitUntilExit();
}
