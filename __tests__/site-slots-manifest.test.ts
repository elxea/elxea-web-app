/**
 * 画像枠宣言 (public/site-slots.manifest.json) の検査述語とビルドゲートのテスト。
 *
 * ゲート本体 (`scripts/check-site-slots.ts`) は実際に子プロセスで走らせる。
 * 「正常なら 0 / 食い違ったら 1」はビルドが止まるかどうかそのものなので、
 * 述語を単体で呼ぶだけでは検証したことにならない。
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SITE_SLOTS,
  SITE_SLOTS_MANIFEST,
  SITE_SLOT_IDS,
  getSiteSlot,
  isSiteSlotActive,
  validateSiteSlotsManifest,
  type SiteSlot,
} from '@/lib/site-slots';
import { mayUseSlots, scanSource } from '@/scripts/check-site-slots';
import {
  GENERATED_PATH,
  buildManifest,
  readSlotIds,
  renderGenerated,
  renderManifest,
} from '@/scripts/gen-site-slots';
import { scanUsages, usedSlotIds } from '@/scripts/lib/site-slots-scan';

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'public', 'site-slots.manifest.json');
const PAGE_PATH = path.join(ROOT, 'app', '[locale]', 'page.tsx');

/**
 * 実使用 (JSX 属性 slotId) だけを外し、id の文字列自体はソースに残す。
 * 「文字列が残っているだけでは使用と数えない」ことを測るための細工。
 */
function removeSlotUsage(source: string): string {
  const replaced = source.replace(/slotId="(site:[a-z0-9:-]+)"/, 'data-legacy-slot="$1"');
  if (replaced === source) throw new Error('slotId 属性が見つからず、細工できませんでした');
  return replaced;
}

function regenerate(): void {
  execFileSync('npx', ['tsx', 'scripts/gen-site-slots.ts'], { cwd: ROOT, stdio: 'ignore' });
}

