/**
 * デグレ検知テスト: 「検査は緑を返すが、実際には何も見ていない」形を機械的に禁じる。
 *
 * 背景 (2026-08-18 の事故)
 * ------------------------
 * 本番が 259 commit / 14 時間古いまま誰も気づかなかった。原因は監視そのものではなく、
 * 監視の *結果を受け取る配線* が壊れていたこと — `node monitor.mjs | tee out.json` と
 * 書くと、GitHub Actions の既定シェル (`bash -e`) には `pipefail` が無いため
 * スクリプトの終了コードが `tee` の終了コード (常に 0) に吸われ、step は緑になる。
 *
 * 個別に直しても同じ書き方はまた生える。よってここで «形» を禁じる。
 * 本ファイルは vitest (unit-tests job) で走るので ci.yml を触らずに常時強制できる。
 *
 * 検知する 2 形
 * -------------
 *  A. workflow の `run:` にパイプがあるのに pipefail が効いていない (終了コードの握り潰し)
 *  B. e2e が「対象が 0 件」を理由に skip している (壊れたら赤ではなく灰色になる)
 *
 * どちらも allowlist 方式にはしていない。抜け道が必要になった時点で、
 * その抜け道自体をここに書いて理由を残すこと。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const workflowDir = path.join(repoRoot, ".github", "workflows");
const e2eDir = path.join(repoRoot, "e2e");

/** `run: |` ブロックを 1 step 分ずつ、その step の `shell:` 指定つきで取り出す。 */
type RunBlock = { file: string; line: number; body: string; shell: string | null };

function extractRunBlocks(file: string): RunBlock[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const blocks: RunBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(- )?run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/.exec(lines[i]);
    if (!m) continue;

    const indent = m[1].length + (m[2] ? m[2].length : 0);
    const inlineTail = m[4] ?? "";
    const bodyLines: string[] = inlineTail ? [inlineTail] : [];

    // ブロックスカラーなら、より深いインデントが続く限り本体。
    if (m[3]) {
      for (let j = i + 1; j < lines.length; j++) {
        const raw = lines[j];
        if (raw.trim() === "") {
          bodyLines.push("");
          continue;
        }
        const curIndent = raw.length - raw.trimStart().length;
        if (curIndent <= indent) break;
        bodyLines.push(raw);
      }
    }

    // 同じ step の `shell:` を探す (run: の前後どちらにも書ける)。
    // step の境界は同じインデントの `- ` 始まり。
    let shell: string | null = null;
    for (let j = i; j >= 0; j--) {
      const raw = lines[j];
      if (raw.trim() === "") continue;
      const curIndent = raw.length - raw.trimStart().length;
      if (j !== i && curIndent < indent) break;
      const sm = /^\s*shell:\s*(\S+)/.exec(raw);
      if (sm) { shell = sm[1]; break; }
      if (j !== i && /^\s*- /.test(raw)) break;
    }
    if (!shell) {
      for (let j = i + 1; j < lines.length; j++) {
        const raw = lines[j];
        if (raw.trim() === "") continue;
        const curIndent = raw.length - raw.trimStart().length;
        if (curIndent < indent) break;
        if (/^\s*- /.test(raw)) break;
        const sm = /^\s*shell:\s*(\S+)/.exec(raw);
        if (sm) { shell = sm[1]; break; }
      }
    }

    blocks.push({ file, line: i + 1, body: bodyLines.join("\n"), shell });
    i += bodyLines.length;
  }

  return blocks;
}

/**
 * 「終了コードが握り潰されるパイプ」か。
 *
 * `a | b` を含むのに、その run ブロックで pipefail が有効化されていないものを拾う。
 * `||` (論理和) と、リダイレクト `|&` は対象外。行頭が `#` のコメント行も除外する。
 */
function hasUnguardedPipe(block: RunBlock): boolean {
  const codeLines = block.body
    .split("\n")
    .map((l) => l.replace(/^\s*/, ""))
    .filter((l) => l && !l.startsWith("#"));

  const piped = codeLines.some((l) => /[^|]\|[^|&]/.test(l));
  if (!piped) return false;

  // pipefail が効く条件は 2 つあり、どちらか一方でも足りない:
  //  - `shell: bash` (= bash --noprofile --norc -eo pipefail {0}) を明示している
  //  - 本体で `set -o pipefail` / `set -euo pipefail` 等を自分で立てている
  const explicitBashShell = block.shell === "bash";
  const setsPipefail = /set\s+-[a-z]*o?\s*pipefail|set\s+-[a-zA-Z]*o\s+pipefail|set\s+-euo\s+pipefail/.test(
    block.body,
  );
  return !(explicitBashShell || setsPipefail);
}

