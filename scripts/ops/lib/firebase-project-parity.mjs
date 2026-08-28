// =============================================================================
// firebase-project-parity.mjs — E6' の判定ロジック (副作用なし・テスト対象)
//
// 問題:
//   web-app と cx-agent は別リポジトリ・別ランタイムでありながら、**同じ Firestore**
//   を顧客カルテの置き場として共有している。にもかかわらず「両者が本当に同じ
//   プロジェクトを見ているか」を機械で確かめる手段が無かった。
//
//   2026-08 の顧客データ統合の審査では、3 つの設計案すべてが接続先を取り違えて
//   推測した。実害の形は 2 つで、しかもどちらも静かに起きる:
//
//     - 同じプロジェクトを見ている  → 同じ注文で persona が二重に加算される
//     - 別のプロジェクトを見ている  → 同じ人のカルテが 2 つに分裂する
//
//   どちらが起きているのかを、人が実機に入って secret を数えるまで誰も言えなかった。
//   「設定を間違えた」ことより「間違えていても分からない」ことのほうが重い。
//
// 処方:
//   cx-agent に接続先プロジェクト ID だけを返す口 (`GET /health/firebase`) を置き、
//   web-app の CI が `.firebaserc` と突き合わせる。
//
//   **不一致でも未設定でも落とす** (fail-closed)。とくに「未設定」を緑にしないのが
//   要点で、cx-agent 側には未設定でも黙って動き続けられる縮退が各所にあった。
//   未設定を緑にすると、この検査は「壊れているときだけ何も言わない」検査になる。
//
// 判定だけをここに置き、ファイル読み・fetch・exit は呼び出し側 (
// scripts/ops/check-firebase-project-parity.mjs) に置く。ネットワーク無しで
// 全分岐をテストできるようにするため。
// =============================================================================

/**
 * @typedef {object} ParityInput
 * @property {string|null} expectedProjectId
 *   `.firebaserc` の projects.default。読めなければ null。
 * @property {string|null} healthUrl
 *   突合先の URL。未設定なら null。
 * @property {number|null} status
 *   HTTP ステータス。到達できなければ null。
 * @property {unknown} body
 *   応答の JSON。パースできなければ null。
 * @property {string|null} error
 *   fetch 自体が失敗したときの理由。
 */

/**
 * @typedef {object} ParityVerdict
 * @property {"ok"|"fail"} verdict
 * @property {string} reason  機械可読な理由コード
 * @property {string} message 人間向けの説明 (何が起きていて、次に何をすればよいか)
 */

/**
 * 突合の判定。**通すのは 1 パターンだけ** で、それ以外は全て落とす。
 *
 * @param {ParityInput} input
 * @returns {ParityVerdict}
 */
export function evaluateFirebaseParity(input) {
  const { expectedProjectId, healthUrl, status, body, error } = input;

  if (!expectedProjectId) {
    return {
      verdict: 'fail',
      reason: 'firebaserc_missing',
      message:
        '.firebaserc から projects.default を読めませんでした。\n' +
        '  この検査は「web-app が見ている Firebase プロジェクト」を .firebaserc を正本として読みます。\n' +
        '  ファイルが無い / 形が変わったなら、正本の置き場が変わったということなので検査側を直してください。',
    };
  }

  if (!healthUrl) {
    return {
      verdict: 'fail',
      reason: 'health_url_unset',
      message:
        'CX_AGENT_HEALTH_URL が未設定です。\n' +
        '  突合先が分からないまま緑にすると、この検査は何も検査していないのと同じになります。\n' +
        '  CI のステップで cx-agent の /health/firebase を指してください。',
    };
  }

  if (error !== null && error !== undefined) {
    return {
      verdict: 'fail',
      reason: 'unreachable',
      message:
        `cx-agent のヘルスエンドポイントに到達できませんでした (${healthUrl}): ${error}\n` +
        '  到達できない = 接続先が一致していることを確かめられない、なので落とします。\n' +
        '  cx-agent がまだデプロイされていない場合もここに来ます (契約の片側がまだ無い状態)。',
    };
  }

  if (status !== 200) {
    // 503 は cx-agent 自身が「Firebase 未設定」と申告している状態。
    // 404 はまだデプロイされていない (口が無い)。どちらも「一致を確かめられない」。
    const hint =
      status === 503
        ? '  503 = cx-agent が「Firebase 未設定」と申告しています。これは A 案の「未設定検知」が働いた状態で、\n' +
          '  検査が壊れているのではなく **本番設定が壊れている** ことを意味します。'
        : status === 404
          ? '  404 = cx-agent 側にまだ /health/firebase がありません。cx-agent を先にマージ・デプロイしてください。'
          : '  200 以外は一致を確かめられないので落とします。';
    return {
      verdict: 'fail',
      reason: `http_${status}`,
      message: `cx-agent のヘルスエンドポイントが ${status} を返しました (${healthUrl})。\n${hint}`,
    };
  }

  if (body === null || typeof body !== 'object') {
    return {
      verdict: 'fail',
      reason: 'body_not_json',
      message:
        `cx-agent の応答が JSON ではありませんでした (${healthUrl})。\n` +
        '  ステータスだけ見る検査はここで必ず騙されます (門・CDN のエラーページが前に出ている等)。\n' +
        '  本文を読めないなら一致は確かめられないので落とします。',
    };
  }

  const actual = /** @type {Record<string, unknown>} */ (body).project_id;
  const configured = /** @type {Record<string, unknown>} */ (body).configured;

  if (configured !== true || typeof actual !== 'string' || actual.length === 0) {
    return {
      verdict: 'fail',
      reason: 'cx_agent_unconfigured',
      message:
        'cx-agent が接続先プロジェクト ID を申告しませんでした (configured=false / project_id が空)。\n' +
        '  **未設定は緑にしません。** cx-agent には未設定でも黙って動き続けられる縮退があり、\n' +
        '  未設定を通すとこの検査は「壊れているときだけ何も言わない」検査になります。',
    };
  }

  if (actual !== expectedProjectId) {
    return {
      verdict: 'fail',
      reason: 'mismatch',
      message:
        '2 つのリポジトリが別の Firebase プロジェクトを見ています。\n' +
        `  web-app (.firebaserc): ${expectedProjectId}\n` +
        `  cx-agent (${healthUrl}): ${actual}\n` +
        '  この状態では同じ人のカルテが 2 つに分かれて溜まり続けます。どちらが正しいかを決めて\n' +
        '  片側を合わせてください (secret の書き換えは Setaka の判断)。',
    };
  }

  return {
    verdict: 'ok',
    reason: 'match',
    message: `web-app と cx-agent は同じ Firebase プロジェクトを見ています: ${actual}`,
  };
}

/**
 * `.firebaserc` の中身から projects.default を取り出す。
 *
 * 形が違うときは **例外にせず null** を返し、判定側で `firebaserc_missing` として
 * 落とす。読めなかったことと不一致だったことを、同じ「落ちる」に揃えるため
 * (読めないほうだけ緑になる経路を作らない)。
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function readDefaultProjectId(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const value = parsed?.projects?.default;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
