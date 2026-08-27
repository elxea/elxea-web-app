/**
 * 「いま繋ごうとしている Firestore は、本番か・手元のエミュレーターか」を 1 か所で決める。
 *
 * ## なぜ要るか
 *
 * これまで `lib/firebase/admin.ts` は「資格情報が env に在れば繋ぐ」だけだった。
 * `.env.local` には本番のサービスアカウントが入っているので、**手元で `pnpm dev` を
 * 叩いた瞬間に本番 Firestore へ書いていた**。読みは気づけないし、書きは戻せない。
 * 「テスト用 DB がローカルに無い」という話の本体はここで、置き場所の問題ではなく
 * **既定の向き先の問題**だった。
 *
 * そこで既定を反転させる。手元では「本番へ繋がない」が既定で、繋ぎたいなら明示的に
 * そう言わせる（fail-closed）。エミュレーターが立っていればそちらへ向く。
 *
 * ## 判定の順番（この順番自体が仕様）
 *
 *   1. `FIRESTORE_EMULATOR_HOST` が立っている → エミュレーター。資格情報は要らない
 *   2. 本番ランタイム（`NODE_ENV=production` / Vercel）→ 本番。**ここは従来と一切同じ**
 *   3. `ALLOW_PRODUCTION_FIRESTORE=1` → 本番。手元から本番を触る唯一の入口
 *   4. それ以外（＝手元）→ throw
 *
 * 2 を 3 より先に見るのが肝。本番の経路には新しい条件を 1 つも足していないので、
 * デプロイ済みのアプリの挙動はこの変更前後で変わらない。
 *
 * ## CI をわざと素通りさせていない理由
 *
 * CI に本番の資格情報は置いていないので、CI はそもそも 4 に届く前に
 * 「資格情報が無い」で落ちる（`admin.ts` がこの判定より先に資格情報を見る）。
 * つまり今の CI の挙動は変わらない。将来 CI に資格情報を置く人が現れたときは、
 * 素通りさせるより 3 を明示的に書かせたほうが安全なので、CI の例外は作らない。
 */

import { envSnapshot } from "@/lib/config";

/** 手元から本番 Firestore へ繋ぐことを明示的に許すフラグ（サーバー側）。 */
export const ALLOW_PRODUCTION_ENV = "ALLOW_PRODUCTION_FIRESTORE";

/** 同じことをブラウザ側で言うためのフラグ。`NEXT_PUBLIC_` が要るので別名になる。 */
export const ALLOW_PRODUCTION_ENV_CLIENT = "NEXT_PUBLIC_ALLOW_PRODUCTION_FIRESTORE";

/** エミュレーターの待ち受け先（サーバー側）。Admin SDK が公式に見る名前。 */
export const EMULATOR_HOST_ENV = "FIRESTORE_EMULATOR_HOST";

/** 同じことをブラウザ側で言うための名前。 */
export const EMULATOR_HOST_ENV_CLIENT = "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST";

/**
 * エミュレーターに使う project id。本物の project id は使わない。
 * `demo-` で始まる id は、エミュレーターが「実サービスへは絶対に出て行かない」と
 * 扱う予約済みの形（Firebase の仕様）。取り違えの余地を消すためにこれを既定にする。
 */
export const DEFAULT_EMULATOR_PROJECT_ID = "demo-elxea";

export type FirestoreTarget =
  | { kind: "emulator"; host: string; projectId: string }
  | { kind: "production" };

type EnvLike = Record<string, string | undefined>;

/** 手元で本番へ繋ごうとしたときに投げる型。呼び側が握り分けられるように名前を付ける。 */
export class LocalFirestoreGuardError extends Error {
  readonly code = "LOCAL_FIRESTORE_GUARD";

  constructor(message: string) {
    super(message);
    this.name = "LocalFirestoreGuardError";
  }
}

