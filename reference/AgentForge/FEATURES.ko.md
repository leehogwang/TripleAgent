# AgentForge 기능 정리

이 문서는 현재 저장소 기준으로 AgentForge에 구현된 기능을 **빠짐없이** 정리한 목록입니다.

## 1. 핵심 실행 구조

- **멀티 에이전트 루프**
  - Worker가 실제 작업을 수행하고,
  - Evaluator가 결과를 검토하며,
  - `DONE / IMPROVE / REDIRECT` 판정으로 다음 행동을 결정합니다.
- **반복 실행 구조**
  - 목표가 완료될 때까지 반복합니다.
  - 최대 반복 횟수에 도달하면 종료합니다.
- **역할 분리 프롬프트**
  - Worker는 “실제 변경 수행” 중심.
  - Evaluator는 “파일 수정 없이 평가” 중심.
- **모드 기반 실행**
  - `code` 모드: 코드 수정 중심.
  - `research` 모드: 검색·분석·정리 중심.

## 2. 모델 및 백엔드

- **ChatGPT Codex Responses API 직접 사용**
  - 스트리밍 SSE 이벤트를 직접 처리합니다.
- **모델 분리 설정**
  - Worker 모델과 Evaluator 모델을 따로 지정할 수 있습니다.
  - 기본 모델:
    - Worker: `gpt-5.4`
    - Evaluator: `gpt-5.1-codex-mini`
- **HTTP 세션 재사용**
  - `requests.Session()`으로 연결 재사용 최적화가 들어가 있습니다.
- **인증 헤더 캐싱**
  - `~/.codex/auth.json`의 mtime 기반 캐싱으로 인증 파일 재읽기를 줄입니다.

## 3. Worker 도구 실행 기능

AgentForge의 Worker는 아래 도구를 함수 호출 방식으로 사용합니다.

### 기본 도구
- **`shell`**
  - 셸 명령 실행
  - timeout 지정 가능
  - 최대 7200초 제한
  - stdout/stderr 수집
  - 종료 코드 포함 가능
- **`read_file`**
  - 파일 전체 읽기
- **`write_file`**
  - 파일 생성/덮어쓰기
  - 상위 디렉토리 자동 생성
- **`list_files`**
  - 디렉토리 파일/폴더 목록 조회

### 연구 모드 추가 도구
- **`web_search`**
  - 웹 검색 수행
  - `BRAVE_API_KEY`가 있으면 Brave Search 사용
  - 없으면 DuckDuckGo HTML 검색 사용
- **`fetch_url`**
  - URL 내용을 가져와 텍스트를 추출

## 4. 도구 실행 방식의 특징

- **병렬 도구 실행**
  - 같은 라운드의 여러 function call을 `ThreadPoolExecutor`로 병렬 처리합니다.
- **호출 순서 보존**
  - 병렬 실행 후에도 `call_id` 순서대로 히스토리에 반영합니다.
- **도구 출력 축약 표시**
  - TUI에는 도구 호출 요약과 결과 일부만 보여줍니다.
- **상대/절대 경로 모두 지원**
  - 상대 경로는 작업 디렉토리 기준으로 해석합니다.

## 5. Research 모드 기능

- **연구 전용 Worker 시스템 프롬프트**
  - 검색, 자료 수집, 분석, 노트 정리를 강제합니다.
- **연구 전용 Evaluator 시스템 프롬프트**
  - 충분한 출처 확보
  - 내용 분석 여부
  - 결과 파일 작성 여부를 기준으로 평가합니다.
- **파일 기반 리서치 정리**
  - `read_file`/`write_file`를 사용해 구조화된 노트를 남기게 설계돼 있습니다.
- **웹 검색 + URL 본문 수집 결합**
  - 단순 검색뿐 아니라 페이지 내용을 읽고 종합하도록 구현돼 있습니다.

## 6. RAG / 지식 저장소 기능

