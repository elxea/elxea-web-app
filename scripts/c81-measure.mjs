// C8-1 トップページ (/ja) 実画面 getComputedStyle 実測ハーネス
//
// 対比表 docs/fidelity/c8-1-fidelity.md の「実装値」を、実際にレンダリングされた
// DOM の computed 値 / bounding box から取る (クラス名やトークンの見かけの解決値
// ではなく実測)。作法は scripts/c71-measure.mjs / scripts/c91-measure.mjs に合わせた。
//
// 色は **実ピクセル**で読む。Chromium は getComputedStyle の色を lab() / oklch()
// のまま返すことがあり、文字列パースでは嘘の値になる (C6-1R レーンの実証済み知見)。
// 本ハーネスは対象の色を背景に持つ probe 要素をページに差し込み、その 1px を
// スクリーンショットして PNG を復号し sRGB バイトを読む。合成後の実際の表示色を
// 読むので、透明度合成や重ね順の影響も含めて確定できる。節の地色は要素そのものの
// 実ピクセルでも二重に確認する。
//
// 使い方:
//   PREVIEW_SEED=1 pnpm build && SITE_PASSWORD= PREVIEW_SEED=1 PORT=3181 pnpm start
//   node scripts/c81-measure.mjs http://127.0.0.1:3181 > /tmp/c81-measured.json
import { chromium } from "@playwright/test";
import zlib from "node:zlib";

const base = process.argv[2] ?? "http://127.0.0.1:3181";

/**
 * 色は getComputedStyle を使わない。Chromium は color を lab() / oklch() で
 * 返すことがあり文字列パースで誤値になる (C6-1R レーンの実証済み知見)。
 * 代わりに 1px のスクリーンショット (PNG ラスタ) を復号して RGB を読む。
 */
const decodePng1x1 = (buf) => {
  let off = 8; // PNG signature
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR")
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
      };
    if (type === "IDAT") idat.push(Buffer.from(data));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = ihdr.colorType === 6 ? 4 : ihdr.colorType === 2 ? 3 : 1;
  // 1px 幅なので各行は [filter byte][pixel]。filter が None / Sub のどちらでも
  // 先頭 1px は生値になる。
  const px = raw.subarray(1, 1 + channels);
  const hex = (n) => n.toString(16).padStart(2, "0");
  return { rgb: [px[0], px[1], px[2]], hex: `#${hex(px[0])}${hex(px[1])}${hex(px[2])}` };
};

/**
 * 対象要素の指定プロパティ (color / backgroundColor / borderTopColor) を、
 * 同じ値を背景に持つ 20x20 の probe を差し込んで実ピクセルとして読み取る。
 * 文字色はグリフのアンチエイリアスで直接サンプルできないためこの方式を使う。
 */
const sampleColorOf = async (page, selector, prop) => {
  const ok = await page.evaluate(
    ([sel, p]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const value = getComputedStyle(el)[p];
      const probe = document.createElement("div");
      probe.id = "__c81_probe__";
      probe.style.cssText =
        "position:fixed;left:0;top:0;width:20px;height:20px;z-index:2147483647;";
      probe.style.backgroundColor = value;
      document.body.appendChild(probe);
      return true;
    },
    [selector, prop]
  );
  if (!ok) return null;
  const buf = await page.screenshot({
    clip: { x: 4, y: 4, width: 1, height: 1 },
    type: "png",
  });
  const out = decodePng1x1(buf);
  await page.evaluate(() => document.getElementById("__c81_probe__")?.remove());
  return { selector, prop, hex: out.hex, rgb: out.rgb };
};

/** 指定要素の指定位置 (要素内オフセット) のピクセル色を実測する。 */
const samplePixel = async (page, selector, dx = 1, dy = 1) => {
  const el = await page.$(selector);
  if (!el) return null;
  await el.scrollIntoViewIfNeeded();
  const bb = await el.boundingBox();
  if (!bb) return null;
  const clip = { x: Math.round(bb.x + dx), y: Math.round(bb.y + dy), width: 1, height: 1 };
  const buf = await page.screenshot({ clip, type: "png" });
  const out = decodePng1x1(buf);
  return { selector, at: clip, hex: out.hex, rgb: out.rgb };
};

