# 手元のFirestoreをどうするか

## 結論

手元の `pnpm dev` は **本番Firestoreに繋がらない**。繋ごうとすると起動時に止まり、
その場で選択肢が出る。おすすめは1（エミュレーター）。

```bash
# ターミナル 1 — エミュレーターを立てる
pnpm emulator:start

# ターミナル 2 — そこへ向けて dev サーバーを起動する
pnpm dev:emulator
```

## なぜ止めるようになったのか

以前は「資格情報がenvに在れば繋ぐ」だけだった。`.env.local` には本番の
サービスアカウントが入っているので、**手元で `pnpm dev` を叩いた瞬間に本番Firestoreを
読み書きしていた**。読みは気づけないし、書きは戻せない。しかも「動いてしまう」ので、
壊れていることが誰にも見えない。

「テスト用のDBが無い」という話の本体は置き場所ではなく **既定の向き先** だったので、
既定を反転させた。手元では繋がないのが既定で、繋ぎたいなら明示的にそう言う。

判定は `lib/firebase/firestore-target.ts` の1か所だけにある。

## 3つの選び方

| | 何が起きるか | 保存 | Java | 向いている場面 |
|---|---|---|---|---|
| 1. エミュレーター | 手元のFirestoreに読み書きする | される | 要る | ふだんの開発。データを作って育てたいとき |
| 2. 偽Firestore | プロセス内のメモリに読み書きする | されない | 要らない | さっと動かしたいとき。E2E |
| 3. 明示許可 | **本番に読み書きする** | — | — | 原則使わない |

### 1. エミュレーター

Firebase公式のEmulator Suiteを使う。`firebase.json` の `emulators` に設定がある
（Firestoreが8080、UIが4000）。

```bash
pnpm emulator:start     # http://127.0.0.1:4000 で中身が見える
pnpm dev:emulator
```

`pnpm emulator:start` は `npx firebase-tools` を都度取ってくるので、devDependenciesは
増えていない（CIの `pnpm install` を重くしないため）。

**Javaが要る。** 入っていなければ:

```bash
brew install --cask temurin
```

E2Eを手元でエミュレーターに向けて回すなら `pnpm test:e2e:emulator`。

### 2. 偽Firestore

`instrumentation.ts` がプロセス内の偽Firestoreを差し込む。Javaも
ダウンロードも要らない代わりに、サーバーを落とすと中身は消える。

```bash
E2E_FIRESTORE_STUB=1 pnpm dev
```

CIの `identity-e2e` はこれを使っている（エミュレーターはJavaと60MB超の
ダウンロードをCIの実行経路に持ち込む＝ネットワーク起因のflakyを新しく作るため）。

### 3. どうしても本番へ繋ぐ

```bash
ALLOW_PRODUCTION_FIRESTORE=1 pnpm dev
```

読むだけのつもりでも、アプリのどこかが書けば本番が書き換わる。使ったら、
使い終わったことを確かめてから外す。

## 本番の挙動は変わっていない

判定の順番は次のとおりで、**本番の経路には新しい条件を1つも足していない**。

1. `FIRESTORE_EMULATOR_HOST` が立っている → エミュレーター（資格情報は要らない）
2. 本番ランタイム（`NODE_ENV=production` またはVercel）→ 本番 ← 従来と同じ
3. `ALLOW_PRODUCTION_FIRESTORE=1` → 本番
4. それ以外（＝手元）→ 止める

2を3より先に見るのが肝。デプロイ済みのアプリは必ず2で抜けるので、この変更の
前後で挙動は同じになる。

資格情報が足りないときの文言（`missing required env vars`）もそのまま残してある。
`lib/journal/popular-articles.ts` がその文言を見て「未設定」と分類しているため、
ガードは資格情報チェックより **後ろ** に置いてある。

固定しているテストは `__tests__/firestore-local-isolation.test.ts`。
