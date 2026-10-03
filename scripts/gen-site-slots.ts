/**
 * gen-site-slots.ts
 *
 * ページの画像枠の宣言 `public/site-slots.manifest.json` を **コードから作り直し**、
 * そこから `lib/site-slots.generated.ts` (id の union 型) を作る。
 *
 * 枠の集合 (id) の正本はコードの使用箇所 (`scripts/lib/site-slots-scan.ts` が数える
 * SiteImage の slotId と getSiteImage / getSiteAsset の文字列リテラル)。手で書くのは
 * 各枠の属性だけで、作り直しても id で引き継ぐ (#202 の image-slots.inventory.json と
 * 同じ倒し方。段3設計 2節・9節 U1)。
 *
 *   - コードに新しく現れた枠 … 属性が空のまま入る。書くまで検査が落ちる (このスクリプトも
 *     exit 1 で、union 型は作り直さない)。
 *   - コードから消えた枠 … validTo が入っていれば残す (畳む手順)。入っていなければ
 *     書かずに止める (削ると asset-hub 側で割当が孤児になるため。validTo を入れる)。
 *
 * なぜ union の生成が要るか: TypeScript の `resolveJsonModule` は JSON の文字列を `string` に
 * widen するため、JSON import から id のリテラル union 型を引けない。
 *
 *   pnpm generate:site-slots   ... 作り直す (コードの枠を足す・消す・名前を変えたら走らせる)
 *   pnpm check:site-slots      ... 一致検査 (build の前段でも走る)
 *
 * Exit codes: 0 = 生成成功 / 1 = 止めた (消えた枠に validTo が無い・属性が空・宣言が不正)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { IMAGE_SLOTS_FORMAT } from '../lib/image-slots-v2';
import { validateSiteSlotsManifest } from '../lib/site-slots-schema';

import { scanUsages, usedSlotIds } from './lib/site-slots-scan';

/**
 * 宣言とコードを読む根。既定はこのリポジトリ。試験だけが SITE_SLOTS_ROOT で一時の
 * 写し (public/・lib/・app/ だけを持つ) に向け、本物のファイルを書き換えずに守りを壊す。
 */
export const SITE_SLOTS_ROOT = process.env.SITE_SLOTS_ROOT
  ? path.resolve(process.env.SITE_SLOTS_ROOT)
  : path.resolve(__dirname, '..');
const ROOT = SITE_SLOTS_ROOT;
export const MANIFEST_PATH = path.join(ROOT, 'public', 'site-slots.manifest.json');
export const GENERATED_PATH = path.join(ROOT, 'lib', 'site-slots.generated.ts');