const EXTRACT = () => {
  const px = (v) => (v == null ? null : v);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const type = (el) => {
    const s = cs(el);
    if (!s) return null;
    return {
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      fontWeight: s.fontWeight,
      color: s.color,
    };
  };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
  };
  const pad = (el) => {
    const s = cs(el);
    if (!s) return null;
    return { pt: s.paddingTop, pb: s.paddingBottom, pl: s.paddingLeft, pr: s.paddingRight };
  };
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)];

  const sections = qa('[data-slot="top-section"]').map((el) => ({
    label: el.getAttribute("aria-label") || (el.querySelector('[data-slot="top-section-head"] p')?.textContent ?? "").trim(),
    pad: pad(el),
    box: box(el),
  }));

  const hero = q('[data-slot="top-hero"]');
  const heroH1 = q('[data-slot="top-hero"] h1');
  const heroTextCol = heroH1?.parentElement ?? null;
  const heroImg = q('[data-slot="top-hero"] img');
  const heroCta = q('[data-slot="top-hero"] a');

  const feedList = q('[data-slot="feed-list"]');
  const feedLink = q('[data-slot="feed-list"] a');
  const feedTitle = q('[data-slot="feed-list"] a span:first-child');
  const feedMeta = q('[data-slot="feed-list"] a span:nth-child(2)');

  const grid = q('[data-slot="catalog-grid"]');
  const tileGrid = q('[data-slot="action-tile-grid"]');
  const tileImg = q('[data-slot="action-tile"] > div');
  const tileLabel = q('[data-slot="action-tile"] span');

  const specBand = q('[data-slot="spec-band"]');
  const specTerm = q('[data-slot="spec-item"] dt');
  const specValue = q('[data-slot="spec-item"] dd');

  const triple = q('[data-slot="triple-column"]');
  const tripleItem = q('[data-slot="triple-item"]');

  const chapter = q('[data-slot="chapter-statement"]');
  const chapterInner = chapter?.querySelector(".page-container > div") ?? null;
  const chapterOverline = chapter?.querySelector("p") ?? null;
  const chapterTitle = chapter?.querySelector("h2") ?? null;
  const chapterBody = chapter?.querySelectorAll("p")[1] ?? null;

  const guide = q('[data-slot="service-guide-block"]');
  const guideInner = guide?.querySelector(".page-container") ?? null;
  const guideTiles = guide?.querySelector('[data-slot="service-guide-tile"]')?.parentElement ?? null;
  const guideTile = q('[data-slot="service-guide-tile"]');
  const guideTileTitle = q('[data-slot="service-guide-tile-title"]');
  const guideTileLink = q('[data-slot="service-guide-tile"] a');

  const voicesHead = q('[data-slot="section-head"]');
  const voicesTitle = q('[data-slot="section-title"]');
  const voicesBody = q('[data-slot="section-body"]');
  const quiet = q('[data-slot="quiet-link-row"] a');
  const overline = q('[data-slot="top-section-head"] p');
  const sectionTitle = q('[data-slot="top-section-title"]');
  const container = q(".page-container");

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    container: { box: box(container), pad: pad(container) },
    hero: {
      pad: pad(hero),
      h1: { ...type(heroH1), box: box(heroH1) },
      textCol: box(heroTextCol),
      img: { box: box(heroImg), aspectRatio: cs(heroImg)?.aspectRatio, radius: cs(heroImg)?.borderTopLeftRadius },
      cta: { ...type(heroCta), box: box(heroCta), radius: cs(heroCta)?.borderTopLeftRadius, border: cs(heroCta)?.borderTopColor, padX: cs(heroCta)?.paddingLeft, minH: cs(heroCta)?.minHeight },
      subtitle: type(heroH1?.nextElementSibling),
      lead: type(heroH1?.nextElementSibling?.nextElementSibling),
    },
    sections,
    overline: type(overline),
    sectionTitle: { ...type(sectionTitle), box: box(sectionTitle) },
    feed: {
      gap: cs(feedList)?.rowGap,
      marginTop: cs(feedList)?.marginTop,
      rowMinH: cs(feedLink)?.minHeight,
      rowColGap: cs(feedLink)?.columnGap,
      rowBox: box(feedLink),
      title: type(feedTitle),
      meta: type(feedMeta),
      rows: qa('[data-slot="feed-list"] li').length,
    },
    productGrid: grid
      ? {
          cols: cs(grid).gridTemplateColumns,
          colGap: cs(grid).columnGap,
          rowGap: cs(grid).rowGap,
          marginTop: cs(grid).marginTop,
          visibleCards: qa('[data-slot="catalog-grid"] > div').filter((d) => cs(d).display !== "none").length,
          totalCards: qa('[data-slot="catalog-grid"] > div').length,
        }
      : null,
    tileGrid: tileGrid
      ? {
          cols: cs(tileGrid).gridTemplateColumns,
          colGap: cs(tileGrid).columnGap,
          rowGap: cs(tileGrid).rowGap,
          marginTop: cs(tileGrid).marginTop,
          tiles: qa('[data-slot="action-tile"]').length,
          imgBox: box(tileImg),
          imgAspect: cs(tileImg)?.aspectRatio,
          gap: cs(q('[data-slot="action-tile"]'))?.rowGap,
          label: type(tileLabel),
        }
      : null,
    specBand: specBand
      ? {
          cols: cs(specBand).gridTemplateColumns,
          colGap: cs(specBand).columnGap,
          rowGap: cs(specBand).rowGap,
          borderTop: cs(specBand).borderTopWidth + " " + cs(specBand).borderTopColor,
          padTop: cs(specBand).paddingTop,
          term: type(specTerm),
          value: type(specValue),
          valueMt: cs(specValue)?.marginTop,
        }
      : null,
    triple: triple
      ? {
          cols: cs(triple).gridTemplateColumns,
          colGap: cs(triple).columnGap,
          rowGap: cs(triple).rowGap,
          itemBorderTop: cs(tripleItem)?.borderTopWidth + " " + cs(tripleItem)?.borderTopColor,
          itemPadTop: cs(tripleItem)?.paddingTop,
          title: type(tripleItem?.querySelector("p")),
          body: type(tripleItem?.querySelectorAll("p")[1]),
        }
      : null,
    chapter: chapter
      ? {
          bg: cs(chapter).backgroundColor,
          pad: pad(chapter),
          maxWidth: cs(chapterInner)?.maxWidth,
          textAlign: cs(chapterInner)?.textAlign,
          overline: type(chapterOverline),
          title: type(chapterTitle),
          body: type(chapterBody),
        }
      : null,
    guide: guide
      ? {
          bg: cs(guide).backgroundColor,
          pad: pad(guideInner),
          tileCols: cs(guideTiles)?.gridTemplateColumns,
          tileColGap: cs(guideTiles)?.columnGap,
          tileRowGap: cs(guideTiles)?.rowGap,
          tilesMt: cs(guideTiles)?.marginTop,
          tileBorderTop: cs(guideTile)?.borderTopWidth + " " + cs(guideTile)?.borderTopColor,
          tilePadTop: cs(guideTile)?.paddingTop,
          tileTitle: type(guideTileTitle),
          tileLink: { ...type(guideTileLink), minH: cs(guideTileLink)?.minHeight },
          tiles: qa('[data-slot="service-guide-tile"]').length,
        }
      : null,
    voices: voicesTitle
      ? {
          title: { ...type(voicesTitle), box: box(voicesTitle) },
          titleMt: cs(voicesTitle).marginTop,
          bodyMt: cs(voicesBody)?.marginTop,
          headOverline: type(voicesHead?.querySelector("p")),
        }
      : null,
    quietLink: quiet ? { ...type(quiet), minH: cs(quiet).minHeight } : null,
    bodyBg: cs(document.body).backgroundColor,
    docWidth: document.documentElement.scrollWidth,
    px,
  };
};