이 프로젝트에는 사용자가 언급한 **RAG 성격의 기능**이 실제로 구현돼 있습니다.

- **영구 지식 저장소 경로**
  - `~/.agentforge/knowledge/<goal-slug>/`
- **목표별 저장 구조**
  - 목표 문자열을 slug로 변환해 별도 폴더를 만듭니다.
- **과거 시도 저장**
  - 각 반복의 결과를 `attempts.jsonl`에 append 저장합니다.
- **저장 항목**
  - timestamp
  - iter
  - decision
  - feedback
  - worker_summary
  - goal
- **과거 시도 로드**
  - 다음 세션에서 동일/유사 목표에 대한 과거 시도를 다시 읽습니다.
- **BM25 기반 검색**
  - `rank_bm25`가 있으면 BM25로 관련 시도를 검색합니다.
- **폴백 검색**
  - BM25가 없으면 단어 overlap 기반 점수로 검색합니다.
- **RAG 섹션 자동 삽입**
  - Worker 프롬프트에
    - 이전에 무엇을 시도했고
    - 왜 실패/성공했는지
    - 무엇을 반복하지 말아야 하는지
    를 자동 삽입합니다.
- **실시간 현재 세션 반영**
  - 현재 실행 중 생성된 attempt도 `past_attempts`에 바로 append되어 다음 iteration부터 참조 가능합니다.

즉, 완전한 벡터DB 기반 시스템은 아니지만, **목표별 시도 기록 저장 + 검색 + 프롬프트 주입**이라는 실용적인 RAG 메모리 구조가 들어 있습니다.

## 7. 히스토리 압축 기능

- **프롬프트 길이 추정**
  - `tiktoken`이 있으면 정확 추정
  - 없으면 문자 수 기반 근사 추정
- **토큰 임계치 기반 압축**
  - 추정 토큰이 `100_000`을 넘으면 압축을 시도합니다.
- **LLM 기반 요약 압축기**
  - 오래된 iteration들을 요약해 compressed summary entry로 바꿉니다.
- **압축 시 보존 원칙**
  - 시도한 접근
  - 실패/승인 이유
  - 현재 상태
  - 파일 경로/기술 세부사항
  을 유지하도록 프롬프트 설계돼 있습니다.
- **최근 히스토리 유지**
  - 최근 4개 iteration은 상세 상태로 그대로 유지합니다.
- **기존 압축 요약 재압축 연결**
  - 이전 compressed summary가 있으면 새 요약과 결합합니다.
- **백그라운드 압축**
  - 압축은 백그라운드 스레드에서 진행되어 메인 루프를 덜 막습니다.

## 8. 세션 영속화 / 재개 기능

- **마지막 세션 자동 저장**
  - `~/.agentforge/last_session.json`에 저장됩니다.
- **저장 내용**
  - goal
  - history
  - eval_history
  - workdir
  - saved_at
- **디스플레이 전용 데이터 정리 저장**
  - `worker_lines`는 저장 시 제외하고, 로드 시 기본값 복원합니다.
- **프로세스 시작 시 자동 복원**
  - 이전 세션이 있으면 자동으로 읽고 안내 메시지를 띄웁니다.
- **`/resume` 명령 지원**
  - 마지막 세션의 목표·반복 수·저장 시점·마지막 판정을 보여준 뒤 이어서 실행합니다.
- **중단 시에도 세션 보존**
  - ESC로 중단된 경우에도 세션을 저장합니다.

## 9. 인터럽트 / 중단 제어

- **ESC 즉시 중단 감지**
  - `/dev/tty`를 직접 읽는 별도 스레드로 ESC를 감지합니다.
- **현재 스트리밍 HTTP 응답 즉시 종료**
  - 중단 시 active response를 닫습니다.
- **Worker 루프 중단 플래그 공유**
  - `_interrupt_event`로 Worker/Evaluator 처리 흐름을 중단합니다.