/** 作り直し (gen-site-slots) を子プロセスで走らせ、終了コードと出力を返す。 */
function runGenerate(): { code: number; output: string } {
  try {
    const output = execFileSync('npx', ['tsx', 'scripts/gen-site-slots.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** 検査を通る最小の枠。各テストがここから 1 か所だけ壊す。 */
function validSlot(overrides: Partial<SiteSlot> = {}): SiteSlot {
  return {
    id: 'site:top:hero-01',
    label: 'トップ Hero',
    page: 'top',
    area: 'top',
    alt: 'code',
    required: true,
    order: 10,
    surfaces: [
      { id: 'pc', label: 'PC', ratio: { width: 864, height: 560 }, fit: 'cover' },
    ],
    ...overrides,
  };
}

function validManifest(slots: SiteSlot[] = [validSlot()]) {
  return { format: 'image-slots/v2', version: 1, org: 'ELX', slots };
}

/** ゲートを子プロセスで走らせ、終了コードと出力を返す。 */
function runGate(): { code: number; output: string } {
  try {
    const output = execFileSync('npx', ['tsx', 'scripts/check-site-slots.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('site-slots manifest (SoT)', () => {
  it('リポジトリの実物が検査を通る', () => {
    const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(validateSiteSlotsManifest(raw)).toEqual([]);
  });

  it('公開経路が public/ 直下にある (= ビルド出力に入り URL で配信される)', () => {
    expect(path.relative(ROOT, MANIFEST_PATH)).toBe(
      path.join('public', 'site-slots.manifest.json'),
    );
  });

  it('生成された id の union と manifest の中身が一致する', () => {
    expect([...SITE_SLOT_IDS]).toEqual(SITE_SLOTS.map((s) => s.id));
  });

  it('SITE_SLOTS は order 昇順で並ぶ (配列順への暗黙依存をやめる)', () => {
    const orders = SITE_SLOTS.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('全枠が 1 件以上の表示場所 (surface) を持つ', () => {
    for (const slot of SITE_SLOTS) {
      expect(slot.surfaces.length).toBeGreaterThan(0);
    }
  });

  it('getSiteSlot が宣言された枠を引ける', () => {
    for (const id of SITE_SLOT_IDS) {
      expect(getSiteSlot(id).id).toBe(id);
    }
  });

  it('org と version を持つ', () => {
    expect(SITE_SLOTS_MANIFEST.org).toBe('ELX');
    expect(SITE_SLOTS_MANIFEST.version).toBeGreaterThanOrEqual(1);
  });
});

describe('validateSiteSlotsManifest — 異常系', () => {
  const cases: [string, unknown][] = [
    ['オブジェクトでない', []],
    ['version が無い', { org: 'ELX', slots: [] }],
    ['version が 0', { ...validManifest(), version: 0 }],
    ['org が空', { ...validManifest(), org: '' }],
    ['slots が配列でない', { version: 1, org: 'ELX', slots: {} }],
    ['id の形式が違う', validManifest([validSlot({ id: 'top-hero' } as Partial<SiteSlot>)])],
    [
      'id が重複',
      validManifest([validSlot(), validSlot({ order: 20 })]),
    ],
    [
      'order が重複',
      validManifest([validSlot(), validSlot({ id: 'site:about:hero-01', page: 'about' })]),
    ],
    ['label が空', validManifest([validSlot({ label: '' })])],
    ['required が boolean でない', validManifest([validSlot({ required: 'yes' } as never)])],
    ['order が数値でない', validManifest([validSlot({ order: '10' } as never)])],
    ['page が id と食い違う', validManifest([validSlot({ page: 'about' })])],
    ['surfaces が空', validManifest([validSlot({ surfaces: [] })])],
    [
      'fit が cover/contain でない',
      validManifest([
        validSlot({
          surfaces: [
            { id: 'pc', label: 'PC', ratio: { width: 1, height: 1 }, fit: 'fill' as never },
          ],
        }),
      ]),
    ],
    [
      'ratio が 0 以下',
      validManifest([
        validSlot({
          surfaces: [
            { id: 'pc', label: 'PC', ratio: { width: 0, height: 560 }, fit: 'cover' },
          ],
        }),
      ]),
    ],
    [
      'surface id が枠内で重複',
      validManifest([
        validSlot({
          surfaces: [
            { id: 'pc', label: 'PC', ratio: { width: 1, height: 1 }, fit: 'cover' },
            { id: 'pc', label: 'PC 2', ratio: { width: 1, height: 1 }, fit: 'cover' },
          ],
        }),
      ]),
    ],
    [
      'media が空文字',
      validManifest([
        validSlot({
          surfaces: [
            { id: 'pc', label: 'PC', ratio: { width: 1, height: 1 }, fit: 'cover', media: '  ' },
          ],
        }),
      ]),
    ],
    [
      '既定の面 (media なし) が 0 件',
      validManifest([
        validSlot({
          surfaces: [
            {
              id: 'sp',
              label: 'SP',
              ratio: { width: 5, height: 4 },
              fit: 'cover',
              media: '(max-width: 1023px)',
            },
            {
              id: 'pc',
              label: 'PC',
              ratio: { width: 864, height: 560 },
              fit: 'cover',
              media: '(min-width: 1024px)',
            },
          ],
        }),
      ]),
    ],
    [
      '既定の面 (media なし) が 2 件',
      validManifest([
        validSlot({
          surfaces: [
            { id: 'sp', label: 'SP', ratio: { width: 5, height: 4 }, fit: 'cover' },
            { id: 'pc', label: 'PC', ratio: { width: 864, height: 560 }, fit: 'cover' },
          ],
        }),
      ]),
    ],
    ['validTo が日付でない', validManifest([validSlot({ validTo: 'いつか' })])],
    [
      'validFrom が validTo より後',
      validManifest([validSlot({ validFrom: '2026-12-01', validTo: '2026-01-01' })]),
    ],
  ];

  it.each(cases)('%s → エラーを返す', (_name, manifest) => {
    expect(validateSiteSlotsManifest(manifest).length).toBeGreaterThan(0);
  });

  it('正常な manifest はエラーを返さない', () => {
    expect(validateSiteSlotsManifest(validManifest())).toEqual([]);
  });

  it('既定の面 1 + 条件付きの面 1 は正常', () => {
    const manifest = validManifest([
      validSlot({
        surfaces: [
          { id: 'sp', label: 'SP', ratio: { width: 5, height: 4 }, fit: 'cover' },
          {
            id: 'pc',
            label: 'PC',
            ratio: { width: 864, height: 560 },
            fit: 'cover',
            media: '(min-width: 1024px)',
          },
        ],
      }),
    ]);
    expect(validateSiteSlotsManifest(manifest)).toEqual([]);
  });
});

/**
 * 面の出し分け条件は宣言だけが持つ (以前はページの className の `lg:` と surface の
 * label 文に同じ 1024px が散らばっていた)。描画側はこれを読むだけなので、
 * 実物が「既定 1 件 + 条件付き」の形になっていること自体を測る。
 */
describe('surface の media (面の出し分け条件)', () => {
  it('全枠が既定の面 (media なし) をちょうど 1 件持つ', () => {
    for (const slot of SITE_SLOTS) {
      const base = slot.surfaces.filter((s) => s.media === undefined);
      expect(base).toHaveLength(1);
    }
  });

  it('既定でない面は空でない media を持つ', () => {
    for (const slot of SITE_SLOTS) {
      for (const surface of slot.surfaces.filter((s) => s.media !== undefined)) {
        expect(surface.media?.trim()).toBeTruthy();
      }
    }
  });
});

describe('isSiteSlotActive', () => {
  const at = (iso: string) => new Date(iso);

  it('有効期間の指定が無ければ常に有効', () => {
    expect(isSiteSlotActive(validSlot(), at('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('validFrom より前は無効', () => {
    const slot = validSlot({ validFrom: '2026-09-01' });
    expect(isSiteSlotActive(slot, at('2026-08-31T00:00:00Z'))).toBe(false);
    expect(isSiteSlotActive(slot, at('2026-09-02T00:00:00Z'))).toBe(true);
  });

  it('validTo は「その日いっぱい」まで有効', () => {
    const slot = validSlot({ validTo: '2026-09-30' });
    expect(isSiteSlotActive(slot, at('2026-09-30T23:59:00Z'))).toBe(true);
    expect(isSiteSlotActive(slot, at('2026-10-01T00:00:01Z'))).toBe(false);
  });
});

/**
 * 「使用」の判定は AST で行う (JSX 属性 slotId の文字列リテラルのみ)。
 * 以前は任意の引用文字列を正規表現で拾っていたため、コメントが実使用の代わりに
 * なる偽陰性 (QA NC9) と、コメントを足しただけで落ちる偽陽性 (NC8) が起きていた。
 */
describe('scanSource — 何を「使用」と数えるか', () => {
  const ids = (source: string) =>
    scanSource('fixture.tsx', source).usages.map((u) => u.id);

  it('JSX 属性の文字列リテラルは使用と数える', () => {
    expect(ids('const a = <SiteImage slotId="site:top:hero-01" />;')).toEqual([
      'site:top:hero-01',
    ]);
  });

  it('波括弧つきの文字列リテラルも数える', () => {
    expect(ids('const a = <SiteImage slotId={"site:top:hero-01"} />;')).toEqual([
      'site:top:hero-01',
    ]);
    expect(ids('const a = <SiteImage slotId={`site:top:hero-01`} />;')).toEqual([
      'site:top:hero-01',
    ]);
  });

  it('行コメント内の id は数えない (NC8 の偽陽性)', () => {
    expect(ids('// legacy: "site:ghost:hero-01"\nconst a = 1;')).toEqual([]);
  });

  it('ブロックコメント内の id は数えない', () => {
    expect(ids('/* was slotId="site:ghost:hero-01" */\nconst a = 1;')).toEqual([]);
  });

  it('別の属性に置かれた id は数えない (NC9 の偽陰性)', () => {
    expect(ids('const a = <img data-legacy-slot="site:top:hero-01" />;')).toEqual([]);
  });

  it('slotId 以外の場所の文字列は数えない', () => {
    expect(ids('const s = "site:top:hero-01";')).toEqual([]);
  });

  it('静的に読めない slotId は dynamic として拾う', () => {
    const { usages, dynamic } = scanSource(
      'fixture.tsx',
      'const a = <SiteImage slotId={id} />;',
    );
    expect(usages).toEqual([]);
    expect(dynamic).toHaveLength(1);
  });

  it('埋め込みのあるテンプレート文字列も dynamic 扱い', () => {
    const { usages, dynamic } = scanSource(
      'fixture.tsx',
      'const a = <SiteImage slotId={`site:top:${n}`} />;',
    );
    expect(usages).toEqual([]);
    expect(dynamic).toHaveLength(1);
  });
});

describe('scanSource — サーバ側で枠を読む呼び出し (getSiteImage / getSiteAsset)', () => {
  it('枠 id の文字列リテラルで呼べば使用に数える', () => {
    const { usages, dynamic } = scanSource(
      'app/api/og-image/route.ts',
      'const a = await getSiteAsset("site:social-share:og-image-01", "");\n' +
        'const b = await getSiteImage(`site:top:hero-01`, "");',
    );
    expect(usages.map((u) => u.id)).toEqual(['site:social-share:og-image-01', 'site:top:hero-01']);
    expect(dynamic).toEqual([]);
  });

  it('変数で呼ぶ呼び出し (SiteImage の中の getSiteImage(slotId, …)) は数えない。宣言に無い id は数えてゲートで落ちる', () => {
    expect(scanSource('components/x.tsx', 'const r = await getSiteImage(slotId, src);').usages).toEqual([]);
    expect(scanSource('lib/x.ts', 'getSiteAsset("site:nowhere:x-01", "")').usages.map((u) => u.id)).toEqual([
      'site:nowhere:x-01',
    ]);
  });

  it('足切り: slotId も呼び出しも無いファイルだけを飛ばす', () => {
    expect(mayUseSlots('export const x = 1;')).toBe(false);
    expect(mayUseSlots('<SiteImage slotId="site:top:hero-01" />')).toBe(true);
    expect(mayUseSlots('await getSiteAsset("site:social-share:og-image-01", "")')).toBe(true);
    // 関数の名前を言うだけ (呼ばない) では対象にしない。
    expect(mayUseSlots('// getSiteAsset を使う')).toBe(false);
  });
});

describe('check:site-slots ゲート (子プロセス実行)', () => {
  it('宣言とコードが一致していれば exit 0', () => {
    const { code, output } = runGate();
    expect(output).toContain('[OK]');
    expect(code).toBe(0);
  });

  it('manifest にあるのにコードで使われていない枠があれば exit 1', () => {
    const original = readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(original) as { version: number; slots: SiteSlot[] };
    parsed.version += 1;
    parsed.slots.push(
      validSlot({ id: 'site:ghost:hero-01', page: 'ghost', order: 9999, required: false }),
    );
    try {
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      const { code, output } = runGate();
      expect(code).toBe(1);
      expect(output).toContain('site:ghost:hero-01');
      // 生成物とのズレも同時に検出される
      expect(output).toContain('generate:site-slots');
    } finally {
      writeFileSync(MANIFEST_PATH, original, 'utf8');
    }
  });

  it('コードで使っている枠が manifest から消えれば exit 1', () => {
    const original = readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(original) as { version: number; slots: SiteSlot[] };
    const removed = parsed.slots[0].id;
    parsed.version += 1;
    parsed.slots = parsed.slots.slice(1);
    try {
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      const { code, output } = runGate();
      expect(code).toBe(1);
      expect(output).toContain(removed);
    } finally {
      writeFileSync(MANIFEST_PATH, original, 'utf8');
    }
  });

  /**
   * QA NC5: manifest は「畳むなら validTo を入れる」と案内しているのに、検査が
   * validTo を見ておらず、案内どおりにやると build が落ちていた。落ちないのが正。
   */
  it('validTo を入れた枠はコードから外しても exit 0 (廃止手順が通る)', () => {
    const originalManifest = readFileSync(MANIFEST_PATH, 'utf8');
    const originalPage = readFileSync(PAGE_PATH, 'utf8');
    const parsed = JSON.parse(originalManifest) as { version: number; slots: SiteSlot[] };
    parsed.version += 1;
    parsed.slots[0].validTo = '2026-01-31';
    try {
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      writeFileSync(PAGE_PATH, removeSlotUsage(originalPage), 'utf8');
      regenerate();
      const { code, output } = runGate();
      expect(output).toContain('[SKIP]');
      expect(output).toContain('validTo=2026-01-31');
      expect(code).toBe(0);
    } finally {
      writeFileSync(MANIFEST_PATH, originalManifest, 'utf8');
      writeFileSync(PAGE_PATH, originalPage, 'utf8');
      regenerate();
    }
  });

  /**
   * QA NC9: SiteImage を消してコメント等に id 文字列だけ残すと、以前は
   * 「使用されている」と誤判定してゲートを黙って通り抜けていた。落ちるのが正。
   */
  it('validTo なしで枠をコードから外すと exit 1 (文字列の残骸は使用と数えない)', () => {
    const originalPage = readFileSync(PAGE_PATH, 'utf8');
    try {
      writeFileSync(PAGE_PATH, removeSlotUsage(originalPage), 'utf8');
      const { code, output } = runGate();
      expect(code).toBe(1);
      expect(output).toContain('コードのどこでも');
    } finally {
      writeFileSync(PAGE_PATH, originalPage, 'utf8');
    }
  });

  it('壊れた manifest なら exit 1', () => {
    const original = readFileSync(MANIFEST_PATH, 'utf8');
    try {
      writeFileSync(MANIFEST_PATH, '{"version":0,"org":"","slots":[]}\n', 'utf8');
      const { code, output } = runGate();
      expect(code).toBe(1);
      expect(output).toContain('FAIL');
    } finally {
      writeFileSync(MANIFEST_PATH, original, 'utf8');
    }
  });
});

/**
 * 段3 U1: 枠の集合はコードから作り、手書きの属性は id で引き継ぐ (image-slots/v2)。
 * build の守りを壊して落ちること (足す・消す・名前を変える・属性を落とす・手で崩す) と、
 * 作り直して差が 0 であることを確かめる。
 */
describe('image-slots/v2 — ページの枠の集合をコードから作る', () => {
  it('リポジトリの宣言をコードから作り直すと 1 バイトも変わらない (差 0)', () => {
    const file = readFileSync(MANIFEST_PATH, 'utf8');
    const { usages, dynamic } = scanUsages(ROOT);
    expect(dynamic).toEqual([]);
    const { manifest, problems } = buildManifest(usedSlotIds(usages), JSON.parse(file));
    expect(problems).toEqual([]);
    expect(renderManifest(manifest)).toBe(file);
    expect(renderGenerated(readSlotIds(MANIFEST_PATH))).toBe(readFileSync(GENERATED_PATH, 'utf8'));
  });

  it('全枠が area と alt を持ち、ページの枠の alt はコードが持つ (code)。version は 1 のまま', () => {
    for (const slot of SITE_SLOTS) {
      expect(slot.area, slot.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slot.alt, slot.id).toBe('code');
    }
    expect(SITE_SLOTS_MANIFEST.format).toBe('image-slots/v2');
    // version は asset-hub が読める上限 (1) と比べられる。欄を足しても上げない。
    expect(SITE_SLOTS_MANIFEST.version).toBe(1);
  });

  it('宣言に exit (届け先の種類) の欄を持たない (段2設計のつなぎ J7)', () => {
    for (const slot of SITE_SLOTS) expect(Object.keys(slot)).not.toContain('exit');
  });

  it('buildManifest: 手書きの属性は id で引き継ぎ、新しい枠は属性が空のまま入る', () => {
    const prev = validManifest([validSlot()]);
    const { manifest, problems } = buildManifest(['site:top:hero-01', 'site:top:new-01'], prev);
    expect(problems).toEqual([]);
    const slots = manifest.slots as SiteSlot[];
    expect(slots[0]).toEqual(validSlot());
    expect(slots[1]).toEqual({ id: 'site:top:new-01', page: 'top' });
    expect(validateSiteSlotsManifest(manifest).join('\n')).toContain('slots[1]: label');
  });

  it('buildManifest: コードから消えた枠は validTo が無ければ problems に出し、宣言からは落とさない', () => {
    const { manifest, problems } = buildManifest([], validManifest([validSlot()]));
    expect(problems.join('\n')).toContain('site:top:hero-01');
    expect((manifest.slots as SiteSlot[]).map((s) => s.id)).toEqual(['site:top:hero-01']);
    const retired = buildManifest([], validManifest([validSlot({ validTo: '2026-01-31' })]));
    expect(retired.problems).toEqual([]);
  });

  /**
   * 壊し方の試験は一時の写し (public/・lib/・app/ だけ) で走らせる。本物の page.tsx や宣言を
   * 書き換えると、並んで走るほかの試験がその瞬間のファイルを読んで揺れるため。
   */
  function makeFixture(): {
    dir: string;
    page: string;
    manifest: string;
    generated: string;
    gate: () => { code: number; output: string };
    generate: () => { code: number; output: string };
  } {
    const dir = mkdtempSync(path.join(tmpdir(), 'u1-site-slots-'));
    for (const d of ['public', 'lib', 'app']) mkdirSync(path.join(dir, d));
    const manifest = path.join(dir, 'public', 'site-slots.manifest.json');
    const generated = path.join(dir, 'lib', 'site-slots.generated.ts');
    const page = path.join(dir, 'app', 'page.tsx');
    copyFileSync(MANIFEST_PATH, manifest);
    copyFileSync(GENERATED_PATH, generated);
    writeFileSync(
      page,
      SITE_SLOT_IDS.map((id, i) => `export const P${i} = () => <SiteImage slotId="${id}" />;`).join(
        '\n',
      ) + '\n',
      'utf8',
    );
    const run = (script: string) => () => {
      try {
        const output = execFileSync('npx', ['tsx', script], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, SITE_SLOTS_ROOT: dir },
        });
        return { code: 0, output };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      }
    };
    return {
      dir,
      page,
      manifest,
      generated,
      gate: run('scripts/check-site-slots.ts'),
      generate: run('scripts/gen-site-slots.ts'),
    };
  }

  function withFixture(body: (f: ReturnType<typeof makeFixture>) => void): void {
    const f = makeFixture();
    try {
      body(f);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }

  it('写しは壊す前に検査を通り、作り直しても差 0 (試験の前提)', () => {
    withFixture((f) => {
      expect(f.gate().code).toBe(0);
      const before = readFileSync(f.manifest, 'utf8');
      expect(f.generate().code).toBe(0);
      expect(readFileSync(f.manifest, 'utf8')).toBe(before);
    });
  });

  it('[壊し方: 足す] コードに枠を足すと exit 1。作り直しても属性を書くまで exit 1', () => {
    withFixture((f) => {
      const originalGenerated = readFileSync(f.generated, 'utf8');
      writeFileSync(
        f.page,
        `${readFileSync(f.page, 'utf8')}export const Probe = () => <SiteImage slotId="site:top:probe-01" />;\n`,
        'utf8',
      );
      const before = f.gate();
      expect(before.code).toBe(1);
      expect(before.output).toContain('site:top:probe-01');

      const gen = f.generate();
      expect(gen.code).toBe(1);
      expect(gen.output).toContain('属性の足りない枠');
      // 宣言には骨だけ入り、union 型は作り直さない
      expect(readFileSync(f.manifest, 'utf8')).toContain('site:top:probe-01');
      expect(readFileSync(f.generated, 'utf8')).toBe(originalGenerated);

      const after = f.gate();
      expect(after.code).toBe(1);
      expect(after.output).toContain('area');
      expect(after.output).toContain('alt');
    });
  });

  it('[壊し方: 消す] validTo なしでコードから消すと exit 1。作り直しは書かずに止まる', () => {
    withFixture((f) => {
      const [first, ...rest] = readFileSync(f.page, 'utf8').split('\n');
      writeFileSync(f.page, rest.join('\n'), 'utf8');
      const removed = /slotId="([^"]+)"/.exec(first)?.[1] ?? '';
      const originalManifest = readFileSync(f.manifest, 'utf8');

      const gate = f.gate();
      expect(gate.code).toBe(1);
      expect(gate.output).toContain(removed);

      const gen = f.generate();
      expect(gen.code).toBe(1);
      expect(gen.output).toContain('validTo');
      expect(readFileSync(f.manifest, 'utf8')).toBe(originalManifest);
    });
  });

  it('[壊し方: 名前を変える] コードの枠の名前を変えると、古い名前と新しい名前の両方で exit 1', () => {
    withFixture((f) => {
      const oldId = SITE_SLOT_IDS[0];
      const newId = `${oldId}-renamed`;
      const source = readFileSync(f.page, 'utf8');
      writeFileSync(f.page, source.replace(`slotId="${oldId}"`, `slotId="${newId}"`), 'utf8');
      const { code, output } = f.gate();
      expect(code).toBe(1);
      expect(output).toContain(`"${oldId}"`);
      expect(output).toContain(`"${newId}"`);
    });
  });

  it.each(['area', 'alt', 'label', 'surfaces', 'order'] as const)(
    '[壊し方: 属性を落とす] 宣言の 1 枠から %s を落とすと exit 1',
    (key) => {
      withFixture((f) => {
        const parsed = JSON.parse(readFileSync(f.manifest, 'utf8')) as {
          slots: Record<string, unknown>[];
        };
        delete parsed.slots[1][key];
        writeFileSync(f.manifest, renderManifest(parsed), 'utf8');
        const { code, output } = f.gate();
        expect(code).toBe(1);
        expect(output).toContain(key);
      });
    },
  );

  it('[壊し方: 手で並びを崩す] 作り直した物と中身が違えば exit 1', () => {
    withFixture((f) => {
      const parsed = JSON.parse(readFileSync(f.manifest, 'utf8')) as { slots: unknown[] };
      [parsed.slots[0], parsed.slots[1]] = [parsed.slots[1], parsed.slots[0]];
      writeFileSync(f.manifest, renderManifest(parsed), 'utf8');
      const { code, output } = f.gate();
      expect(code).toBe(1);
      expect(output).toContain('作り直すと中身が変わります');
    });
  });
});
