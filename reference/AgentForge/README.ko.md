# AgentForge

> **Worker**와 **Evaluator**, 두 에이전트가 협력하며 목표를 달성하는 멀티에이전트 터미널 CLI

[OpenCode](https://opencode.ai)에서 영감을 받아 제작된 AgentForge는 AI 코딩 CLI(현재 `codex`, 향후 Claude·Gemini 지원 예정)를 감싸 실행 에이전트와 평가 에이전트가 반복 협력하는 루프를 구현합니다.

[English README](./README.md)

---

## 화면 구성

```
┌─ ⚙ WORKER AGENT ──────────────────────┬─ ◈ EVALUATOR AGENT ────────────────────┐
│                                        │                                         │
│ > Reading App.tsx...                   │ [반복 1]                                │
│ > Writing dark_mode.css...             │ IMPROVE:                                │
│ > Modifying index.html...              │ 토글 버튼이 없음.                         │
│ ▌                                      │ localStorage에 상태 저장 필요.            │
│                                        │                                         │
│ [반복 2]                                │ [반복 2]                                │
│ > Adding ThemeToggle.tsx...            │ ✓ DONE                                  │
│ ✓ Created 2 files                      │ 결과물: ./src/ThemeToggle.tsx            │
│                                        │                                         │
└────────────────────────────────────────┴─────────────────────────────────────────┘
[AgentForge] > /plan 리액트 앱에 다크모드 추가해줘
```

---

## 동작 원리

```
사용자 입력 (목표)
       │
       ▼
 ┌─────────────┐     코드 변경 실행      ┌────────────────┐
 │   Worker    │ ──────────────────►    │   파일 시스템   │
 │   Agent     │   (full-auto sandbox)  └────────────────┘
 └──────┬──────┘
        │ 실행 결과
        ▼
 ┌──────────────────┐
 │   Evaluator      │
 │   Agent          │  (read-only sandbox — 파일 수정 불가)
 └────────┬─────────┘
          │
          ├── DONE      →  한국어 요약 출력 후 다음 명령 대기
          ├── IMPROVE   →  피드백을 Worker에 전달 후 재실행
          └── REDIRECT  →  전략 변경 후 재실행
```

DONE 판정이 나거나 최대 반복 횟수에 도달할 때까지 루프가 계속됩니다.

### DONE 시 출력 예시

```
════════════════ ✓ 완료 — 3번 반복 ════════════════

판단 이유
  목표로 제시된 다크모드가 정상적으로 구현되었습니다.
  토글 버튼이 추가되었고 상태가 localStorage에 저장됩니다.

결과물 위치
  • ./src/ThemeToggle.tsx
  • ./src/App.tsx  (수정됨)

결과 요약
  리액트 컴포넌트 기반 다크모드 구현. 새로고침 후에도 상태 유지.
```

---

## 요구사항

- Python 3.10 이상
- [`codex` CLI](https://github.com/openai/codex) — 설치 및 로그인 완료
- Python 패키지: `rich`, `prompt_toolkit`

---

## 설치

### npm으로 설치 (권장)

```bash
npm install -g agentforge-multi
```

`rich`, `prompt_toolkit` 패키지는 postinstall 스크립트가 자동으로 설치합니다.

### git으로 설치

```bash
git clone https://github.com/<your-username>/AgentForge.git
cd AgentForge
bash install.sh
```

### 수동 설치

```bash
cp agentforge ~/.local/bin/agentforge
chmod +x ~/.local/bin/agentforge
pip install rich prompt_toolkit
```

---

## 사용법

```bash
agentforge                  # 인터랙티브 CLI 실행
agentforge -d /my/project   # 작업 디렉토리 지정
agentforge -n 20            # 최대 반복 횟수 지정 (기본: 5000)
```

### 슬래시 커맨드

| 커맨드 | 설명 |
|--------|------|
| `<목표 입력>` | Worker 에이전트에게 즉시 전달, 루프 시작 |
| `/plan <목표>` | Plan Agent가 계획 수립 → 질의응답 → 확인 → 실행 |
| `/exit` | AgentForge 종료 |

> `/` 를 입력하면 사용 가능한 커맨드가 자동완성으로 표시됩니다 (Claude Code 스타일).

### /plan 흐름

```
[AgentForge] > /plan 안녕을 출력하는 단순 웹 만들어줘

[Plan Agent]
계획:
- index.html 생성
- <h1>안녕</h1> 포함

accept (y/n) > y

▶ Worker + Evaluator 루프를 시작합니다...
```

---

## 옵션

| 플래그 | 기본값 | 설명 |
|--------|--------|------|
| `-d DIR` | `.` | 작업 디렉토리 |
| `-n N` | `5000` | 최대 반복 횟수 |
| `--worker-model M` | config 기본값 | Worker 에이전트 모델 |
| `--eval-model M` | config 기본값 | Evaluator 에이전트 모델 |

---

## 로드맵

- [x] `codex` CLI 백엔드
- [ ] Claude CLI 백엔드
- [ ] Gemini CLI 백엔드
- [ ] 에이전트 커스텀 페르소나 설정
- [ ] 세션 히스토리 내보내기

---

## 프로젝트 구조

```
AgentForge/
├── agentforge      # 메인 실행 스크립트
├── install.sh      # 설치 스크립트
├── README.md       # 영어 README
├── README.ko.md    # 한국어 README (이 파일)
└── .gitignore
```

---


## 구현 기능 전체 정리

AgentForge에 현재 구현된 기능을 빠짐없이 정리한 문서는 아래를 참고하세요.

- [FEATURES.ko.md](./FEATURES.ko.md) — RAG, research 모드, 세션 재개, 압축, 인증, tmux 흐름 포함 상세 기능 목록

## 참고

- [OpenCode](https://opencode.ai) — 영감의 출처, 터미널 퍼스트 AI 코딩 에이전트
- [Codex CLI](https://github.com/openai/codex) — 현재 기반 엔진

---

## 라이선스

MIT
