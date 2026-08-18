/**
 * eslint-plugin-elxea-tokens / no-new-karte-fields
 *
 * 「新しいカルテの項目は必ず未連携カルテ（cx-agent の lineUsers）側に足す。3か所目を作らない」
 * を**機械的に**強制するルール。
 *
 * 一次入力（仕様の正本）:
 *   roji同じ人だと分かる仕組み  https://www.notion.so/3b570c9d064c81d68610f9360f50c965
 *     判断2「未連携の人のカルテが2か所にある。今は寄せない。ただし『新しい項目は必ず lineUsers 側』を
 *           **機械強制する**（lint ルール1本またはレビュー規約1行）」
 *     判断2の根拠「**ただし方針を書くだけでは守られない。**人の記憶に頼る取り決めは、
 *           担当が変わった時点で失効する」
 *
 * ■ なにを止めるのか
 *   未連携の人のカルテは今 2 か所にある:
 *     (1) cx-agent の Firestore `lineUsers/{lineUserId}`  … 好み・入口の答え・roji カルテ項目
 *     (2) web-app の Firestore `users/line:{lineUserId}`   … お気に入り・農家フォロー・イベント申込
 *   置き場の統合は後回し（判断2 前半）だが、**その間に 3 か所目や、(2) 側だけに足された項目**が
 *   生まれると、合流のときに落ちる（穴1 と同じ失敗様式が web 側で再発する）。
 *   そこで web-app 側のカルテ型を**凍結**する。凍結した型に新しいプロパティを足すと lint が落ちる。
 *
 * ■ どう直すのか（エラーメッセージが指す先）
 *   新しいカルテ項目は cx-agent の `RojiKarteFields`（src/lib/firestore.ts）に足す。
 *   そこに足せば `CustomerProfile`（本カルテ）と `LineUserProfile`（未連携カルテ）の両方へ
 *   自動的に交差し、合流の規則の表（karte-merge-rules.ts）が型で網羅を強制する。
 *
 * ■ 逃げ道（意図的に狭くしてある）
 *   本当に web 側へ足す必要があるときは、このファイルの allowlist に足す。
 *   allowlist の変更は差分に必ず現れるので、レビューで必ず目に入る（＝人の記憶に頼らない）。
 */

/** 凍結対象の型名 → 許可されたプロパティ名の集合。 */
const FROZEN_KARTE_TYPES = {
  UserProfile: new Set([
    "lineUserId",
    "email",
    "displayName",
    "membershipTier",
    "persona",
    "depthLevel",
    "tasteProfile",
    "onboarding",
    "createdAt",
    "lastActiveAt",
  ]),
  PersonaProfile: new Set(["primary", "scores", "lastUpdated"]),
  PersonaScores: new Set(["serenity", "explorer", "sensory"]),
  TasteProfile: new Set(["preferredCategories", "flavorPreferences", "scenePref"]),
  OnboardingState: new Set([
    "completedAt",
    "initialAction",
    "twoWeekQuestionAnswered",
    "twoWeekAnswer",
  ]),
};

/** プロパティ名を取り出す（Identifier / 文字列リテラル。計算プロパティは対象外）。 */
function propertyName(member) {
  const key = member.key;
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Freeze the web-app karte types so new karte fields are added to cx-agent lineUsers (RojiKarteFields) instead of creating a third store",
      recommended: true,
    },
    messages: {
      newKarteField:
        "カルテの新しい項目 '{{property}}' を web-app の {{typeName}} に足さないこと。" +
        "新項目は cx-agent の RojiKarteFields (src/lib/firestore.ts) に足す — " +
        "そこなら本カルテと未連携カルテの両方へ自動で入り、合流の規則の表が型で網羅を強制する。" +
        "どうしても web 側に要るなら eslint-rules/no-new-karte-fields.mjs の allowlist を更新すること" +
        "（レビューで必ず目に入るようにするため）。根拠: roji 判断2（機械強制）。",
    },
    schema: [],
  },
  create(context) {
    /** 型宣言の本体（TSTypeLiteral / TSInterfaceBody）を走査して未許可プロパティを報告する。 */
    function checkMembers(typeName, allowed, members) {
      for (const member of members ?? []) {
        if (
          member.type !== "TSPropertySignature" &&
          member.type !== "TSMethodSignature"
        ) {
          continue;
        }
        const name = propertyName(member);
        if (name === null) continue;
        if (!allowed.has(name)) {
          context.report({
            node: member,
            messageId: "newKarteField",
            data: { property: name, typeName },
          });
        }
      }
    }

    return {
      // export type UserProfile = { ... }
      TSTypeAliasDeclaration(node) {
        const typeName = node.id?.name;
        const allowed = FROZEN_KARTE_TYPES[typeName];
        if (!allowed) return;
        if (node.typeAnnotation?.type !== "TSTypeLiteral") return;
        checkMembers(typeName, allowed, node.typeAnnotation.members);
      },
      // interface UserProfile { ... }
      TSInterfaceDeclaration(node) {
        const typeName = node.id?.name;
        const allowed = FROZEN_KARTE_TYPES[typeName];
        if (!allowed) return;
        checkMembers(typeName, allowed, node.body?.body);
      },
    };
  },
};

export default rule;
