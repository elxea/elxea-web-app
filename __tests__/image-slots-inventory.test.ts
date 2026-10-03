/**
 * Sanity の画像の欄の宣言 (public/image-slots.inventory.json) の検査とビルドゲートのテスト。
 *
 * 段3 U1 (書き方 image-slots/v2): 宣言に area (入れた状態の場所)・alt (説明文の作り方) を
 * 足した。集合はスキーマから作り、手書きの欄 (rendered・area・alt・note) は id で引き継ぐ。
 * ゲート本体 (`scripts/check-image-slots.ts`) は子プロセスで走らせる (落ちるかどうかが守りそのもの)。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateInventoryShape } from '@/scripts/check-image-slots';
import {
  INVENTORY_PATH,
  SCHEMA_DIR,
  annotationsOf,
  buildInventory,
  renderInventory,
} from '@/scripts/gen-image-slots';
import { extractImageSlots } from '@/scripts/lib/image-slots-extract';

const ROOT = path.resolve(__dirname, '..');

type Slot = Record<string, unknown> & { id: string };

function readInventory(): { text: string; raw: { slots: Slot[] } & Record<string, unknown> } {
  const text = readFileSync(INVENTORY_PATH, 'utf8');
  return { text, raw: JSON.parse(text) };
}

function runGate(): { code: number; output: string } {
  try {
    const output = execFileSync('npx', ['tsx', 'scripts/check-image-slots.ts'], {
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

/** 実物の inventory を一時的に書き換えてゲートを走らせ、必ず元に戻す。 */
function withInventory(mutate: (raw: { slots: Slot[] } & Record<string, unknown>) => void) {
  const { text, raw } = readInventory();
  mutate(raw);
  try {
    writeFileSync(INVENTORY_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    return runGate();
  } finally {
    writeFileSync(INVENTORY_PATH, text, 'utf8');
  }
}

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'sanity:article:mainImage',
    documentType: 'article',
    path: 'mainImage',
    file: 'sanity/schemas/article.ts',
    rendered: true,
    area: 'articles',
    alt: 'title',
    note: '',
    ...overrides,
  };
}

function inventory(slots: Slot[]) {
  return { format: 'image-slots/v2', slots };
}

describe('image-slots inventory (実物)', () => {
  it('スキーマから作り直すと 1 バイトも変わらない (差 0)', () => {
    const { text, raw } = readInventory();
    const rebuilt = buildInventory(extractImageSlots(SCHEMA_DIR, ROOT), annotationsOf(raw));
    expect(renderInventory(rebuilt)).toBe(text);
  });

  it('形の検査を通る (書き方の版・area・alt を含む)', () => {
    expect(validateInventoryShape(readInventory().raw)).toEqual([]);
  });

  it('描画される欄はすべて area と alt を持ち、exit の欄は持たない', () => {
    for (const s of readInventory().raw.slots) {
      expect(Object.keys(s), s.id).not.toContain('exit');
      if (s.rendered !== true) continue;
      expect(s.area, s.id).toEqual(expect.any(String));
      expect(s.alt, s.id).toEqual(expect.any(String));
    }
  });

  /**
   * 段3設計 2節: 記事の本文の画像と、配列の中の画像の欄 (本文・ctaBlock・work・fieldSeasons) は
   * 全部を描画される枠として宣言する。宣言から落ちたら (rendered が true でなくなったら) 落ちる。
   */
  it.each([
    ['sanity:article:body[].image', 'articles'],
    ['sanity:article:body[].ctaBlock.image', 'articles'],
    ['sanity:event:description[].image', 'events'],
    ['sanity:event:description[].ctaBlock.image', 'events'],
    ['sanity:farmer:bio[].image', 'farmers'],
    ['sanity:farmer:bio[].ctaBlock.image', 'farmers'],
    ['sanity:journal:body[].image', 'journal'],
    ['sanity:journal:body[].ctaBlock.image', 'journal'],
    ['sanity:page:body[].image', 'pages'],
    ['sanity:page:body[].ctaBlock.image', 'pages'],
    ['sanity:playlist:body[].image', 'playlists'],
    ['sanity:playlist:body[].ctaBlock.image', 'playlists'],
    ['sanity:author:work[].photo', 'people'],
    ['sanity:farmer:work[].photo', 'farmers'],
    ['sanity:farmer:fieldSeasons[].photo', 'farmers'],
  ])('配列の中の画像の欄 %s は描画される枠として area=%s で宣言されている', (id, area) => {
    const s = readInventory().raw.slots.find((x) => x.id === id);
    expect(s, id).toBeDefined();
    expect(s?.rendered).toBe(true);
    expect(s?.area).toBe(area);
  });
});

