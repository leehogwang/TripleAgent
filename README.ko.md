# TripleAgent

[English README](./README.md)

TripleAgent는 `Codex`, `Claude`, `Gemini`를 한 터미널 안에서 나란히 실행하는 3패널 코딩 CLI입니다.

현재 런타임은 Claude 스타일 하네스를 중심으로 구성되어 있습니다.

- `Claude` 패널은 vendored `claw-dev` compiled CLI를 직접 사용합니다
- `Codex`, `Gemini`는 같은 셸 계약 안에 병렬 패널로 올라갑니다
- 모든 provider는 API key가 아니라 각자의 native CLI 로그인 세션을 사용합니다
- 기본 작업 흐름은 worktree를 먼저 만들고, 이후 `/pick` 또는 `/fuse`로 결과를 선택하거나 합치는 방식입니다

## 핵심 기능

- 하나의 질문을 `Codex`, `Claude`, `Gemini`에 동시에 전송
- 패널별 독립 transcript 유지
- 형제 git worktree 자동 생성:
  - `../codex1`
  - `../claude1`
  - `../gemini1`
- 각 패널의 결과를 diff bundle로 캡처
- `/pick`으로 하나의 결과 선택
- `/fuse`로 여러 결과를 다시 융합
- 인증 실패나 quota 소진 시 패널 비활성화
- `Esc` 두 번으로 모든 실행 중 agent 중단

## CLI UX

UI는 사각 박스로 닫지 않고, 흐린 세로 분리선만 두는 형태입니다. 공용 입력창은 하단에 있습니다.

```text
TripleAgent
Claude harness shell · Ready panels: 3/3 · Mode: PLAN · CWD: /repo
Press Esc again to stop all running agents.

Codex · running · plan      │ Claude · ready · plan       │ Gemini · locked · plan
codex> inspect src/app.ts   │ claude> /init               │ gemini> panel disabled
[10:21:14] user             │ [10:21:06] system           │ [10:20:41] system
Implement the parser...     │ Initialized on /repo/...    │ Authentication required.
[10:21:19] assistant        │ [10:21:11] assistant        │ Limited: /status /login /logout
I found two edge cases...   │ Ready for scoped work.      │
                            │                              │

shared> build the feature and add tests

Tab focus · Shift+Up/Down scroll active panel · Shared: /help /status /plan /init /clear /resume /pick /fuse · Esc Esc stops all
```

## 입력 구조

TripleAgent는 두 종류의 입력창을 가집니다.

### Shared Composer

하단의 공용 입력창입니다.

- 일반 텍스트는 준비된 패널 전체에 broadcast 됩니다
- orchestration 명령은 여기서 처리됩니다
- 잠긴 패널은 자동으로 제외됩니다

지원 명령:

- `/help`
- `/status`
- `/plan`
- `/init`
- `/clear`
- `/resume`
- `/pick <codex|claude|gemini>`
- `/fuse`
- `/login`
- `/logout`
- `/exit`

### Panel Composer

각 패널 상단의 개별 입력창입니다.

- 해당 패널에만 질문을 보냅니다
- broadcast 없이 특정 provider만 따로 확인할 수 있습니다
- Claude 패널에서는 provider-local slash command를 사용할 수 있습니다
- 잠긴 패널은 입력을 받지 않습니다

## 키 조작

- `Tab`: `Codex`, `Claude`, `Gemini`, `shared` 사이 포커스 이동
- `Shift+Tab`: 반대 방향 이동
- `Shift+Up` / `Shift+Down`: 현재 활성 패널 transcript 스크롤
- `Esc` 두 번을 600ms 안에 입력: 모든 실행 중 agent 중단
- `Ctrl+C`: 실행 중이면 중단, idle 상태면 종료

## Worktree 워크플로

Git 저장소 안에서 TripleAgent를 실행하면 worktree를 자동으로 준비합니다.