const run = async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [name, size] of [
    ["pc", { width: 1440, height: 1000 }],
    ["sp", { width: 375, height: 1000 }],
  ]) {
    const ctx = await browser.newContext({ viewport: size, locale: "ja-JP" });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const failed = [];
    page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    const resp = await page.goto(`${base}/ja`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(1200);
    const data = await page.evaluate(EXTRACT);
    delete data.px;

    const colorTargets = [
      ["body", "backgroundColor"],
      ['[data-slot="top-hero"] h1', "color"],
      ['[data-slot="top-section-head"] p', "color"],
      ['[data-slot="top-section-title"]', "color"],
      ['[data-slot="feed-list"] a span:first-child', "color"],
      ['[data-slot="feed-list"] a span:nth-child(2)', "color"],
      ['[data-slot="top-hero"] a', "borderTopColor"],
      ['[data-slot="spec-band"]', "borderTopColor"],
      ['[data-slot="triple-item"]', "borderTopColor"],
      ['[data-slot="chapter-statement"]', "backgroundColor"],
      ['[data-slot="chapter-statement"] h2', "color"],
      ['[data-slot="chapter-statement"] p', "color"],
      ['[data-slot="service-guide-block"]', "backgroundColor"],
      ['[data-slot="service-guide-tile"]', "borderTopColor"],
      ['[data-slot="service-guide-tile-title"]', "color"],
      ['[data-slot="quiet-link-row"] a', "color"],
    ];
    const colors = {};
    for (const [sel, prop] of colorTargets) {
      const c = await sampleColorOf(page, sel, prop);
      if (c) colors[`${sel} :: ${prop}`] = c.hex;
    }
    /* 節の地色は要素をビューポートへ入れてから実ピクセルも読む (probe と二重確認)。 */
    const pixels = {};
    for (const [key, sel] of [
      ["chapterBgPixel", '[data-slot="chapter-statement"]'],
      ["guideBgPixel", '[data-slot="service-guide-block"]'],
      ["pageBgPixel", '[data-slot="top-hero"]'],
    ]) {
      try {
        const p = await samplePixel(page, sel);
        if (p) pixels[key] = p.hex;
      } catch (e) {
        pixels[key] = `ERR: ${String(e).slice(0, 80)}`;
      }
    }

    out[name] = {
      status: resp?.status(),
      consoleErrors,
      pageErrors,
      requestFailed: failed,
      colors,
      pixels,
      ...data,
    };
    await ctx.close();
  }
  await browser.close();
  process.stdout.write(JSON.stringify(out, null, 2));
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
