/**
 * 「人気の記事」の失敗が**無言で消えない**ことの回帰テスト。
 *
 * 元の実装は集計失敗を `catch { return [] }` で握り潰していた。Firestore の
 * 複合インデックスは `firestore.indexes.json` を書いてもアプリのデプロイでは
 * 反映されないため、未反映のあいだサイドバーの「人気の記事」がエラーも出さずに
 * 空になる = 検知手段のない失敗になっていた (QA 指摘 / 2026-08-12)。
 *
 * ここで固定する契約:
 * 1. 失敗しても例外は投げない (画面は落とさない) / 返り値は空配列
 * 2. 失敗の理由を分類してサーバーログに残す (何が起きて画面がどう見えるか)
 * 3. 運用上の異常 (索引未反映・権限不足・想定外) は Sentry に送る
 * 4. ローカル / プレビューの資格情報なし (`not-configured`) は Sentry に送らない
 *    (送るとノイズで本当の異常が埋もれる)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

// `unstable_cache` は Next のリクエスト文脈を要求するので素通しに置き換える。
// キャッシュの有無は本テストの関心事ではない (関心は失敗時の観測性)。
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

const getAdminFirestore = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => getAdminFirestore(),
}));

import {
  classifyPopularArticlesFailure,
  getPopularArticles,
  reportPopularArticlesFailure,
} from "@/lib/journal/popular-articles";

/** Firestore が索引不足で返す例外の形 (gRPC code 9 + 索引作成 URL 付き文言)。 */
function missingIndexError(): Error & { code: number } {
  const error = new Error(
    "9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/project/x/firestore/indexes?create_composite=abc"
  ) as Error & { code: number };
  error.code = 9;
  return error;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captureException.mockClear();
  getAdminFirestore.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("classifyPopularArticlesFailure", () => {
  it("索引未反映 (FAILED_PRECONDITION + index) を missing-index と判定する", () => {
    expect(classifyPopularArticlesFailure(missingIndexError())).toBe("missing-index");
  });

  it("code が無くても索引作成を促す文言なら missing-index と判定する", () => {
    expect(
      classifyPopularArticlesFailure(new Error("The query requires an index."))
    ).toBe("missing-index");
  });

  it("同じ FAILED_PRECONDITION でも索引と無関係なら unknown に倒す", () => {
    const error = new Error("9 FAILED_PRECONDITION: database is being restored") as Error & {
      code: number;
    };
    error.code = 9;
    expect(classifyPopularArticlesFailure(error)).toBe("unknown");
  });

  it("Firebase Admin の env 不足を not-configured と判定する", () => {
    expect(
      classifyPopularArticlesFailure(
        new Error(
          "Firebase Admin SDK: missing required env vars. projectId=false, clientEmail=false, privateKey=false"
        )
      )
    ).toBe("not-configured");
  });

  it("権限不足を permission と判定する", () => {
    const error = new Error("7 PERMISSION_DENIED: Missing or insufficient permissions") as Error & {
      code: number;
    };
    error.code = 7;
    expect(classifyPopularArticlesFailure(error)).toBe("permission");
  });

  it("分類できないものは unknown (例外にはしない)", () => {
    expect(classifyPopularArticlesFailure(new Error("socket hang up"))).toBe("unknown");
    expect(classifyPopularArticlesFailure(undefined)).toBe("unknown");
  });
});

describe("reportPopularArticlesFailure", () => {
  it("原因と画面への影響をサーバーログに残す", () => {
    reportPopularArticlesFailure(missingIndexError());

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain("[popular-articles]");
    // 「空で表示される」= 画面上どう見えるかがログだけで分かること。
    expect(message).toContain("空で表示されます");
    expect(message).toContain("missing-index");
  });

  it("索引未反映は Sentry に理由タグ付きで送る", () => {
    reportPopularArticlesFailure(missingIndexError());

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, context] = captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(context.tags).toMatchObject({
      feature: "journal-popular-articles",
      reason: "missing-index",
    });
    // 「次に何をするか」が通知だけで分かること。
    expect(String(context.extra.nextAction)).toContain("firestore.indexes.json");
  });

  it("資格情報なし (ローカル / プレビュー) は Sentry に送らずログだけに残す", () => {
    reportPopularArticlesFailure(
      new Error("Firebase Admin SDK: missing required env vars. projectId=false")
    );

    expect(captureException).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("not-configured");
  });
});

describe("getPopularArticles の失敗時", () => {
  it("例外を投げず空配列を返し、かつ黙らない", async () => {
    getAdminFirestore.mockImplementation(() => {
      throw missingIndexError();
    });

    await expect(getPopularArticles(5)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("limit が 0 以下なら問い合わせず、失敗でもないので通知もしない", async () => {
    await expect(getPopularArticles(0)).resolves.toEqual([]);
    expect(getAdminFirestore).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
