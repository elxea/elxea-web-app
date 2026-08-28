#!/usr/bin/env node
// =============================================================================
// check-no-dead-functions-lib.mjs — `functions/lib/` を二度と復活させない
//
// 問題:
//   `functions/lib/` には Cloud Functions のコンパイル済み JavaScript
//   (index.js / batch/syncPersona.js / webhooks/shopifyOrders.js と各 .map) が
//   コミットされていた。**対応する TypeScript の出所は無い**。functions/src に
//   あるのは index.ts と config/persona-keywords.json だけで、index.ts が
//   export している `./webhooks/shopifyOrders` も `./batch/syncPersona` も
//   ソースごと存在しない。つまり lib/ は「再生成できないビルド生成物」だった。
//
//   デプロイ経路も無い。firebase.json には firestore と emulators しか無く
//   functions セクションが無い。scripts/deploy-staging.sh も
//   `functions/package.json` の有無で分岐していて、それも無いので必ずスキップ
//   される。どこからも動かないコードが、リポジトリの中で**動いているように
//   見える状態**で置かれ続けていた。
//
//   これが厄介なのは「消えた機能を探した人が最初に読む場所」になることにある。
//   shopifyOrders.js には persona 加算の実装が丸ごと残っているので、注文の
//   ペルソナ計算を追った人はここに辿り着き、**現役の実装だと誤読する**。
//   実際の受け口は app/api/webhooks/orders/route.ts で、ペルソナの書き手は
//   cx-agent 側 (preference-pipeline) に一本化されている。古い死骸は仕様の
//   誤読を生む方向にしか働かない。
//
// 処方:
//   ディレクトリごと消したうえで、**再流入をここで止める**。消すだけだと、
//   誰かが手元で `tsc` を回した拍子に生成物が戻り、.gitignore にも無いので
//   そのままコミットされる。憲章 R8 の「全件移行 + 再流入止めで 1 セット」。
//
// 使い方:
//   node scripts/ops/check-no-dead-functions-lib.mjs   … あれば exit 1
//
// CI:
//   static-checks ジョブに相乗りさせる (新規ジョブは作らない)。
//
// もし将来 Cloud Functions を本当に復活させるなら:
//   復活させるのは `functions/src/**` の TypeScript と firebase.json の
//   functions セクションであって、コンパイル済みの lib/ ではない。生成物は
//   .gitignore に入れ、この検査は残す。
// =============================================================================

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const FORBIDDEN_DIR = join(ROOT, 'functions', 'lib');

/** 何が入っているかまで出す (「ある」だけだと消し方が分からないため)。 */
function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

function main() {
  if (!existsSync(FORBIDDEN_DIR)) {
    console.log('[check-no-dead-functions-lib] OK — functions/lib/ はありません');
    return;
  }

  const files = listFiles(FORBIDDEN_DIR).sort();

  console.error(
    '\n[check-no-dead-functions-lib] FAIL — functions/lib/ が復活しています\n',
  );
  for (const f of files) console.error(`  ${f}`);
  console.error(
    '\n  functions/lib/ は「出所の TypeScript が無く、デプロイ経路も無い」' +
      'コンパイル済み生成物です。\n' +
      '  置いておくと、消えた機能を追う人がここを現役の実装だと誤読します' +
      ' (注文のペルソナ計算で実際に起きた)。\n\n' +
      '  → ビルドで出てしまったなら削除してください:  rm -rf functions/lib\n' +
      '  → Cloud Functions を本当に復活させるなら、戻すのは functions/src/**' +
      ' の TypeScript と\n' +
      '    firebase.json の functions セクションです。生成物は .gitignore に' +
      '入れ、この検査は残してください。\n',
  );
  process.exit(1);
}

main();
