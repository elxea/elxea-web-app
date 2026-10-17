/**
 * check-page-visibility.ts
 *
 * 公開ページの宣言 (`config/page-visibility.json`) と、`app/` に実在するルートが
 * 食い違ったまま本番に出るのを止めるビルドゲート。
 *
 * 止めたい事故は 2 方向ある:
 *
 *   (a) app/ にあるのに宣言に無いルート
 *       → これが本丸。ページを新しく作ると、誰も「出す」と決めていないのに
 *          本番に出てしまう。公開範囲を人が決める前に、機械が勝手に広げる。
 *          ここで落として「宣言に 1 行足す (既定は非公開)」を強制する。
 *
 *   (b) 宣言にあるのに app/ に無いルート
 *       → 消したページの行が残り続ける。宣言が現実とずれると、次に読む人が
 *          「これは出ているはずだ」と誤読する。中身が嘘になった宣言は、
 *          宣言が無いより悪い。
 *
 * あわせて、宣言の書き方 (locale 接頭辞を書いていないか・ルートグループが
 * 混ざっていないか・重複していないか) と、`outOfScope` の棚卸しも見る。
 * どれか 1 つでも崩れていれば exit 1。
 *
 * package.json の `build` が `next build` の前に本スクリプトを走らせる。
 * 単体でも `pnpm check:page-visibility` で実行できる。
 *
 * Exit codes: 0 = 整合 / 1 = 不整合
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
export const MANIFEST_PATH = path.join(ROOT, 'config', 'page-visibility.json');
export const APP_DIR = path.join(ROOT, 'app');

/** ルートを定義するファイル名。これ以外は面を生やさない。 */
const ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts', 'route.tsx']);

/**
 * 公開制御の対象になるのは `app/[locale]/` の下だけ。
 *
 * ここより外 (`app/dev` / `app/api` / `app/(studio)` / `app/password` 等) は、
 * 既に別のゲートが受け持っている面で、宣言の `outOfScope` に理由付きで載せる。
 */
const LOCALE_SEGMENT = '[locale]';

export interface PageVisibilityRoute {
  route: string;
  visible: boolean;
  note?: string;
}

export interface PageVisibilityOutOfScope {
  path: string;
  governedBy: string;
  reason: string;
}

export interface PageVisibilityManifest {
  version: number;
  routes: PageVisibilityRoute[];
  outOfScope: PageVisibilityOutOfScope[];
}

/** 宣言ファイル自体の形を検査する。中身の整合 (app/ との突き合わせ) は別。 */
export function validateManifest(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['トップレベルがオブジェクトではありません'];

  const m = raw as Partial<PageVisibilityManifest>;

  if (typeof m.version !== 'number') errors.push('version が数値ではありません');

  if (!Array.isArray(m.routes)) {
    errors.push('routes が配列ではありません');
  } else {
    const seen = new Set<string>();
    for (const [i, entry] of m.routes.entries()) {
      const at = `routes[${i}]`;
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`${at}: オブジェクトではありません`);
        continue;
      }
      const e = entry as Partial<PageVisibilityRoute>;
      if (typeof e.route !== 'string' || e.route.length === 0) {
        errors.push(`${at}: route が文字列ではありません`);
        continue;
      }
      if (typeof e.visible !== 'boolean') {
        errors.push(`${at} (${e.route}): visible が true/false ではありません`);
      }
      if (!e.route.startsWith('/')) {
        errors.push(`${at} (${e.route}): route は "/" で始めてください`);
      }
      if (e.route.length > 1 && e.route.endsWith('/')) {
        errors.push(`${at} (${e.route}): 末尾の "/" は付けないでください`);
      }
      if (/^\/(?:ja|en)(?:\/|$)/.test(e.route)) {
        errors.push(
          `${at} (${e.route}): locale 接頭辞は書きません。1 行が全 locale を受け持ちます`,
        );
      }
      if (/\([^)]*\)/.test(e.route)) {
        errors.push(
          `${at} (${e.route}): ルートグループ (括弧) は URL に出ないので書きません`,
        );
      }
      if (seen.has(e.route)) errors.push(`${at} (${e.route}): route が重複しています`);
      seen.add(e.route);
    }
  }

  if (!Array.isArray(m.outOfScope)) {
    errors.push('outOfScope が配列ではありません');
  } else {
    for (const [i, entry] of m.outOfScope.entries()) {
      const at = `outOfScope[${i}]`;
      const e = entry as Partial<PageVisibilityOutOfScope>;
      if (typeof e?.path !== 'string' || e.path.length === 0) {
        errors.push(`${at}: path が文字列ではありません`);
      }
      if (typeof e?.governedBy !== 'string' || e.governedBy.length === 0) {
        errors.push(`${at} (${e?.path ?? '?'}): governedBy が空です (どのゲートが守るのか)`);
      }
      if (typeof e?.reason !== 'string' || e.reason.length === 0) {
        errors.push(`${at} (${e?.path ?? '?'}): reason が空です`);
      }
    }
  }

  return errors;
}