/** 宣言の頭の説明。ファイルの中で手で直さず、ここを直して作り直す。 */
export const MANIFEST_COMMENT: readonly string[] = [
    "site-slots.manifest.json — このサイトが持つページの画像枠の宣言 (書き方 image-slots/v2)。",
    "",
    "【枠の集合はコードから作る (2026-10-04 段3 U1)】",
    "どの枠があるか (id の集合) の正本はコード — SiteImage の slotId と、サーバ側で枠を読む",
    "getSiteImage / getSiteAsset の文字列リテラル。pnpm generate:site-slots がコードを読んで",
    "このファイルを作り直す。手で書くのは各枠の属性 (label・area・alt・required・order・",
    "surfaces・validFrom/To) だけで、作り直しても id で引き継がれる。新しい枠は属性が空の",
    "まま入り、書くまで build が落ちる。",
    "asset-hub はこのファイルを URL で読み、載っている枠を『空き枠』として出す。",
    "asset-hub 側に枠定義を書かない (向きは サイトが宣言 → asset-hub が読む)。",
    "",
    "【area と alt】",
    "area は入れた状態の場所 (asset-hub の cdn/intake/<org>/<area>.json・INTAKE_AREAS の元)。",
    "alt は説明文の作り方の名前 (ページの枠は code = SiteImage の alt をコードが持つ)。",
    "決まりは lib/image-slots-v2.ts。届け先の種類の欄は持たない (枠の鍵の頭で決まる)。",
    "",
    "【編集したら必ず】",
    "  pnpm generate:site-slots   ... このファイルと lib/site-slots.generated.ts (id の union 型) を作り直す",
    "  pnpm check:site-slots      ... 宣言とコードの突き合わせ・作り直した物との一致 (build の前段でも走る)",
    "生成物を作り直さないと build が落ちる。落ちること自体がガード。",
    "",
    "【version は「スキーマの版」であって「中身の版」ではない (2026-09-01 訂正)】",
    "枠を足す・消す・比率を変えるだけでは version を上げない。据え置きが正しい。",
    "上げてよいのは『この JSON の書き方そのもの』を変えたとき (項目の追加・意味の変更) だけ。",
    "ただし asset-hub が読まない鍵 (media・area・alt・format) を足すだけなら上げない。asset-hub は",
    "未知の鍵を無視するので、上げると読めなくなるだけ (2026-10-04 段3 U1 は version 1 のまま)。",
    "",
    "ここには以前『slots に 1 件でも変更を入れたら version を +1 する』と書いてあったが、",
    "それに従うと本番が壊れる。読み手である asset-hub は version を **スキーマ版** として",
    "扱い、自分が理解できる上限 (SUPPORTED_MANIFEST_VERSION) を超えた version の宣言を",
    "『読めないファイル』として丸ごと捨てる (lib/site-slot-registry.ts)。つまり中身を変えた",
    "だけで version を上げると、枠が増えるどころか **全枠が消える**。",
    "",
    "中身が変わったことは version ではなく **指紋** (manifestFingerprint) で検出される。",
    "指紋は全枠の id・比率・fit・required・order から作られるので、version を据え置いても",
    "『枠が増えた/減った/比率が変わった』は asset-hub 側で正しく差分に出る。空ファイル",
    "ガード (枠 0 件 / 前回の 50% 未満 / version の逆行) もそのまま働く。",
    "",
    "version を上げるときは、**先に asset-hub の SUPPORTED_MANIFEST_VERSION を上げて",
    "デプロイしてから** こちらを上げる。順番を逆にすると、その間ずっと枠が 0 件になる。",
    "",
    "【比率 (surfaces) の決め方】",
    "surfaces は『その枠が実際に画面に出る場所』を実測で書く。1 枠が複数の見え方を",
    "持つ (SP と PC で比率が違う等) 場合は全部並べる。ratio は表示上の縦横比、",
    "fit は収め方 (cover = はみ出しを切る / contain = 切らずに収める・余白が付く)。",
    "『チャネルに 1 つの比率』ではない — 同じ写真が場所ごとに違う切られ方をするため。",
    "",
    "【media (面の出し分け条件)】",
    "media はその面が選ばれる CSS メディア条件で、<picture> の <source media> に",
    "そのまま出る。省略した面が『既定の面』= どの条件にも当たらないときに出る面で、",
    "枠ごとにちょうど 1 件必要 (check:site-slots が強制)。既定は狭い方 (SP) に置く。",
    "asset-hub は surface の id / ratio / fit しか見ず未知キーを無視するので、",
    "media を足しても切り抜き・指紋は変わらない = version 規約の対象外。",
    "",
    "【validFrom / validTo (任意)】",
    "期間限定 LP・季節ページ用。省略時は常時有効。枠を消すときは slots から削るのでは",
    "なく validTo を入れて履歴を残すのが既定 (削ると asset-hub 側で割当が孤児になる)。"
  ];

/** 1 枠の属性の並び (出力の鍵の順)。id 以外は手で書く属性で、id で引き継ぐ。 */
const SLOT_KEYS = [
  'id',
  'label',
  'page',
  'area',
  'alt',
  'required',
  'order',
  'surfaces',
  'validFrom',
  'validTo',
] as const;

type RawSlot = Record<string, unknown>;

function pageOfSlotId(id: string): string {
  return id.split(':')[1] ?? '';
}

/**
 * コードの枠 id と前の宣言から、新しい宣言を組み立てる (書き込みはしない)。
 *
 * problems は「書いてはいけない」食い違い (コードから消えたのに validTo が無い枠)。
 * その枠は宣言から落とさずに残す (照らす側が同じ枠を「未使用」として報告する)。
 */