- `codex` 패널은 `../codex1`
- `claude` 패널은 `../claude1`
- `gemini` 패널은 `../gemini1`

브랜치는 다음 이름으로 생성 또는 재사용됩니다.

- `tripleagent/codex1`
- `tripleagent/claude1`
- `tripleagent/gemini1`

Git 저장소 밖에서 실행하면:

- 셸 자체는 실행됩니다
- provider 응답도 받을 수 있습니다
- 하지만 `/pick`, `/fuse` 같은 worktree 기반 기능은 비활성화됩니다

## Pick 과 Fuse

### `/pick`

특정 provider의 최신 diff bundle 하나를 선택해서 메인 작업 트리에 `git apply --3way`로 반영합니다.

예시:

```text
/pick claude
```

### `/fuse`

`../fusion1` worktree를 만들거나 재사용한 뒤, Codex를 한 번 더 실행해서 여러 provider 결과를 합친 구현을 만듭니다.

예시:

```text
/fuse
```

## 인증과 quota 보호

TripleAgent의 메인 런타임은 API key를 사용하지 않습니다.

기대하는 인증 방식:

- `codex login`
- `claude auth login`
- `gemini` CLI의 OAuth personal auth

패널 상태:

- `ready`: 사용 가능
- `running`: 현재 생성 중
- `locked`: 인증, quota, workspace 문제로 비활성화
- `error`: 실패했지만 영구 잠금은 아님

quota 보호 정책:

- 인증이 없으면 패널을 dim 처리하고 broadcast에서 제외합니다
- quota가 소진된 것으로 보이면 패널을 잠급니다
- Claude는 유료 overage로 넘어가기 전에 잠급니다

인증 상태 확인:

```bash
tripleagent auth status
```

로그인:

```bash
tripleagent auth login claude
tripleagent auth login codex
tripleagent auth login gemini
```

## 설치

### 로컬 개발

```bash
git clone https://github.com/leehogwang/TripleAgent.git
cd TripleAgent
npm run bootstrap:node22
bash scripts/npm22.sh install
```

### 저장소 기준 실행

```bash
npm run triple-agent
```

### 설치형 CLI

```bash
bash install.sh
tripleagent
```

## 검증

타입 체크:

```bash
npm run check
```

빌드:

```bash
npm run build
```

실제 로그인 세션 기반 smoke test:

```bash
npm run dry-run:triple -- --cwd /path/to/TripleAgent
```

dry run은 다음을 확인합니다.

- auth preflight
- worktree preflight
- `Codex` 실제 응답 1회
- `Claude` 실제 응답 1회
- `Gemini` 실제 응답 1회

## 저장소 구조

- `src/index.ts`
  - CLI 진입점, auth 서브커맨드, dry run
- `src/tripleagent/app.tsx`
  - TripleAgent Ink shell
- `src/tripleagent/providers.ts`
  - provider 실행과 인터럽트
- `src/tripleagent/worktree.ts`
  - git worktree 준비, diff 캡처, bundle 적용
- `src/tripleagent/auth.ts`
  - native auth 상태 확인과 login/logout helper
- `src/tripleagent/commands.ts`
  - shared command 파싱과 도움말
- `scripts/`
  - Node 22 bootstrap helper
- `bin/tripleagent.js`
  - 설치형 CLI launcher
- `Leonxlnx-claude-code/`
  - vendored `claw-dev` 소스와 compiled CLI
- `reference/AgentForge/`
  - 패널 구조와 워크플로 참고용 복사본

## 참고

- 원본 하네스 기준점에 가장 가까운 것은 `Claude` 패널입니다
- `Codex`, `Gemini`도 같은 셸 UX에 맞춰 올라가지만, 내부 실행은 각자의 native CLI를 사용합니다
- 이 셸은 단순 채팅보다 저장소 작업에 맞춰 설계되어 있습니다
- 자동 생성되는 worktree는 저장소 루트 밖에 생기며, 일반 커밋 대상에 포함되지 않습니다
