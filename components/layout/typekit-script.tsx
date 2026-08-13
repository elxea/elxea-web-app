/**
 * Adobe Fonts (Typekit kit fwg7gtf) の読み込み。
 *
 * ## なぜ部品にしてあるか
 * ルートレイアウトが 1 つではないため (サイト共通 chrome を持つ
 * `app/[locale]/layout.tsx` と、chrome を持たない `app/(liff)/[locale]/layout.tsx`)。
 * 同じローダーを 2 か所に書き写すと、kit ID や timeout の変更が片方に取り残される。
 * 「どのブランド書体を、どう読み込むか」の正本はこのファイル 1 つに置く。
 *
 * ## 読み込み方
 * kit は JS 専用の設定になっている — CSS エンドポイント
 * (use.typekit.net/fwg7gtf.css) は HTTP 412 を返し、JS エンドポイント
 * (use.typekit.net/fwg7gtf.js) だけが 200 を返す。よって公式の非同期 JS 埋め込みを
 * そのまま使う。ローダーは <html> に wf-loading → wf-active / wf-inactive の
 * クラスを付け替え、@font-face の CSS を注入する。
 *
 * ## 使う側の注意
 * このローダーは hydration より前に `document.documentElement.className` を
 * 書き換えるので、サーバ HTML の class (無し) とクライアントの class
 * (" wf-loading") が必ず食い違う。これを載せる <html> には
 * `suppressHydrationWarning` を必ず付けること (理由の詳細は
 * `app/[locale]/layout.tsx` の <html> のコメント)。
 */
export function TypekitScript() {
  return (
    <>
      <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://p.typekit.net" crossOrigin="anonymous" />
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(d){var config={kitId:'fwg7gtf',scriptTimeout:3000,async:true},h=d.documentElement,t=setTimeout(function(){h.className=h.className.replace(/\\bwf-loading\\b/g,"")+" wf-inactive";},config.scriptTimeout),tk=d.createElement("script"),f=false,s=d.getElementsByTagName("script")[0],a;h.className+=" wf-loading";tk.src='https://use.typekit.net/'+config.kitId+'.js';tk.async=true;tk.onload=tk.onreadystatechange=function(){a=this.readyState;if(f||a&&a!="complete"&&a!="loaded")return;f=true;clearTimeout(t);try{Typekit.load(config)}catch(e){}};s.parentNode.insertBefore(tk,s)})(document);`,
        }}
      />
    </>
  );
}