export function buildManifest(
  codeIds: readonly string[],
  previous: unknown,
): { manifest: Record<string, unknown>; problems: string[] } {
  const prev = (previous && typeof previous === 'object' ? previous : {}) as Record<string, unknown>;
  const prevSlots = Array.isArray(prev.slots) ? (prev.slots as RawSlot[]) : [];
  const prevById = new Map<string, RawSlot>();
  for (const s of prevSlots) {
    if (s && typeof s === 'object' && typeof s.id === 'string') prevById.set(s.id, s);
  }

  const problems: string[] = [];
  const ids = new Set(codeIds);
  for (const [id, s] of prevById) {
    if (ids.has(id)) continue;
    ids.add(id); // validTo の有無にかかわらず落とさない
    if (typeof s.validTo !== 'string') {
      problems.push(
        `枠 "${id}" はコードから消えましたが validTo がありません。畳むなら宣言の "${id}" に ` +
          'validTo を入れてから作り直してください (削ると asset-hub 側で割当が孤児になります)',
      );
    }
  }

  const slots = [...ids].map((id) => {
    const before = prevById.get(id) ?? { page: pageOfSlotId(id) };
    const out: RawSlot = {};
    for (const key of SLOT_KEYS) {
      const v = key === 'id' ? id : before[key];
      if (v !== undefined) out[key] = v;
    }
    return out;
  });
  slots.sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
    const bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao < bo ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });

  return {
    manifest: {
      $comment: [...MANIFEST_COMMENT],
      format: IMAGE_SLOTS_FORMAT,
      version: typeof prev.version === 'number' ? prev.version : 1,
      org: prev.org,
      slots,
    },
    problems,
  };
}

/** 宣言のファイルの中身 (比率だけ 1 行に畳む。今のファイルの書き方に揃える)。 */
export function renderManifest(manifest: Record<string, unknown>): string {
  const json = JSON.stringify(manifest, null, 2).replace(
    /"ratio": \{\s*"width": ([^,\s]+),\s*"height": ([^\s}]+)\s*\}/g,
    '"ratio": { "width": $1, "height": $2 }',
  );
  return `${json}\n`;
}

/** manifest を読んで検査し、`slots[].id` を order 昇順で返す。不正なら throw。 */
export function readSlotIds(manifestPath: string = MANIFEST_PATH): string[] {
  const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = validateSiteSlotsManifest(raw);
  if (errors.length > 0) {
    throw new Error(
      `site-slots manifest is invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  const slots = (raw as { slots: { id: string; order: number }[] }).slots;
  return [...slots].sort((a, b) => a.order - b.order).map((s) => s.id);
}

/** 生成物のソースを組み立てる (書き込みはしない — テストから比較できるように分離)。 */
export function renderGenerated(ids: string[]): string {
  const union =
    ids.length === 0
      ? '  never'
      : ids.map((id) => `  | ${JSON.stringify(id)}`).join('\n');
  const list = ids.map((id) => `  ${JSON.stringify(id)},`).join('\n');

  return `/**
 * 自動生成ファイル — 直接編集しないこと。
 *
 * 生成元: public/site-slots.manifest.json (枠の集合はコードの slotId から作る)
 * 生成コマンド: pnpm generate:site-slots
 * 一致検査: pnpm check:site-slots (build の前段で走る)
 *
 * 枠を足す・消すときは、コードの SiteImage を直して pnpm generate:site-slots を走らせ、
 * 新しい枠の属性を public/site-slots.manifest.json に書く。このファイルはそこから作り直す。
 */

/** manifest が宣言している枠 id の union。これ以外の id は型で弾かれる。 */
export type SiteSlotId =
${union};

/** 同じ集合を実行時にも使えるようにしたもの (order 昇順)。 */
export const SITE_SLOT_IDS: readonly SiteSlotId[] = [
${list}
] as const;
`;
}

function main(): void {
  const { usages, dynamic } = scanUsages(ROOT);
  if (dynamic.length > 0) {
    for (const d of dynamic) {
      console.error(
        `  [FAIL] ${path.relative(ROOT, d.file)}:${d.line}: slotId が文字列リテラルではありません`,
      );
    }
    process.exit(1);
  }
  const previous: unknown = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : {};
  const { manifest, problems } = buildManifest(usedSlotIds(usages), previous);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  [FAIL] ${p}`);
    console.error('\nsite-slots: 宣言を書かずに止めました');
    process.exit(1);
  }
  writeFileSync(MANIFEST_PATH, renderManifest(manifest), 'utf8');

  const errors = validateSiteSlotsManifest(manifest);
  if (errors.length > 0) {
    for (const e of errors) console.error(`  [FAIL] manifest: ${e}`);
    console.error(
      `\nsite-slots: ${path.relative(ROOT, MANIFEST_PATH)} を作り直しましたが、属性の足りない枠があります。` +
        '書いてからもう一度走らせてください (lib/site-slots.generated.ts は作り直していません)',
    );
    process.exit(1);
  }

  const ids = readSlotIds();
  writeFileSync(GENERATED_PATH, renderGenerated(ids), 'utf8');
  console.log(
    `site-slots: generated ${path.relative(ROOT, MANIFEST_PATH)} and ` +
      `${path.relative(ROOT, GENERATED_PATH)} (${ids.length} slot${ids.length === 1 ? '' : 's'})`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
