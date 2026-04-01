#!/usr/bin/env bash
# AgentForge 설치 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"

echo "▶ AgentForge 설치 중..."

# 설치 디렉토리 생성
mkdir -p "$INSTALL_DIR"

# Python 의존성 확인
echo "▶ 의존성 확인 중..."
python3 -c "import rich" 2>/dev/null || pip install rich --quiet
python3 -c "import prompt_toolkit" 2>/dev/null || pip install prompt_toolkit --quiet

# codex 바이너리 확인
if ! command -v codex &>/dev/null; then
    echo "⚠  codex CLI가 설치되어 있지 않습니다."
    echo "   https://github.com/openai/codex 에서 설치 후 재시도하세요."
    exit 1
fi

# 스크립트 복사 및 실행 권한 부여
cp "$SCRIPT_DIR/agentforge" "$INSTALL_DIR/agentforge"
chmod +x "$INSTALL_DIR/agentforge"

# PATH 확인
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "⚠  $INSTALL_DIR 가 PATH에 없습니다."
    echo "   아래 줄을 ~/.bashrc 또는 ~/.zshrc에 추가하세요:"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
else
    echo "✓ 설치 완료: $INSTALL_DIR/agentforge"
    echo ""
    echo "사용법:"
    echo "  agentforge              # 인터랙티브 실행"
    echo "  agentforge -d /project  # 작업 디렉토리 지정"
fi
