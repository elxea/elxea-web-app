/**
 * image-slots-extract.ts
 *
 * Sanity スキーマ (`sanity/schemas/*.ts`) から **画像枠を機械抽出** する。
 *
 * 何のためにあるか
 * ----------------
 * 写真の自動巡回 (elxea-asset-hub の photo-gap-scan) は「経路1 Shopify / 経路2 サイト
 * 装飾枠 / 経路3 記事 / 経路4 お茶メニュー・音盤 / 経路5 人物」の 5 経路しか見ていない。
 * スキーマに画像枠を足しても巡回の母集団には自動では入らないので、**枠が増えたこと
 * 自体に誰も気づかない**。2026-09-11 の /ja/people/* はまさにこれで、人物写真が
 * 何ヶ月も灰色のまま「候補が無い」と誤読され続けた (実際は「見ていなかった」)。
 *
 * そこでサイト装飾枠 (経路2) と同じ倒し方を Sanity 側にも広げる:
 *   スキーマ (実体) --抽出--> public/image-slots.inventory.json (宣言)
 *   両者が食い違ったら build を落とす (scripts/check-image-slots.ts)
 *   巡回はこの inventory を読み、どの経路もカバーしていない枠を報告する
 *
 * なぜ grep ではなく AST か
 * -------------------------
 * `type: "image"` を正規表現で数えると (a) コメント・文字列中の偽陽性を拾い、
 * (b) `type: "seo"` のような **名前付き型の参照**を展開できないので必ず穴が開く。
 * check-site-slots.ts が同じ理由で正規表現から AST に切り替えている (QA NC8/NC9)。
 *
 * 展開規則 (すべての型に同じ規則を適用する。article だけ特別扱いしない)
 * ------------------------------------------------------------------
 *   R1. 走査の起点は `type: "document"` の型だけ。object / array 型は「使われた
 *       場所」に展開されるので、それ自体では枠を生まない。
 *   R2. `type: "image"` のフィールドに到達したら、その時点のパスを 1 枠として出す。
 *   R3. `fields: [...]` があれば各フィールドへ `<path>.<name>` で降りる。
 *   R4. `type: "array"` で `of: [...]` があれば `<path>[]` を基点にする。
 *       - `of` の要素が 1 個だけなら基点をそのまま使う   → `work[].photo`
 *       - `of` が複数なら member を名前で区別する        → `body[].ctaBlock.image`
 *         (member の名前は `name` があればそれ、無ければ `type`)
 *   R5. `type` が別の名前付き型 (object / array) を指していたら、その型の定義へ
 *       **同じ規則で** 降りる。パスは接頭辞を保つ  → `seo` → `article.seo.ogImage`
 *       document 型は参照先として展開しない (reference は別ドキュメントであって
 *       自分の枠ではない)。
 *   R6. 同じ型名がパス上で再帰したら打ち切る (無限展開の防止)。
 *
 * このモジュールはファイルを読むだけで、書き込みも fetch もしない。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/** Sanity 組み込みのプリミティブ / 構造型。名前付き型の参照 (R5) から除外する。 */
const BUILTIN_TYPES = new Set([
  'array',
  'block',
  'boolean',
  'crossDatasetReference',
  'date',
  'datetime',
  'document',
  'email',
  'file',
  'geopoint',
  'image',
  'number',
  'object',
  'reference',
  'slug',
  'string',
  'text',
  'url',
]);

/** 画像枠 1 件。`id` が inventory の主キー。 */
export interface ImageSlot {
  /** `sanity:<documentType>:<path>` */
  id: string;
  /** 起点の document 型名 */
  documentType: string;
  /** document 直下からのフィールドパス (展開規則 R2-R5 の記法) */
  path: string;
  /** 枠を生んだ定義があるファイル (リポジトリ相対) */
  file: string;
}

/** 型名 -> 型定義のオブジェクトリテラル。`defineType({...})` の引数。 */
type TypeRegistry = Map<string, { def: ts.ObjectLiteralExpression; file: string }>;

/** `defineType(...)` / `defineField(...)` / 素のオブジェクトリテラルを剥いて中身を返す。 */
function unwrap(node: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!node) return null;
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text : '';
    if (name === 'defineType' || name === 'defineField' || name === 'defineArrayMember') {
      return unwrap(node.arguments[0]);
    }
  }
  return null;
}

