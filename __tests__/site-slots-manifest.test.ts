/**
 * 画像枠宣言 (public/site-slots.manifest.json) の検査述語とビルドゲートのテスト。
 *
 * ゲート本体 (`scripts/check-site-slots.ts`) は実際に子プロセスで走らせる。
 * 「正常なら 0 / 食い違ったら 1」はビルドが止まるかどうかそのものなので、
 * 述語を単体で呼ぶだけでは検証したことにならない。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'public', 'site-slots.manifest.json');

/** 検査を通る最小の枠。各テストがここから 1 か所だけ壊す。 */
function validSlot(overrides: Partial<SiteSlot> = {}): SiteSlot {
  return {
    id: 'site:top:hero-01',
    label: 'トップ Hero',
    page: 'top',
    required: true,
    order: 10,
    surfaces: [
      { id: 'pc', label: 'PC', ratio: { width: 864, height: 560 }, fit: 'cover' },
    ],
    ...overrides,
  };
}

function validManifest(slots: SiteSlot[] = [validSlot()]) {
  return { version: 1, org: 'ELX', slots };
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