function readTrimmed(env: EnvLike, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 本番として動いているランタイムか。ここが true の経路は従来と同じ扱いにする。 */
export function isProductionRuntime(env: EnvLike): boolean {
  return env.NODE_ENV === "production" || Boolean(readTrimmed(env, "VERCEL"));
}

function guardMessage(side: "server" | "client"): string {
  const hostEnv = side === "server" ? EMULATOR_HOST_ENV : EMULATOR_HOST_ENV_CLIENT;
  const allowEnv = side === "server" ? ALLOW_PRODUCTION_ENV : ALLOW_PRODUCTION_ENV_CLIENT;

  return [
    "本番 Firestore への接続を止めました（手元では既定で繋ぎません）。",
    "",
    "資格情報は揃っているので、このまま進むと本番のデータを読み書きします。",
    "手元の開発とテストは本番と切り離す約束なので、ここで止めています。",
    "",
    "どれかを選んでください:",
    `  1. エミュレーターを使う（推奨）  … pnpm emulator:start を別のターミナルで立てて、pnpm dev:emulator`,
    `  2. 偽 Firestore を使う          … E2E_FIRESTORE_STUB=1 pnpm dev（プロセス内・保存されない）`,
    `  3. 本当に本番へ繋ぐ              … ${allowEnv}=1 を明示的に付けて起動`,
    "",
    `（1 を選ぶと ${hostEnv} が立ち、この判定はエミュレーターへ向きます）`,
  ].join("\n");
}

/**
 * サーバー側（Admin SDK）の向き先を決める。
 * 手元で本番へ向かおうとしたら {@link LocalFirestoreGuardError} を投げる。
 *
 * `env` 引数はテストが差し込むための seam なので残す。既定値だけを `process.env` から
 * `envSnapshot()`（`lib/config/spec.ts` の literal read 経由の正規化済みスナップショット）
 * に移した。
 */
export function resolveServerFirestoreTarget(env: EnvLike = envSnapshot()): FirestoreTarget {
  const host = readTrimmed(env, EMULATOR_HOST_ENV);
  if (host) {
    return {
      kind: "emulator",
      host,
      projectId:
        readTrimmed(env, "FIRESTORE_EMULATOR_PROJECT_ID") ?? DEFAULT_EMULATOR_PROJECT_ID,
    };
  }

  if (isProductionRuntime(env)) return { kind: "production" };
  if (readTrimmed(env, ALLOW_PRODUCTION_ENV) === "1") return { kind: "production" };

  throw new LocalFirestoreGuardError(guardMessage("server"));
}

/**
 * ブラウザ側（Client SDK）の向き先を決める。
 *
 * ブラウザには `VERCEL` が渡らない（`NEXT_PUBLIC_` が付いていない env は
 * バンドルに入らない）ので、本番判定は `NODE_ENV` だけで行う。Next はクライアント
 * ビルドで `process.env.NODE_ENV` を "production" に畳むため、本番バンドルでは
 * この分岐ごと消える。
 *
 * `env` 引数はテストが差し込む seam なので残し、既定値だけ `envSnapshot()` にした。
 * これは挙動の修正でもある: 既定が `process.env` だった頃、下の `EMULATOR_HOST_ENV_CLIENT`
 * は動的な `env[name]` 添字で読まれていたため Next のビルド時インライン化に当たらず、
 * ブラウザでは常に undefined だった（= クライアント側エミュレーター分岐が発火しなかった）。
 * `envSnapshot()` は spec.ts の literal read 経由なので、ブラウザでも値が届く。
 */
export function resolveClientFirestoreTarget(env: EnvLike = envSnapshot()): FirestoreTarget {
  const host = readTrimmed(env, EMULATOR_HOST_ENV_CLIENT);
  if (host) {
    return {
      kind: "emulator",
      host,
      projectId:
        readTrimmed(env, "NEXT_PUBLIC_FIREBASE_PROJECT_ID") ?? DEFAULT_EMULATOR_PROJECT_ID,
    };
  }

  if (env.NODE_ENV === "production") return { kind: "production" };
  if (readTrimmed(env, ALLOW_PRODUCTION_ENV_CLIENT) === "1") return { kind: "production" };

  throw new LocalFirestoreGuardError(guardMessage("client"));
}

/** `host:port` を分解する。ポートが読めない指定は誤設定なので黙って進めない。 */
export function splitEmulatorHost(host: string): { host: string; port: number } {
  const match = /^(?:https?:\/\/)?(\[[^\]]+\]|[^:]+):(\d+)$/.exec(host);
  if (!match) {
    throw new LocalFirestoreGuardError(
      `${EMULATOR_HOST_ENV} / ${EMULATOR_HOST_ENV_CLIENT} は "host:port" の形で指定してください（受け取った値: ${host}）。`,
    );
  }
  return { host: match[1], port: Number(match[2]) };
}