describe('validateInventoryShape — area / alt (image-slots/v2)', () => {
  it('正常な最小の宣言はエラーを返さない', () => {
    expect(validateInventoryShape(inventory([slot()]))).toEqual([]);
  });

  it('format が無ければエラー', () => {
    expect(validateInventoryShape({ slots: [slot()] }).join('\n')).toContain('format');
  });

  it('描画される枠に area が無ければエラー', () => {
    expect(validateInventoryShape(inventory([slot({ area: null })])).join('\n')).toContain('area');
  });

  it('描画される枠に alt が無ければエラー', () => {
    expect(validateInventoryShape(inventory([slot({ alt: null })])).join('\n')).toContain('alt');
  });

  it('描画されない枠は area / alt が null でよい', () => {
    const dead = slot({ rendered: false, area: null, alt: null });
    expect(validateInventoryShape(inventory([dead]))).toEqual([]);
  });

  it('知らない alt の作り方はエラー', () => {
    expect(validateInventoryShape(inventory([slot({ alt: 'caption' })])).join('\n')).toContain(
      'alt',
    );
  });

  it('場所の名前の形が崩れていればエラー', () => {
    expect(validateInventoryShape(inventory([slot({ area: 'Articles!' })])).join('\n')).toContain(
      'area',
    );
  });

  it('同じ文書の型で場所が分かれていればエラー', () => {
    const a = slot();
    const b = slot({ id: 'sanity:article:thumbnail', path: 'thumbnail', area: 'journal' });
    expect(validateInventoryShape(inventory([a, b])).join('\n')).toContain('area が分かれている');
  });
});

describe('check:image-slots ゲート (子プロセス実行)', () => {
  it('宣言とスキーマが一致していれば exit 0', () => {
    const { code, output } = runGate();
    expect(output).toContain('image-slots: OK');
    expect(code).toBe(0);
  });

  it('[壊し方: 属性を落とす] 描画される枠から area を落とすと exit 1', () => {
    const { code, output } = withInventory((raw) => {
      const s = raw.slots.find((x) => x.id === 'sanity:article:body[].image');
      if (!s) throw new Error('sanity:article:body[].image が無い');
      delete s.area;
    });
    expect(code).toBe(1);
    expect(output).toContain('sanity:article:body[].image');
  });

  it('[壊し方: 属性を落とす] 描画される枠から alt を落とすと exit 1', () => {
    const { code, output } = withInventory((raw) => {
      delete raw.slots.find((x) => x.rendered === true)?.alt;
    });
    expect(code).toBe(1);
    expect(output).toContain('alt');
  });

  it('[壊し方: 消す] 宣言から 1 欄消すと exit 1', () => {
    const { code, output } = withInventory((raw) => {
      raw.slots = raw.slots.filter((x) => x.id !== 'sanity:teaMenu:photo');
    });
    expect(code).toBe(1);
    expect(output).toContain('sanity:teaMenu:photo');
  });

  it('[壊し方: 足す] スキーマに無い欄を宣言に足すと exit 1', () => {
    const { code, output } = withInventory((raw) => {
      raw.slots.push(
        slot({ id: 'sanity:zzz:photo', documentType: 'zzz', path: 'photo', area: 'zzz' }),
      );
    });
    expect(code).toBe(1);
    expect(output).toContain('sanity:zzz:photo');
  });

  it('[壊し方: 名前を変える] 欄の id を変えると exit 1', () => {
    const { code, output } = withInventory((raw) => {
      const s = raw.slots.find((x) => x.id === 'sanity:playlist:albumImage');
      if (!s) throw new Error('sanity:playlist:albumImage が無い');
      s.id = 'sanity:playlist:albumPhoto';
      s.path = 'albumPhoto';
    });
    expect(code).toBe(1);
    expect(output).toContain('sanity:playlist:albumImage');
  });

  it('[壊し方: 手で崩す] 書き方の版を消すと exit 1', () => {
    const { code, output } = withInventory((raw) => {
      delete raw.format;
    });
    expect(code).toBe(1);
    expect(output).toContain('format');
  });
});
