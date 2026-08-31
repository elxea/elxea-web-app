/**
 * site-slots-schema.ts — 画像枠宣言の「形」と「検査述語」だけを持つ。
 *
 * `lib/site-slots.ts` から分けてあるのは 1 点の理由による: 生成スクリプト
 * (`scripts/gen-site-slots.ts`) がこの検査述語を使うが、`lib/site-slots.ts` は
 * 生成物 `lib/site-slots.generated.ts` を import する。同じファイルに置くと
 * 「生成物が無いと生成できない」ブートストラップの循環になる。
 *
 * ここは値をひとつも持たない — SoT は `public/site-slots.manifest.json` だけ。
 * 述語は特定の枠をハードコードせず、実物を読んで検査する。
 */

/** 収め方。cover = はみ出しを切る / contain = 切らずに収める (余白が付く)。 */
export type SiteSlotFit = 'cover' | 'contain';

/** 縦横比。表示上の比であって、素材の実寸ではない。 */
export interface SiteSlotRatio {
  width: number;
  height: number;
}

/**
 * 表示場所 — その枠が実際に画面に出る 1 つの見え方。
 *
 * 1 枠が複数持つ (SP と PC で比率が違う等)。「チャネルに 1 つの比率」ではないのは、
 * 同じ写真が場所ごとに違う切られ方をするから。
 */
export interface SiteSlotSurface {
  id: string;
  label: string;
  ratio: SiteSlotRatio;
  fit: SiteSlotFit;
}

/** 枠 1 件。 */
export interface SiteSlot {
  /** `site:<page>:<slot>`。 */
  id: string;
  /** 画面に出す表示名。 */
  label: string;
  /** どのページか (`site:<page>:...` の page と一致させる)。 */
  page: string;
  /** 必須枠か。false = 空でも運用が成り立つ枠。 */
  required: boolean;
  /** 並び順。配列順への暗黙依存をやめるために持つ。 */
  order: number;
  surfaces: SiteSlotSurface[];
  /** 有効期間 (任意・ISO 8601 の日付)。省略時は常時有効。 */
  validFrom?: string;
  validTo?: string;
}

/** manifest 全体。 */
export interface SiteSlotsManifest {
  version: number;
  org: string;
  slots: SiteSlot[];
}

/** 枠 id の形式。`site:<page>:<slot>` のみ受け付ける。 */
export const SITE_SLOT_ID_PATTERN = /^site:[a-z0-9-]+:[a-z0-9-]+$/;

/**
 * manifest の中身を検査して、見つかった問題を文字列で返す (空配列 = 問題なし)。
 *
 * ここは「実物を読んで検査する述語」であって、特定の枠の値をハードコードしない。
 * 呼び出し側は `scripts/check-site-slots.ts` (build ゲート) と単体テスト。
 */
export function validateSiteSlotsManifest(raw: unknown): string[] {
  const errors: string[] = [];
  const push = (msg: string) => errors.push(msg);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['manifest がオブジェクトではありません'];
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) {
    push('version は 1 以上の整数である必要があります');
  }
  if (typeof m.org !== 'string' || m.org.length === 0) {
    push('org は空でない文字列である必要があります');
  }
  if (!Array.isArray(m.slots)) {
    return [...errors, 'slots は配列である必要があります'];
  }

  const seenIds = new Set<string>();
  const seenOrders = new Map<number, string>();

  m.slots.forEach((rawSlot, i) => {
    const where = `slots[${i}]`;
    if (!rawSlot || typeof rawSlot !== 'object' || Array.isArray(rawSlot)) {
      push(`${where}: オブジェクトではありません`);
      return;
    }
    const s = rawSlot as Record<string, unknown>;
    const id = s.id;

    if (typeof id !== 'string' || !SITE_SLOT_ID_PATTERN.test(id)) {
      push(`${where}: id は "site:<page>:<slot>" 形式である必要があります (見つかった値: ${JSON.stringify(id)})`);
    } else {
      if (seenIds.has(id)) push(`${where}: id "${id}" が重複しています`);
      seenIds.add(id);
      const page = id.split(':')[1];
      if (typeof s.page === 'string' && s.page !== page) {
        push(`${where}: page "${String(s.page)}" が id の page 部 "${page}" と一致しません`);
      }
    }

    if (typeof s.label !== 'string' || s.label.trim().length === 0) {
      push(`${where}: label は空でない文字列である必要があります`);
    }
    if (typeof s.page !== 'string' || s.page.trim().length === 0) {
      push(`${where}: page は空でない文字列である必要があります`);
    }
    if (typeof s.required !== 'boolean') {
      push(`${where}: required は boolean である必要があります`);
    }
    if (typeof s.order !== 'number' || !Number.isFinite(s.order)) {
      push(`${where}: order は数値である必要があります`);
    } else {
      const dup = seenOrders.get(s.order);
      if (dup !== undefined) {
        push(`${where}: order ${s.order} が "${dup}" と重複しています`);
      }
      seenOrders.set(s.order, typeof id === 'string' ? id : where);
    }

    for (const key of ['validFrom', 'validTo'] as const) {
      const v = s[key];
      if (v === undefined) continue;
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
        push(`${where}: ${key} は ISO 8601 の日付文字列である必要があります`);
      }
    }
    if (typeof s.validFrom === 'string' && typeof s.validTo === 'string') {
      if (Date.parse(s.validFrom) > Date.parse(s.validTo)) {
        push(`${where}: validFrom が validTo より後になっています`);
      }
    }

    if (!Array.isArray(s.surfaces) || s.surfaces.length === 0) {
      push(`${where}: surfaces は 1 件以上の配列である必要があります`);
      return;
    }
    const seenSurfaceIds = new Set<string>();
    s.surfaces.forEach((rawSurface, j) => {
      const sw = `${where}.surfaces[${j}]`;
      if (!rawSurface || typeof rawSurface !== 'object' || Array.isArray(rawSurface)) {
        push(`${sw}: オブジェクトではありません`);
        return;
      }
      const su = rawSurface as Record<string, unknown>;
      if (typeof su.id !== 'string' || su.id.trim().length === 0) {
        push(`${sw}: id は空でない文字列である必要があります`);
      } else {
        if (seenSurfaceIds.has(su.id)) push(`${sw}: surface id "${su.id}" が枠内で重複しています`);
        seenSurfaceIds.add(su.id);
      }
      if (typeof su.label !== 'string' || su.label.trim().length === 0) {
        push(`${sw}: label は空でない文字列である必要があります`);
      }
      if (su.fit !== 'cover' && su.fit !== 'contain') {
        push(`${sw}: fit は "cover" か "contain" である必要があります`);
      }
      const r = su.ratio;
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        push(`${sw}: ratio はオブジェクトである必要があります`);
        return;
      }
      const ratio = r as Record<string, unknown>;
      for (const key of ['width', 'height'] as const) {
        const v = ratio[key];
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          push(`${sw}: ratio.${key} は正の数である必要があります`);
        }
      }
    });
  });

  return errors;
}
