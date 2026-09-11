type JsonLdProps = {
  data: Record<string, unknown>;
};

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function ProductJsonLd({
  name,
  description,
  image,
  url,
  price,
  currency,
  availability,
  brand,
}: {
  name: string;
  description?: string;
  image?: string;
  url: string;
  price: string;
  currency: string;
  availability: boolean;
  brand?: string;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    ...(description && { description }),
    ...(image && { image }),
    url,
    ...(brand && { brand: { "@type": "Brand", name: brand } }),
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: currency,
      availability: availability
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url,
    },
  };
  return <JsonLd data={data} />;
}

export function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "elxea",
    url: "https://elxea.com",
    description:
      "日本各地の茶農家が丹精込めて育てたスペシャルティティーを直接お届けするD2Cブランド",
    logo: "https://elxea.com/logo.png",
    sameAs: [],
    contactPoint: {
      "@type": "ContactPoint",
      // 表示用の問い合わせ先は info@ に統一 (Setaka 確定 2026-08-11)。特商法ページ /
      // プライバシーポリシー / お問い合わせページと同じアドレスを出す。
      email: "info@elxea.com",
      contactType: "customer service",
      availableLanguage: ["Japanese", "English"],
    },
  };
  return <JsonLd data={data} />;
}

export function ArticleJsonLd({
  title,
  description,
  image,
  url,
  datePublished,
  dateModified,
  author,
}: {
  title: string;
  description?: string;
  image?: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    ...(description && { description }),
    ...(image && { image }),
    url,
    datePublished,
    ...(dateModified && { dateModified }),
    author: {
      "@type": "Organization",
      name: author || "elxea",
    },
    publisher: {
      "@type": "Organization",
      name: "elxea",
      logo: { "@type": "ImageObject", url: "https://elxea.com/logo.png" },
    },
  };
  return <JsonLd data={data} />;
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
  return <JsonLd data={data} />;
}

export function FAQJsonLd({
  questions,
}: {
  questions: { question: string; answer: string }[];
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
  return <JsonLd data={data} />;
}