/**
 * `app/` からの相対パス (posix) を、公開制御で使う URL パスに直す。
 *
 * 対象外 (= `app/[locale]/` の下でない) なら `null` を返す。
 *
 *   "[locale]/(reading)/journal/[slug]/page.tsx" -> "/journal/[slug]"
 *   "[locale]/page.tsx"                          -> "/"
 *   "dev/me/page.tsx"                            -> null
 */
export function toUrlPath(appRelativeFile: string): string | null {
  const segments = appRelativeFile.split('/');
  const file = segments.pop();
  if (!file || !ROUTE_FILES.has(file)) return null;
  if (segments[0] !== LOCALE_SEGMENT) return null;

  const urlSegments = segments
    .slice(1)
    // ルートグループ `(reading)` は URL に出ない
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')));

  return urlSegments.length === 0 ? '/' : `/${urlSegments.join('/')}`;
}

/** `app/` を歩いて、ルートを定義するファイルを `app/` 相対 (posix) で集める。 */
export function listRouteFiles(appDir: string = APP_DIR): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (ROUTE_FILES.has(name)) {
        out.push(path.relative(appDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(appDir);
  return out;
}

/**
 * 宣言と実ルートを突き合わせて、問題の一覧を返す (空なら整合)。
 *
 * ファイル走査から切り離してあるのは、テストが実ファイルを作らずに
 * 「宣言に無いルートがあったら落ちる」を測れるようにするため。
 */
export function diffRoutes(manifest: PageVisibilityManifest, routeFiles: string[]): string[] {
  const problems: string[] = [];

  const declared = new Map(manifest.routes.map((r) => [r.route, r] as const));
  const derived = new Map<string, string[]>();
  const usedOutOfScope = new Set<string>();

  for (const file of routeFiles) {
    const url = toUrlPath(file);
    if (url !== null) {
      const list = derived.get(url) ?? [];
      list.push(file);
      derived.set(url, list);
      continue;
    }

    // 対象外の面は、理由付きで outOfScope に載っていなければならない。
    // ここを素通しにすると、app/ 直下に新しい面を生やしたときに
    // 「公開制御の外にある」ことが誰にも見えないまま本番に出る。
    const covered = manifest.outOfScope.find((e) => file.startsWith(e.path));
    if (covered) {
      usedOutOfScope.add(covered.path);
    } else {
      problems.push(
        `app/${file} は公開制御の宣言にありません。` +
          '`app/[locale]/` の下に置くか、別のゲートが守っているなら ' +
          'config/page-visibility.json の outOfScope に理由付きで足してください',
      );
    }
  }

  // (a) app/ にあるのに宣言に無い
  for (const [url, files] of [...derived].sort()) {
    if (declared.has(url)) continue;
    problems.push(
      `ルート "${url}" (${files.map((f) => `app/${f}`).join(', ')}) が ` +
        'config/page-visibility.json にありません。' +
        'config/page-visibility.json に行を足してください (既定は hidden): ' +
        `{ "route": "${url}", "visible": false, "note": "..." }`,
    );
  }

  // (b) 宣言にあるのに app/ に無い
  for (const route of declared.keys()) {
    if (derived.has(route)) continue;
    problems.push(
      `ルート "${route}" を config/page-visibility.json が宣言していますが、` +
        'app/ に実体がありません。ページを消したなら宣言の行も消してください',
    );
  }

  // (c) 使われていない outOfScope (棚卸し)
  for (const entry of manifest.outOfScope) {
    if (usedOutOfScope.has(entry.path)) continue;
    problems.push(
      `outOfScope の "${entry.path}" に当たるファイルが app/ にありません。` +
        '不要になった行は消してください',
    );
  }

  return problems;
}

function main(): void {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('FAIL: config/page-visibility.json がありません');
    process.exit(1);
  }

  const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const schemaErrors = validateManifest(raw);
  if (schemaErrors.length > 0) {
    console.error('');
    for (const e of schemaErrors) console.error(`  [FAIL] ${e}`);
    console.error('\nSummary: config/page-visibility.json の内容が不正です');
    process.exit(1);
  }

  const manifest = raw as PageVisibilityManifest;
  const problems = diffRoutes(manifest, listRouteFiles());

  const visible = manifest.routes.filter((r) => r.visible).length;
  console.log(
    `page-visibility: version=${manifest.version} / 宣言 ${manifest.routes.length} ルート ` +
      `(公開 ${visible} / 非公開 ${manifest.routes.length - visible}) / ` +
      `対象外 ${manifest.outOfScope.length} 件`,
  );

  if (problems.length > 0) {
    console.error('');
    for (const p of problems) console.error(`  [FAIL] ${p}`);
    console.error('');
    console.error(
      `Summary: 公開ページの宣言と app/ の実ルートが ${problems.length} 件食い違っています — ` +
        'ビルドを中止しました',
    );
    process.exit(1);
  }

  console.log('page-visibility: [OK] 宣言と app/ の実ルートは一致しています');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
