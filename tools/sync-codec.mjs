// 코덱 동기화 — 본체 소스를 이 저장소로 복사하고 일치를 강제한다
//
// 왜 복사하는가
//   이 저장소의 루트는 "02_데모 웹" 이다. 본체 소스(01_혼합진법 주소/src)는
//   저장소 밖이므로 배포 환경에는 존재하지 않는다. 그래서 복사본을 커밋한다.
//
// 왜 표류하지 않는가
//   복사할 때마다 sha256 을 MANIFEST.json 에 기록한다.
//   원본이 있는 환경(로컬)에서는 원본과 비교한다.
//   원본이 없는 환경(배포)에서는 복사본이 기록과 같은지 검사한다.
//   복사본을 손으로 고치면 검사가 실패한다.
//
// 위키의 scripts/sync-codec.mjs 와 같은 방식이다. 다른 점 하나.
//   타임스탬프를 기록하지 않는다. 위키에서는 MANIFEST 가 실행마다 바뀌어
//   커밋을 더럽혔다. 여기서는 내용이 같으면 파일도 같다.
//
// 사용법
//   node tools/sync-codec.mjs            복사하고 기록을 갱신한다
//   node tools/sync-codec.mjs --verify   복사만 확인한다. 다르면 실패

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const appRoot = resolve(here, '..');
const groupRoot = resolve(appRoot, '..');

/** 본체 코덱 소스. 저장소 밖이므로 배포 환경에는 없다. */
const SOURCE_DIR = join(groupRoot, '01_혼합진법 주소', 'src');

/** 이 저장소 안의 복사본. 커밋한다. */
const VENDOR_DIR = join(appRoot, 'src', 'vendor', 'codec');

const MANIFEST = join(VENDOR_DIR, 'MANIFEST.json');

const verifyOnly = process.argv.includes('--verify');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function listModules(dir) {
  return readdirSync(dir)
    .filter(name => name.endsWith('.mjs'))
    .sort();
}

function readManifest() {
  if (!existsSync(MANIFEST)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

function hashVendorFiles() {
  if (!existsSync(VENDOR_DIR)) return {};
  const out = {};
  for (const name of listModules(VENDOR_DIR)) {
    out[name] = sha256(readFileSync(join(VENDOR_DIR, name)));
  }
  return out;
}

function fail(message, hint) {
  console.error(`\n[코덱 동기화 실패] ${message}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}

// ── 원본이 없는 환경 (배포) ──────────────────────────────────────────────

if (!existsSync(SOURCE_DIR)) {
  const manifest = readManifest();
  if (!manifest) {
    fail(
      '본체 소스도 없고 복사본 기록도 없다.',
      'src/vendor/codec 이 커밋되어 있는지 확인하라.',
    );
  }

  const actual = hashVendorFiles();
  const expected = manifest.files ?? {};

  for (const [name, hash] of Object.entries(expected)) {
    if (!(name in actual)) fail(`복사본에 ${name} 이(가) 없다.`, '커밋 누락일 수 있다.');
    if (actual[name] !== hash) {
      fail(
        `복사본 ${name} 이(가) 기록과 다르다.`,
        '복사본을 직접 고치면 안 된다. 본체를 고치고 다시 동기화하라.',
      );
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) fail(`기록에 없는 파일 ${name} 이(가) 복사본에 있다.`, '동기화를 다시 실행하라.');
  }

  console.log(`코덱 복사본 확인 완료 (${Object.keys(expected).length}개, 원본 없는 환경)`);
  process.exit(0);
}

// ── 원본이 있는 환경 (로컬) ──────────────────────────────────────────────

const sourceNames = listModules(SOURCE_DIR);
if (sourceNames.length === 0) fail(`본체 소스에 .mjs 파일이 없다: ${SOURCE_DIR}`);

const sourceHashes = {};
const sourceBuffers = {};
for (const name of sourceNames) {
  const buffer = readFileSync(join(SOURCE_DIR, name));
  sourceBuffers[name] = buffer;
  sourceHashes[name] = sha256(buffer);
}

const vendorHashes = hashVendorFiles();

const changed = sourceNames.filter(name => vendorHashes[name] !== sourceHashes[name]);
const removed = Object.keys(vendorHashes).filter(name => !(name in sourceHashes));

if (verifyOnly) {
  if (changed.length || removed.length) {
    const detail = [...changed.map(n => `수정 ${n}`), ...removed.map(n => `삭제 ${n}`)].join(', ');
    fail(`복사본이 본체와 다르다: ${detail}`, 'npm run sync-codec 을 실행하라.');
  }
  console.log(`코덱 복사본이 본체와 일치한다 (${sourceNames.length}개)`);
  process.exit(0);
}

mkdirSync(VENDOR_DIR, { recursive: true });

for (const name of changed) {
  writeFileSync(join(VENDOR_DIR, name), sourceBuffers[name]);
}
for (const name of removed) {
  rmSync(join(VENDOR_DIR, name), { force: true });
}

writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      note: '자동 생성 파일. tools/sync-codec.mjs 가 관리한다. 직접 편집하지 마라.',
      source: '005 - 최종 알고리즘 테스트/01_혼합진법 주소/src',
      files: sourceHashes,
    },
    null,
    2,
  )}\n`,
);

const summary =
  changed.length === 0 && removed.length === 0
    ? '변경 없음'
    : `갱신 ${changed.length}개, 삭제 ${removed.length}개`;
console.log(`코덱 동기화 완료 (${sourceNames.length}개, ${summary})`);
