import { cache } from "react";

import { getSellingPlanGroups } from "@/lib/shopify/subscription-admin";
import {
  FALLBACK_FREQUENCY_OPTIONS,
  deriveFrequencyOptions,
  type FrequencyOption,
} from "@/lib/subscription-view";

/**
 * お届け頻度の選択肢を Shopify の実データから読む (サーバ専用)。
 *
 * 画面に並べる頻度は「ストアに実在する selling plan」だけにする。ハードコード
 * していた頃は毎週 / 隔週が並び、顧客が選ぶと必ず失敗した (実在は毎月 /
 * 2ヶ月ごと / 3ヶ月ごとの 3 プラン)。
 *
 * 1 リクエスト内は React `cache` で 1 回だけ問い合わせる。Admin API の認証情報が
 * 無い / 失敗した場合は {@link FALLBACK_FREQUENCY_OPTIONS} に退避し、画面が
 * 落ちたり選択肢ゼロになったりしないようにする。
 */
export const getAvailableFrequencyOptions = cache(
  async (): Promise<FrequencyOption[]> => {
    try {
      const groups = await getSellingPlanGroups();
      const options = deriveFrequencyOptions(groups);
      if (options.length > 0) return options;
      console.warn(
        "[subscriptionFrequencies] 継続課金の selling plan が見つからないためフォールバックを使う"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn(
        `[subscriptionFrequencies] Shopify から読めないためフォールバックを使う: ${message}`
      );
    }
    return [...FALLBACK_FREQUENCY_OPTIONS];
  }
);
