import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LineUnlinkControl } from "./line-unlink-control";

/**
 * マイページの「LINEとの連携を解除する」導線。
 *
 * ## なぜ story が要るのか（畳まれている画面は誰も見ない）
 *
 * この部品の中身は **確認ダイアログを開くまで DOM に出ない**。unit テスト
 *（`__tests__/line-unlink-control-copy.test.tsx`）は説明文を node で直接描いて縛って
 * いるが、それは文字列の検査であって「開いたときに実際どう見えるか」は見ていない。
 * 一方 e2e（`e2e/line-linkage-flow.spec.ts`）は本物の往復の中で開くので、確認だけ
 * したいときに回すには重い。その間を埋めるのがこの story で、**開いた状態を人が
 * 目で確かめられる唯一の場所**になる。
 *
 * `Opened` の play は storybook-tests（CI 必須チェック）で毎回実行されるので、
 * 「開くと 4 段の説明が出る」ことは story であると同時に検査でもある。
 *
 * ## ここで押してはいけないもの
 *
 * 「連携を解除する」（確認側）は `DELETE /api/user/line-link` を実際に投げる。story は
 * MSW を敷いていないので、play では**開くところまで**しかやらない。解除そのものの
 * 契約は route テストと e2e が持っている。
 */
const meta = {
  title: "Account/LineUnlinkControl",
  component: LineUnlinkControl,
  tags: ["autodocs"],
  args: { locale: "ja" },
  parameters: {
    /* この部品は解除成功後に `useRouter().refresh()` で連携節を引き直す。App Router の
       mock を差し込まないと `useRouter` が「app router がマウントされていない」で
       落ちて、story が開く前に死ぬ。 */
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "連携済みのお客さまに出る解除の導線。確認ダイアログでは「データはメールでログインするアカウント側に保管される」「LINE からは見えなくなる」「再連携すれば戻る」の 3 点を必ず伝える。",
      },
    },
  },
} satisfies Meta<typeof LineUnlinkControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** マイページに置かれた状態（ダイアログは閉じている）。 */
export const Default: Story = {};

/**
 * 確認ダイアログを開いた状態。**解除後にデータがどこへ行くかの説明がここに出る。**
 *
 * play は開いたあと 4 段がそろっていることと、3 点（保管先 / LINE から見えなくなる /
 * 再連携で戻る）が読めることを確かめる。文面の一字一句は unit 側で縛っているので、
 * ここでは「開いたら本当に出る」ことを見る。
 */
export const Opened: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("解除ボタンを押して確認ダイアログを開く", async () => {
      await userEvent.click(canvas.getByTestId("line-unlink-trigger"));
    });

    /* Radix はダイアログを portal で body 直下に出すので、canvasElement の中には
       いない。document 全体から探す。 */
    const screen = within(canvasElement.ownerDocument.body);

    await step("説明の 4 段がそろって出る", async () => {
      await expect(await screen.findByTestId("line-unlink-dialog")).toBeInTheDocument();

      /* Radix は開くときに fade-in（opacity 0 → 1）を挟むので、DOM に出た直後は
         まだ `toBeVisible()` が false になる。アニメーションが終わるまで待つ
         （待たずに assert すると、実装ではなく再生タイミングで赤くなる）。 */
      for (const id of [
        "line-unlink-keeps",
        "line-unlink-friendship",
        "line-unlink-afterwards",
        "line-unlink-delivery",
      ]) {
        await waitFor(() => expect(screen.getByTestId(id)).toBeVisible());
      }
    });

    await step("説明文が読み上げに繋がっている（aria-describedby）", async () => {
      /* 説明の 4 段は `AlertDialogDescription asChild` の子として置かれる。Radix は
         子に id を差し込み、それを `aria-describedby` に結ぶ。子が props を落とすと
         この結び目だけが静かに切れ、画面には出ているのに読み上げからは消える
         （見た目が変わらないので目視では気づけない）。ここで結び目を直接見る。 */
      const dialog = screen.getByTestId("line-unlink-dialog");
      const describedBy = dialog.getAttribute("aria-describedby");
      await expect(describedBy).toBeTruthy();

      const description = canvasElement.ownerDocument.getElementById(describedBy!);
      await expect(description).toContainElement(screen.getByTestId("line-unlink-keeps"));
    });

    await step("4 段が地続きにならない（段落間の余白が残っている）", async () => {
      /* 説明の器は Slot 側の見た目（`text-muted-foreground text-sm`）と自前の組版
         （`space-y-3 text-left`）の**両方**を着ていないといけない。素朴に props を
         下ろすと後者が上書きで消え、4 段が隙間なく続いた 1 かたまりに見える
         （文言は全部出ているので、テストも目視の斜め読みも素通りする）。
         両方が乗っていることを直接見る。 */
      const container = screen.getByTestId("line-unlink-keeps").parentElement!;
      await expect(container).toHaveClass("space-y-3");
      await expect(container).toHaveClass("text-muted-foreground");

      /* class 名だけでなく、実際に余白が付いているところまで見る。 */
      const keeps = screen.getByTestId("line-unlink-keeps");
      const friendship = screen.getByTestId("line-unlink-friendship");
      const gap =
        friendship.getBoundingClientRect().top - keeps.getBoundingClientRect().bottom;
      await expect(gap).toBeGreaterThan(4);
    });

    await step("解除後にデータがどこへ行くかが読める", async () => {
      /* 保管先を言っている（「残ります」だけで場所を伏せない）。 */
      await expect(screen.getByTestId("line-unlink-keeps")).toHaveTextContent(
        "メールアドレスでログイン",
      );
      /* LINE からは見えなくなる、と、再連携すれば戻る、が対で出ている。 */
      const afterwards = screen.getByTestId("line-unlink-afterwards");
      await expect(afterwards).toHaveTextContent("LINEからは見えなくなります");
      await expect(afterwards).toHaveTextContent("もう一度連携");
    });
  },
};

/** 英語ロケール。日本語と同じ 3 点を言っていること。 */
export const OpenedEnglish: Story = {
  args: { locale: "en" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("line-unlink-trigger"));

    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByTestId("line-unlink-dialog")).toBeInTheDocument();
    await expect(screen.getByTestId("line-unlink-keeps")).toHaveTextContent(
      "sign in to by email",
    );
    await expect(screen.getByTestId("line-unlink-afterwards")).toHaveTextContent(
      "no longer visible from LINE",
    );
  },
};
