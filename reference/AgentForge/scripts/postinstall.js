#!/usr/bin/env node
/**
 * AgentForge postinstall — 가볍게만 확인, 절대 실패하지 않음
 * 실제 설정은 첫 실행 시 setup wizard가 처리함
 */
'use strict';
const { spawnSync } = require('child_process');
const os = require('os');

const RESET  = '\x1b[0m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';

console.log(`\n${BOLD}${CYAN}AgentForge 설치 중...${RESET}`);

// Python 존재 여부만 간단히 확인 (버전 무관)
const isWindows = os.platform() === 'win32';
const candidates = isWindows ? ['py', 'python', 'python3'] : ['python3', 'python'];
const hasPython = candidates.some(bin => {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  return r.status === 0;
});

if (hasPython) {
  console.log(`${GREEN}✓${RESET} Python 감지됨`);
} else {
  console.log(`${YELLOW}⚠  Python을 찾지 못했습니다.${RESET}`);
  console.log(`   첫 실행 시 설치 안내를 제공합니다.`);
}

console.log(`\n${GREEN}${BOLD}✓ 설치 완료!${RESET}`);
console.log(`\n  ${CYAN}agentforge${RESET}  를 실행하면 초기 설정을 시작합니다.\n`);
// 절대 process.exit(1) 하지 않음 — 설정은 첫 실행 시 처리