/**
 * 既知の未対応 (このブランチでは触れない約束になっているファイル)。
 *
 * 抜け道を「見えないまま」にしないため、ここに理由と担当を書いて残す。
 * 追加するときは必ず「なぜ今直せないか」と「どこで直るか」を書くこと。
 *
 * 対応済みになったら stale として警告が出る (ここを消すのが正しい対応)。
 * 警告どまりにしてあるのは、先行 PR がマージされた瞬間に main が赤くなるのを
 * 避けるため — 赤くする側の判断は Setaka に残す。
 */
const KNOWN_UNGUARDED_WORKFLOWS: Record<string, string> = {
  "ci.yml":
    "リポジトリ公開 / ブランチ保護の作業中で競合するため本 PR では触らない (別担当)。" +
    "解消したらこの行を消すこと",
  "prod-main-sync.yml":
    "PR #80 で `shell: bash` + `set -euo pipefail` に修正済み (未マージ)。" +
    "#80 がマージされたらこの行を消すこと",
};

describe("A. workflow の終了コードが握り潰されていない", () => {
  const files = fs
    .readdirSync(workflowDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => path.join(workflowDir, f));

  it("workflow ファイルを実際に読めている (0 件走査で緑になる穴を塞ぐ)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("パイプを含む run: は必ず pipefail 下で走る", () => {
    const offenders: string[] = [];
    const seenKnown = new Set<string>();

    for (const file of files) {
      const base = path.basename(file);
      for (const block of extractRunBlocks(file)) {
        if (!hasUnguardedPipe(block)) continue;
        if (base in KNOWN_UNGUARDED_WORKFLOWS) {
          seenKnown.add(base);
          continue;
        }
        offenders.push(`${path.relative(repoRoot, file)}:${block.line}`);
      }
    }

    for (const base of Object.keys(KNOWN_UNGUARDED_WORKFLOWS)) {
      if (!seenKnown.has(base)) {
        console.warn(
          `[no-blind-green-checks] STALE: ${base} は既に pipefail 下で走っています。` +
            "KNOWN_UNGUARDED_WORKFLOWS からこの行を削除してください",
        );
      }
    }

    expect(
      offenders,
      "パイプの左側が失敗しても step が緑になります。" +
        "その step に `shell: bash` を足し、本体の先頭で `set -euo pipefail` を立ててください " +
        "(先行例: .github/workflows/prod-main-sync.yml / branch-divergence.yml)",
    ).toEqual([]);
  });
});

describe("B. e2e が「対象が 0 件」を skip の理由にしていない", () => {
  /**
   * 「この環境では対象外」型の skip は正当なので禁じない
   * (未実装機能 / 環境変数未設定 / 実ストア専用の SellingPlan 等)。
   * 禁じるのは「対象が 0 件だった」= 壊れている証拠を skip に変換する形だけ。
   */
  const FORBIDDEN_REASONS = [
    "商品一覧に商品カードが無い",
    "ジャーナル一覧に記事カードが無い",
  ];

  /*
   * ここに入れなかったもの (2026-08-19 判定・現状維持)
   * -------------------------------------------------
   * subscription-signup.spec.ts / subscription-management.spec.ts の
   * 「定期便商品が見つかりません」「商品が売り切れです」
   * 「カート追加が失敗しました」は、いずれも STOREFRONT_CONFIGURED
   * (= 実 Shopify 資格情報あり) の describe 配下にある。見本カタログは
   * sellingPlanGroups を意図的に空にしているため (support/preconditions.ts)、
   * 「対象 0 件」が故障を意味するのか環境差なのかを **コードだけでは判定できない**。
   * 一律に失敗へ倒すと CI が恒常的に赤になり、今度は赤が信用されなくなる。
   * 判定には CI に SellingPlan fixture を用意するかどうかの決定が要るため、
   * ここでは現状維持とし、この理由を残す。
   *
   * ms7-personalization.spec.ts の PENDING_LIFF_ROUTE / PENDING_PERSONA_API と
   * 環境変数未設定 (AGENT_BASE_URL / CRON_SECRET / SHOPIFY_WEBHOOK_SECRET) は
   * 「この環境では対象外」型の正当な skip なので対象外。
   */

  const specs = fs
    .readdirSync(e2eDir)
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => path.join(e2eDir, f));

  it("e2e spec を実際に読めている", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it("一覧が 0 件であることを理由に skip しない", () => {
    const offenders: string[] = [];
    for (const file of specs) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (!/test\.skip\s*\(/.test(line)) return;
        if (FORBIDDEN_REASONS.some((r) => line.includes(r))) {
          offenders.push(`${path.relative(repoRoot, file)}:${idx + 1}`);
        }
      });
    }

    expect(
      offenders,
      "一覧が 0 件なのは環境差ではなく故障です。skip (灰色) ではなく失敗 (赤) にしてください。" +
        "e2e/support/preconditions.ts の requireVisible() を使うこと",
    ).toEqual([]);
  });
});