function propOf(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const n = p.name;
    const text = ts.isIdentifier(n) ? n.text : ts.isStringLiteral(n) ? n.text : '';
    if (text === key) return p.initializer;
  }
  return undefined;
}

function stringProp(obj: ts.ObjectLiteralExpression, key: string): string | null {
  const v = propOf(obj, key);
  if (v && ts.isStringLiteral(v)) return v.text;
  return null;
}

function arrayProp(obj: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralExpression[] {
  const v = propOf(obj, key);
  if (!v || !ts.isArrayLiteralExpression(v)) return [];
  const out: ts.ObjectLiteralExpression[] = [];
  for (const el of v.elements) {
    const o = unwrap(el);
    if (o) out.push(o);
  }
  return out;
}

/** 1 ファイルから `defineType({...})` の定義を集める。 */
export function collectTypeDefs(file: string, source: string): TypeRegistry {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const registry: TypeRegistry = new Map();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'defineType') {
        const def = unwrap(node.arguments[0]);
        const name = def ? stringProp(def, 'name') : null;
        if (def && name) registry.set(name, { def, file });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return registry;
}

/**
 * 1 つの型定義 (またはフィールド定義) から画像枠を集める。展開規則 R2-R6。
 *
 * @param def      走査するオブジェクトリテラル (型定義 or フィールド定義)
 * @param slotPath 現在のパス。document 直下なら フィールド名そのもの
 * @param seen     R6 用。パス上で展開済みの名前付き型
 */
function walk(
  def: ts.ObjectLiteralExpression,
  slotPath: string,
  documentType: string,
  registry: TypeRegistry,
  ownFile: string,
  seen: ReadonlySet<string>,
  out: ImageSlot[],
): void {
  const type = stringProp(def, 'type');

  // R2: 画像枠そのもの
  if (type === 'image' && slotPath) {
    out.push({
      id: `sanity:${documentType}:${slotPath}`,
      documentType,
      path: slotPath,
      file: ownFile,
    });
  }

  // R5: 名前付き型の参照を展開する (document 型は展開しない)
  if (type && !BUILTIN_TYPES.has(type) && !seen.has(type)) {
    const referenced = registry.get(type);
    if (referenced) {
      const referencedKind = stringProp(referenced.def, 'type');
      if (referencedKind !== 'document') {
        walk(
          referenced.def,
          slotPath,
          documentType,
          registry,
          referenced.file,
          new Set([...seen, type]),
          out,
        );
      }
    }
  }

  // R3: object の fields
  for (const field of arrayProp(def, 'fields')) {
    const name = stringProp(field, 'name');
    if (!name) continue;
    const next = slotPath ? `${slotPath}.${name}` : name;
    walk(field, next, documentType, registry, ownFile, seen, out);
  }

  // R4: array の of
  const members = arrayProp(def, 'of');
  if (members.length > 0) {
    const base = `${slotPath}[]`;
    for (const member of members) {
      const memberPath =
        members.length === 1
          ? base
          : `${base}.${stringProp(member, 'name') ?? stringProp(member, 'type') ?? 'member'}`;
      walk(member, memberPath, documentType, registry, ownFile, seen, out);
    }
  }
}

/** スキーマディレクトリ全体を走査して画像枠を返す (id 昇順)。 */
export function extractImageSlots(schemaDir: string, repoRoot: string): ImageSlot[] {
  const registry: TypeRegistry = new Map();
  const files = readdirSync(schemaDir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .sort();

  for (const f of files) {
    const abs = path.join(schemaDir, f);
    const rel = path.relative(repoRoot, abs);
    for (const [name, entry] of collectTypeDefs(rel, readFileSync(abs, 'utf8'))) {
      registry.set(name, entry);
    }
  }

  const slots: ImageSlot[] = [];
  for (const [name, entry] of registry) {
    if (stringProp(entry.def, 'type') !== 'document') continue; // R1
    walk(entry.def, '', name, registry, entry.file, new Set([name]), slots);
  }

  slots.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return slots;
}
