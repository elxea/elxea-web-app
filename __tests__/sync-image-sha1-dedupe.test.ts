/**
 * 写真の仕組み 段5 (ID-9785): 同期が同じ中身の画像を上げ直さない。
 *
 * 同じバイトを `client.assets.upload` に渡すと、Sanity は同じ _id を返すが資産の文書を書き直す。
 * そのたびに originalFilename が同期の名前に替わり、Asset hub の配信が付けた札
 * (資産の source {name:'asset-hub', id, url}) が消えていた (1 回の同期で、その回が扱う画像の資産すべて。
 * 2026-10-07 の回で 24 件。Sanity の画像の資産の総数 143 件のうち同期が扱う分)。
 * 守りたい性質: 同じ sha1 の資産がもうあるなら upload を呼ばず、その _id を返す。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SanityClient } from 'next-sanity';
import { uploadImageToSanity } from '../scripts/lib/sanity-image-upload';

const BYTES = Buffer.from('elxea-test-image-bytes');
const SHA1 = createHash('sha1').update(BYTES).digest('hex');
const EXISTING_ID = `image-${SHA1}-2400x1602-jpg`;
const IMAGE_URL = 'https://example.invalid/notion/image.jpg';

function fakeClient(fetchImpl: (query: string, params: Record<string, unknown>) => Promise<unknown>) {
  const fetch = vi.fn(fetchImpl);
  const upload = vi.fn(async () => ({ _id: 'image-uploaded-1x1-jpg' }));
  const client = { fetch, assets: { upload } } as unknown as SanityClient;
  return { client, fetch, upload };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(BYTES, { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('uploadImageToSanity (同じ中身を上げ直さない)', () => {
  it('同じ sha1 の資産がある → upload を呼ばず、既存の _id を返す', async () => {
    const { client, fetch, upload } = fakeClient(async () => EXISTING_ID);

    const ref = await uploadImageToSanity(client, IMAGE_URL, 'some-slug-header');

    expect(ref).toEqual({ _type: 'reference', _ref: EXISTING_ID });
    expect(upload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [query, params] = fetch.mock.calls[0];
    expect(query).toBe('*[_type=="sanity.imageAsset" && sha1hash==$sha][0]._id');
    expect(params).toEqual({ sha: SHA1 });
  });

  it('同じ sha1 の資産が無い → 今までどおり upload を呼ぶ', async () => {
    const { client, fetch, upload } = fakeClient(async () => null);

    const ref = await uploadImageToSanity(client, IMAGE_URL, 'some-slug-header');

    expect(fetch).toHaveBeenCalledWith(expect.any(String), { sha: SHA1 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith('image', BYTES, { filename: 'some-slug-header' });
    expect(ref).toEqual({ _type: 'reference', _ref: 'image-uploaded-1x1-jpg' });
  });

  it('照会が失敗 → 同期を止めずに upload を呼び、その事実をログに 1 行出す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, fetch, upload } = fakeClient(async () => {
      throw new Error('query timeout');
    });

    const ref = await uploadImageToSanity(client, IMAGE_URL);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith('image', BYTES, { filename: 'notion-image' });
    expect(ref).toEqual({ _type: 'reference', _ref: 'image-uploaded-1x1-jpg' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(SHA1);
    // 署名つきの Notion の画像の URL はログに出さない (Actions のログは公開)
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(IMAGE_URL);
  });

  it('上げるのに失敗 → null を返し、ログには URL でなくホスト名と sha1 を出す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient(async () => null);
    (client.assets.upload as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error(`upload refused for ${IMAGE_URL}`),
    );

    const ref = await uploadImageToSanity(client, IMAGE_URL);

    expect(ref).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain(IMAGE_URL);
    expect(logged).toContain('example.invalid');
    expect(logged).toContain(SHA1);
  });

  it('画像を取るのに失敗 (sha1 がまだ無い) → null を返し、ログには URL でなくホスト名を出す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`fetch failed: ${IMAGE_URL}`);
      }),
    );
    const { client, upload } = fakeClient(async () => null);

    const ref = await uploadImageToSanity(client, IMAGE_URL);

    expect(ref).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    const logged = error.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain(IMAGE_URL);
    expect(logged).toContain('example.invalid');
  });

  it('同期の本体は assets.upload を直接呼ばず、3 か所ともこの関数を通る', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-notion-to-sanity.ts'), 'utf8');
    expect(src).not.toMatch(/assets\.upload\(/);
    expect(src).toMatch(/import \{ uploadImageToSanity \} from "\.\/lib\/sanity-image-upload";/);
    expect(src.match(/await uploadImageToSanity\(/g)?.length).toBe(3);
  });
});
