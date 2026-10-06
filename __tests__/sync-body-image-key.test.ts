/**
 * 段3設計 9節 U7c: 同期 (scripts/sync-notion-to-sanity.ts) が記事の本文の画像の _key に Notion のブロックの id を残す。
 * Asset hub の配信の枠 `article:<slug>:body-<ブロックの id 32 桁>` と同じ形 (ハイフンを除いた小文字の 16 進 32 桁)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bodyImageKeyOf } from '../scripts/lib/notion-block-key';

describe('本文の画像の _key (Notion のブロックの id)', () => {
  it('ブロックの id をハイフンを除いた小文字の 32 桁にする。形でなければ null', () => {
    expect(bodyImageKeyOf('1111AAAA-2222-bbbb-3333-cccc4444dddd')).toBe('1111aaaa2222bbbb3333cccc4444dddd');
    expect(bodyImageKeyOf('1111aaaa2222bbbb3333cccc4444dddd')).toBe('1111aaaa2222bbbb3333cccc4444dddd');
    expect(bodyImageKeyOf('1111aaaa')).toBeNull();
    expect(bodyImageKeyOf(undefined)).toBeNull();
  });

  it('同期の画像のブロックは、時刻の _key (genKey) でなく、ブロックの id の _key を使う', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-notion-to-sanity.ts'), 'utf8');
    const imageCase = src.slice(src.indexOf('case "image": {'), src.indexOf('case "divider": {'));
    expect(imageCase.length).toBeGreaterThan(0);
    expect(imageCase).not.toMatch(/_key:\s*genKey\(\)/);
    expect(imageCase).toMatch(/bodyImageKeyOf\(block\.id\)/);
    expect(imageCase.match(/_key: imageKey/g)?.length).toBe(2);
  });
});
