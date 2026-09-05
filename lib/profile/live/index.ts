/**
 * `PROFILE_DATA_SOURCE=live` のときに使う `ProfileSource` 実装 (判断点 D11 = R-a)。
 *
 * ## なぜ cx-agent 経由なのか
 *
 * このアプリは Supabase クライアントを持たない (`lib/cdp/events-gateway-client.ts`
 * の冒頭コメントに明記)。読み取りも書き込みと同じ非対称性を保ち、Supabase の
 * 鍵を 1 リポに閉じるため、cx-agent (Cloudflare Worker) の
 * `GET /api/profile/{self,field,words}` を叩く。
 *
 * ## 段1時点の状態 (未実施・重要)
 *
 * cx-agent 側のハンドラ実装 (集計・約300行, D11 の見積り) は **本 PR の範囲外**。
 * このクライアントは 404 / 到達不能を「まだ実装されていない」として静かに
 * 空へ倒す (欠損時の振る舞いと同じ経路)。よって現状 `PROFILE_DATA_SOURCE=live`
 * は常に `empty` / `quiet` を返す。本番で意味のある値を返すには、cx-agent 側の
 * ハンドラ実装が別タスクとして必要 (Spec 追記「D11」参照)。
 *
 * ## 失敗しても画面を壊さない
 *
 * `sendToEventsGateway` (書き込み側) と同じ方針: 到達不能・タイムアウト・非2xx
 * はすべて握って欠損応答を返す。ただし握ったことは残す (404 は「未実装」なので
 * 静かに無視し、それ以外はログに残す)。
 */

import "server-only";

import { env } from "@/lib/config";
import { logger } from "@/lib/log";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import type { ProfileSource } from "@/lib/profile/source";
import type {
  ProfileFieldParams,
  ProfileFieldResponse,
  ProfileSelfParams,
  ProfileSelfResponse,
  ProfileWordsParams,
  ProfileWordsResponse,
} from "@/lib/profile/contract";

const REQUEST_TIMEOUT_MS = 3_000;

export class LiveSource implements ProfileSource {
  readonly kind = "live" as const;

  async getSelf(params: ProfileSelfParams): Promise<ProfileSelfResponse> {
    const empty: ProfileSelfResponse = {
      source: "live",
      facet: "tea",
      category: params.category,
      centroid: null,
      spread: null,
      basis: { cups: 0, teas: 0, category: params.category },
      details: [],
      state: "empty",
    };
    const qs = new URLSearchParams({ facet: "tea", category: params.category, userKey: params.userKey });
    const data = await fetchCxAgentProfile<ProfileSelfResponse>(`/api/profile/self?${qs.toString()}`);
    return data ?? empty;
  }

  async getField(params: ProfileFieldParams): Promise<ProfileFieldResponse> {
    const quiet: ProfileFieldResponse = {
      source: "live",
      facet: params.facet,
      category: params.category,
      state: "quiet",
      cohort: 0,
      grid: null,
      levels: [],
      bbox: [0, 0, 0, 0],
    };
    const qs = new URLSearchParams({ facet: params.facet, z: String(params.z) });
    if (params.category) qs.set("category", params.category);
    const data = await fetchCxAgentProfile<ProfileFieldResponse>(`/api/profile/field?${qs.toString()}`);
    return data ?? quiet;
  }

  async getWords(params: ProfileWordsParams): Promise<ProfileWordsResponse> {
    const empty: ProfileWordsResponse = {
      source: "live",
      facet: params.facet,
      category: params.category,
      general: [],
      shared: [],
      personal: [],
    };
    const qs = new URLSearchParams({ facet: params.facet, bbox: params.bbox.join(",") });
    if (params.category) qs.set("category", params.category);
    if (params.userKey) qs.set("userKey", params.userKey);
    const data = await fetchCxAgentProfile<ProfileWordsResponse>(`/api/profile/words?${qs.toString()}`);
    return data ?? empty;
  }
}

async function fetchCxAgentProfile<T>(path: string): Promise<T | null> {
  const secret = env("SYNC_API_SECRET");
  try {
    const res = await fetch(`${CX_AGENT_BASE_URL}${path}`, {
      headers: secret ? { "X-API-Key": secret } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 は「cx-agent 側がまだ実装していない」の想定内経路 (段1時点の既知の状態)。
      // それ以外は残す (障害を静かに落とす経路をもう1本増やさない)。
      if (res.status !== 404) {
        logger.error(
          "profile.live-source.rejected",
          new Error(`cx-agent responded ${res.status}`),
          { path, status: res.status },
        );
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.error("profile.live-source.unreachable", err, { path });
    return null;
  }
}
