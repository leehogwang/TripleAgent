#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"

echo "▶ TripleAgent 설치 중..."

mkdir -p "$INSTALL_DIR"

chmod +x "$SCRIPT_DIR/scripts/ensure-node22.sh" \
         "$SCRIPT_DIR/scripts/node22.sh" \
         "$SCRIPT_DIR/scripts/npm22.sh" \
         "$SCRIPT_DIR/bin/tripleagent.js"

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "▶ 의존성 설치 중..."
  bash "$SCRIPT_DIR/scripts/npm22.sh" install
fi

cat > "$INSTALL_DIR/tripleagent" <<EOF
#!/usr/bin/env bash
exec "$SCRIPT_DIR/bin/tripleagent.js" "\$@"
EOF
chmod +x "$INSTALL_DIR/tripleagent"

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "⚠  $INSTALL_DIR 가 PATH에 없습니다."
  echo "   아래 줄을 ~/.bashrc 또는 ~/.zshrc에 추가하세요:"
  echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
else
  echo "✓ 설치 완료: $INSTALL_DIR/tripleagent"
  echo ""
  echo "사용법:"
  echo "  tripleagent                 # 인터랙티브 실행"
  echo "  tripleagent auth status     # 인증 상태 확인"
  echo "  tripleagent dry-run         # 3-provider 실제 smoke test"
fi