- **중단 후 목표 수정 재실행**
  - `_handle_interrupt()` 로직이 구현되어 있으며,
  - 중단 후 목표를 수정해서 다시 실행할 수 있는 흐름이 있습니다.
  - 다만 현재 메인 REPL에서는 인터럽트 시 “REPL로 돌아감” 중심으로 사용되고 있습니다.

## 10. Evaluator 판정 체계

- **엄격한 첫 줄 규칙**
  - 첫 줄은 `DONE`, `IMPROVE: ...`, `REDIRECT: ...` 중 하나여야 합니다.
- **DONE 시 한국어 요약 포맷 강제**
  - 판단 이유
  - 결과물 위치
  - 결과 요약
- **IMPROVE / REDIRECT 한국어 피드백 유도**
- **결정 파싱 기능**
  - 정규식 기반으로 판정을 파싱합니다.
- **보조 파싱 폴백**
  - `goal achieved`, `all done` 같은 문구가 있으면 DONE으로 간주하는 폴백이 있습니다.
- **Evaluator 조기 종료 최적화**
  - `IMPROVE` 또는 `REDIRECT`가 첫 줄에서 확정되면 스트리밍을 조기 종료합니다.
  - `DONE`은 전체 한국어 요약이 필요하므로 끝까지 읽습니다.
- **평가 주기 조절**
  - `--eval-every N`
  - `/eval-every N`
  - 로 N회마다만 Evaluator를 실행할 수 있습니다.
  - 평가를 건너뛸 때는 `IMPROVE: (evaluation skipped)`로 기록합니다.

## 11. 프롬프트 구성 기능

- **Worker 프롬프트 동적 구성**
  - 목표
  - 이전 iteration history
  - evaluator 피드백
  - compressed summary
  - RAG 결과
  를 합쳐 구성합니다.
- **직전 판정에 따른 지시 변경**
  - `IMPROVE`면 기존 작업을 다듬으라고 지시
  - `REDIRECT`면 기존 접근을 버리고 새 방식으로 하라고 지시
- **Evaluator 프롬프트 구성**
  - 원래 목표
  - 현재 iteration 번호
  - Worker 출력 일부
  를 포함합니다.

## 12. TUI / 출력 UX

- **Rich 기반 2패널 레이아웃**
  - 좌측 Worker
  - 우측 Evaluator
- **헤더 상태 표시**
  - idle / worker / evaluator / done 상태를 렌더링합니다.
- **라이브 업데이트**
  - `Live`로 반복 중 실시간 갱신합니다.
- **Worker 로그 버퍼 관리**
  - 최근 60줄 유지
- **출력 색상화**
  - 주석, 에러, 성공, 파일 작업, 코드 키워드, 문자열 등을 문맥별로 색칠합니다.
- **ANSI 제거**
  - ANSI escape sequence 제거 유틸리티가 있습니다.
- **완료 시 구조화 출력**
  - DONE이면 구분선과 함께 한국어 완료 요약을 섹션별로 출력합니다.

## 13. REPL / 입력 UX

- **인터랙티브 REPL**
  - 일반 텍스트를 입력하면 즉시 목표로 실행합니다.
- **슬래시 커맨드 체계**
  - `/resume`
  - `/exit`
  - `/mode code`
  - `/mode research`
  - `/eval-every <N>`
  - `/dir <path>`
  - `/status`
  - `/help`
- **prompt_toolkit 기반 입력**
  - 입력 프롬프트 스타일링
  - 자동완성 지원
- **슬래시 커맨드 자동완성**
  - 커맨드명과 설명 메타를 보여줍니다.
- **`/dir` 경로 자동완성**
  - 디렉토리명 자동완성 지원
- **현재 상태 출력**
  - `/status`로 mode / eval-every / dir 확인 가능
- **작업 디렉토리 실시간 변경**
  - `/dir <path>`로 현재 세션 작업 디렉토리를 바꿀 수 있습니다.

## 14. 인증 기능

