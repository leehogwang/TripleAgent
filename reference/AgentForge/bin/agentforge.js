#!/usr/bin/env node
/**
 * AgentForge launcher + first-run setup wizard
 *
 * 첫 실행 시 (~/. codex/auth.json 없거나 토큰 없음):
 *   1. Python 확인 + pip 의존성 설치
 *   2. codex login (OAuth 브라우저 플로우)
 *   3. agentforge 실행
 */
'use strict';

const { spawn, spawnSync, execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── 상수 ─────────────────────────────────────────────
const SCRIPT = path.join(__dirname, '..', 'agentforge');
const WIN    = os.platform() === 'win32';

const R      = '\x1b[0m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

const DEPS = [
  { import: 'rich',              pip: 'rich'              },
  { import: 'prompt_toolkit',    pip: 'prompt_toolkit'    },
  { import: 'requests',          pip: 'requests'          },
  { import: 'rank_bm25',         pip: 'rank-bm25'         },
  { import: 'tiktoken',          pip: 'tiktoken'          },
  { import: 'ddgs',              pip: 'ddgs'              },
];

// ── 인증 확인 ─────────────────────────────────────────
function isAlreadyAuthed() {
  try {
    const data = JSON.parse(fs.readFileSync(
      path.join(os.homedir(), '.codex', 'auth.json'), 'utf8'));
    return !!data?.tokens?.access_token;
  } catch { return false; }
}

// ── codex 바이너리 탐색 ───────────────────────────────
function findCodex() {
  // 1. PATH에서 탐색
  const r = spawnSync(WIN ? 'where' : 'which', ['codex'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim().split('\n')[0];
  // 2. ~/.npm-global/bin/codex (Linux/Mac 기본)
  const fallback = path.join(os.homedir(), '.npm-global', 'bin', 'codex');
  if (fs.existsSync(fallback)) return fallback;
  // 3. Windows npm global
  if (WIN) {
    const winFallback = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd');
    if (fs.existsSync(winFallback)) return winFallback;
  }
  return null;
}

// ── Python 탐색 ───────────────────────────────────────
function findPython() {
  const candidates = WIN ? ['py', 'python', 'python3'] : ['python3', 'python'];

  for (const bin of candidates) {
    const vArgs = bin === 'py'
      ? ['-3', '-c', 'import sys;exit(0 if sys.version_info>=(3,10) else 1)']
      : ['-c', 'import sys;exit(0 if sys.version_info>=(3,10) else 1)'];
    const pipArgs = bin === 'py'
      ? ['-3', '-m', 'pip', '--version']
      : ['-m', 'pip', '--version'];
    if (spawnSync(bin, vArgs, { encoding: 'utf8' }).status === 0 &&
        spawnSync(bin, pipArgs, { encoding: 'utf8' }).status === 0) {
      return { bin, extra: bin === 'py' ? ['-3'] : [] };
    }
  }

  // pip 없어도 버전 맞으면 ensurepip 시도
  for (const bin of candidates) {
    const vArgs = bin === 'py'
      ? ['-3', '-c', 'import sys;exit(0 if sys.version_info>=(3,10) else 1)']
      : ['-c', 'import sys;exit(0 if sys.version_info>=(3,10) else 1)'];
    if (spawnSync(bin, vArgs, { encoding: 'utf8' }).status === 0) {
      const eArgs = bin === 'py' ? ['-3', '-m', 'ensurepip', '--upgrade'] : ['-m', 'ensurepip', '--upgrade'];
      if (spawnSync(bin, eArgs, { stdio: 'inherit' }).status === 0)
        return { bin, extra: bin === 'py' ? ['-3'] : [] };
    }
  }
  return null;
}

// ── pip 의존성 설치 ───────────────────────────────────
const DEPS_STAMP = path.join(os.homedir(), '.agentforge', '.deps_ok');

function installDeps(py) {
  // 이미 설치 확인이 된 경우 스킵 (stamp 파일 기준)
  if (fs.existsSync(DEPS_STAMP)) return;

  const missing = DEPS.filter(d =>
    spawnSync(py.bin, [...py.extra, '-c', `import ${d.import}`], { encoding: 'utf8' }).status !== 0
  );
  if (missing.length === 0) {
    // stamp 파일 생성 (다음 실행부터 체크 생략)
    try { fs.mkdirSync(path.dirname(DEPS_STAMP), { recursive: true }); } catch (_) {}
    try { fs.writeFileSync(DEPS_STAMP, new Date().toISOString()); } catch (_) {}
    return;
  }

  const names = missing.map(d => d.pip);
  process.stdout.write(`${YELLOW}▶ pip 설치 중: ${names.join(', ')}${R}\n`);

  const base = [py.bin, ...py.extra, '-m', 'pip', 'install', '--quiet', ...names].join(' ');
  try { execSync(base, { stdio: 'inherit' }); }
  catch {
    try { execSync(base + ' --user', { stdio: 'inherit' }); }
    catch {
      console.log(`${YELLOW}⚠  자동 설치 실패 — 수동 실행:${R} pip install ${names.join(' ')}`);
      return;
    }
  }
  console.log(`${GREEN}✓${R} 설치 완료: ${names.join(', ')}`);
  try { fs.writeFileSync(DEPS_STAMP, new Date().toISOString()); } catch (_) {}
}

// ── codex 인증 ────────────────────────────────────────
function doCodexLogin() {
  let codexBin = findCodex();

  if (!codexBin) {
    console.log(`${YELLOW}▶ codex CLI 설치 중...${R}`);
    try {
      execSync('npm install -g @openai/codex', { stdio: 'inherit' });
      codexBin = findCodex();
    } catch {
      console.error(`${RED}✗ codex 설치 실패. 수동으로 실행하세요:${R}`);
      console.error(`   npm install -g @openai/codex`);
      process.exit(1);
    }
  }

  if (!codexBin) {
    console.error(`${RED}✗ codex를 찾을 수 없습니다.${R}`);
    process.exit(1);
  }

  // SSH/헤드리스 환경이면 device-auth 사용
  const isSSH = !process.stdin.isTTY;
  const loginArgs = isSSH ? ['login', '--device-auth'] : ['login'];
  if (isSSH) console.log(`${DIM}SSH 환경 감지 → device auth 사용${R}`);

  console.log(`${CYAN}▶ 브라우저에서 ChatGPT 로그인 화면이 열립니다...${R}`);
  const result = spawnSync(codexBin, loginArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n${RED}✗ 로그인 실패.${R}`);
    console.error(`  SSH 환경이라면: agentforge auth login --device`);
    process.exit(1);
  }
}

// ── 메인 ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // 이미 인증됨 → 바로 실행
  if (isAlreadyAuthed()) {
    return launch(args);
  }

  // CHATGPT_AUTH 환경변수 있으면 바로 실행
  if (process.env.CHATGPT_AUTH) {
    return launch(args);
  }

  // auth 서브커맨드는 셋업 건너뜀
  if (args[0] === 'auth') {
    return launch(args);
  }

  // ── 셋업 마법사 ────────────────────────────────────
  console.log(`\n${BOLD}${CYAN}━━━ AgentForge 초기 설정 ━━━${R}\n`);

  // 1. Python
  console.log(`${BOLD}[ 1/2 ] Python 환경 확인${R}`);
  const py = findPython();
  if (!py) {
    console.error(`\n${RED}✗ Python 3.10+ 을 찾을 수 없습니다.${R}`);
    if (WIN) {
      console.error(`  https://python.org/downloads  (설치 시 "Add to PATH" 체크)`);
    } else {
      console.error(`  sudo apt install python3 python3-pip   # Ubuntu/Debian`);
      console.error(`  brew install python                     # macOS`);
    }
    process.exit(1);
  }
  const verOut = spawnSync(py.bin, [...py.extra, '--version'], { encoding: 'utf8' });
  console.log(`${GREEN}✓${R} ${(verOut.stdout || verOut.stderr).trim()}`);
  installDeps(py);

  // 2. codex 인증
  console.log(`\n${BOLD}[ 2/2 ] ChatGPT 인증${R}`);
  doCodexLogin();

  if (!isAlreadyAuthed()) {
    console.error(`\n${RED}✗ 인증 후 ~/.codex/auth.json 이 생성되지 않았습니다.${R}`);
    process.exit(1);
  }
  console.log(`${GREEN}✓${R} 인증 완료`);

  console.log(`\n${BOLD}${GREEN}✓ 설정 완료! AgentForge를 시작합니다...${R}\n`);
  launch(args);
}

// ── VS Code npm 감지 알림 억제 ────────────────────────────────
function ensureVscodeSettings() {
  try {
    const vscodeDir = path.join(process.cwd(), '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');

    const REQUIRED = {
      'npm.autoDetect': 'off',
      'npm.packageManager': 'npm',
    };
    const EXCLUDE_KEYS = ['**/node_modules', '**/.bun', '**/.npm'];
    const WATCHER_KEYS = ['**/node_modules/**', '**/.bun/**', '**/.npm/**'];

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
    }

    // 이미 모두 설정돼 있으면 건드리지 않음
    const alreadySet = Object.entries(REQUIRED).every(([k, v]) => settings[k] === v);
    if (alreadySet) return;

    Object.assign(settings, REQUIRED);
    // files.exclude / files.watcherExclude 병합
    if (!settings['files.exclude']) settings['files.exclude'] = {};
    if (!settings['files.watcherExclude']) settings['files.watcherExclude'] = {};
    EXCLUDE_KEYS.forEach(k => { settings['files.exclude'][k] = true; });
    WATCHER_KEYS.forEach(k => { settings['files.watcherExclude'][k] = true; });

    if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch (_) {
    // 실패해도 무시 — 핵심 기능 아님
  }
}

function launch(args) {
  const py = findPython();
  if (!py) {
    console.error(`${RED}agentforge: Python 3.10+이 필요합니다.${R}`);
    process.exit(1);
  }

  // VS Code npm 감지 알림 억제 (lock file 충돌 팝업 방지)
  ensureVscodeSettings();

  // 인증 여부와 무관하게 항상 패키지 확인 (첫 설치 시 auth 있어도 패키지 없을 수 있음)
  installDeps(py);

  if (!WIN) {
    try { fs.chmodSync(SCRIPT, 0o755); } catch (_) {}
  }

  const child = spawn(py.bin, [...py.extra, SCRIPT, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('close', code => process.exit(code ?? 0));
  child.on('error', err => {
    console.error(`${RED}agentforge 실행 실패: ${err.message}${R}`);
    process.exit(1);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
