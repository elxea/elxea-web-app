#!/usr/bin/env node
// =============================================================================
// check-test-floor.mjs — P5: 検査の空回り (0件成功 / 検証停止) の監視
//
// 目的:
//   テストが 0 件でも "成功(green)" と表示されうる。AI エージェントは空振りを
//   自分から申告しないため、外から「実際に実行したテスト件数が下限以上か」を
//   検証する。下限割れは CI を失敗させる (真の機械強制)。
//
//   これは今回事故の "検証停止" を正面から塞ぐ。required checks が green でも、
//   その green が「実質 0 件」なら意味がない。
//
// 使い方:
//   node scripts/ops/check-test-floor.mjs --file test-results/junit.xml --min 150 --label unit
//
// 判定:
//   実行件数 (executed = tests - skipped) を JUnit XML から読み、min 未満なら exit 1。
//   ファイル不在 / パース不能もそれ自体が "空回り" の兆候として exit 1。
//
// JUnit の読み方:
//   1) <testsuites>/<testsuite> の tests= / skipped= / disabled= 属性を合算 (優先)。
//   2) 属性が無ければ <testcase> 要素数 - <skipped> 要素数 で数える (fallback)。
//   vitest / playwright いずれの JUnit 出力でも動く。
// =============================================================================

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const getOpt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const file = getOpt('--file', null);
const min = Number(getOpt('--min', '1'));
const label = getOpt('--label', file || 'tests');

if (!file) {
  console.error('usage: check-test-floor.mjs --file <junit.xml> --min <n> [--label <name>]');
  process.exit(2);
}

let xml;
try {
  xml = readFileSync(file, 'utf8');
} catch (e) {
  console.error(
    `::error title=Test floor (${label})::JUnit ファイルを読めませんでした (${file})。` +
      `テストが 1 件も走っていない / レポータ未設定の疑い。`
  );
  process.exit(1);
}

function sumAttr(attr) {
  // <testsuite ... attr="N" ...> を全て合算。testsuites 集約行との二重計上を避けるため
  // testsuite 要素のみを対象にする。
  const re = new RegExp(`<testsuite\\b[^>]*\\b${attr}="(\\d+)"`, 'g');
  let m;
  let sum = 0;
  let found = false;
  while ((m = re.exec(xml)) !== null) {
    sum += Number(m[1]);
    found = true;
  }
  return found ? sum : null;
}

let executed;
let detail;
const tests = sumAttr('tests');
if (tests != null) {
  const skipped = sumAttr('skipped') || 0;
  const disabled = sumAttr('disabled') || 0;
  executed = tests - skipped - disabled;
  detail = `tests=${tests} skipped=${skipped} disabled=${disabled} -> executed=${executed}`;
} else {
  // fallback: 要素カウント
  const tc = (xml.match(/<testcase\b/g) || []).length;
  const sk = (xml.match(/<skipped\b/g) || []).length;
  executed = tc - sk;
  detail = `testcase=${tc} skipped=${sk} -> executed=${executed}`;
}

console.log(`[test-floor:${label}] ${detail} (min=${min})`);

if (!Number.isFinite(executed) || executed < min) {
  console.error(
    `::error title=Test floor (${label})::実行テスト件数 ${executed} が下限 ${min} を下回りました。` +
      `検査が空回りしている (0件成功 / テスト未実行 / フィルタ過多) 疑い。CI を失敗させます。`
  );
  process.exit(1);
}

console.log(`[test-floor:${label}] OK (${executed} >= ${min})`);