- **`auth` 서브커맨드 제공**
  - `agentforge auth login`
  - `agentforge auth login --device`
  - `agentforge auth logout`
  - `agentforge auth status`
- **Codex CLI 연동 인증**
  - `~/.npm-global/bin/codex` 경로의 CLI를 사용합니다.
- **SSH/헤드리스 대응 device auth**
  - `--device` 로그인 지원
- **초기 실행 시 로그인 유도**
  - 토큰이 없으면 지금 로그인할지 묻습니다.
- **인증 상태 패널 출력**
  - 로그인 여부, 방식, 계정, 갱신 시각 표시

## 15. tmux 연동

코드상으로 tmux 관련 헬퍼가 구현돼 있습니다.

- **tmux 내부 실행 감지**
- **기존 tmux 세션 존재 여부 확인**
- **tmux 세션 자동 실행/재접속용 헬퍼**
- **`-r` / `--reconnect` 지원**
- **`--new-session` 지원**

즉, tmux 세션 기반으로 AgentForge를 감싸 실행하려는 기능이 포함돼 있습니다.

## 16. CLI 옵션

- `-d`, `--dir`: 작업 디렉토리 지정
- `--worker-model`: Worker 모델 지정
- `--eval-model`: Evaluator 모델 지정
- `-n`, `--max-iterations`: 최대 반복 횟수 지정
- `--mode code|research`: 실행 모드 지정
- `--eval-every N`: Evaluator 실행 주기 지정
- `-r`, `--reconnect`: tmux 재접속
- `--new-session`: 새 tmux 세션 강제 시작

## 17. 설치 / 배포 관련 구현

- **단일 실행 스크립트 구조**
  - 메인 실행 파일이 `agentforge`입니다.
- **npm 글로벌 설치 지원**
  - `package.json`의 `bin`으로 `agentforge` 명령을 등록합니다.
- **postinstall 스크립트 존재**
  - 설치 후 의존성 설치를 수행하는 구조입니다.
- **README 한/영문 제공**
  - `README.md`
  - `README.ko.md`

## 18. 실제 구현되어 있지만 README에 잘 안 드러나는 포인트

아래는 특히 문서화할 때 놓치기 쉬운 기능입니다.

- Worker/Evaluator **모델 분리**
- **research 모드** 존재
- **웹 검색**과 **URL 본문 가져오기**
- **RAG형 지식 저장소**
- **BM25 검색 기반 과거 시도 재활용**
- **프롬프트 자동 압축**
- **백그라운드 압축 스레드**
- **세션 자동 저장/복원**
- **/resume**
- **ESC 즉시 중단**
- **Evaluator 조기 종료 최적화**
- **병렬 function/tool 실행**
- **평가 주기 조절 (`eval_every`)**
- **`/dir` 자동완성**
- **auth 서브커맨드**
- **tmux 재접속/새 세션 흐름**

## 19. 현재 README와 다른 실제 상태

현재 코드 기준으로 보면 README에 적힌 내용보다 기능이 더 많습니다.

대표적으로 README에는 아직 충분히 반영되지 않은 실제 구현 기능이 있습니다.

- `/plan`은 README에 있지만, 현재 코드의 슬래시 커맨드 목록/REPL 처리에는 없습니다.
- 대신 실제로는 다음이 구현돼 있습니다.
  - `/resume`
  - `/mode code|research`
  - `/eval-every`
  - `/dir`
  - `/status`
  - 인증 서브커맨드
  - RAG 메모리
  - research 모드
  - 세션 복원
  - 히스토리 압축
  - tmux 흐름

## 20. 한 줄 요약

AgentForge는 단순한 “코딩 에이전트 CLI”가 아니라,

**Worker + Evaluator 반복 루프, 연구 모드, 웹 검색, RAG형 지식 저장소, 히스토리 압축, 세션 재개, 인증/REPL/TUI/tmux UX까지 포함한 멀티에이전트 실행 프레임워크**입니다.
