// Google Tag Manager data layer helpers
// These push ecommerce events to the GTM dataLayer.
// GTM container must be configured to forward these to GA4.

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

function push(data: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(data);
}

// MS4.3: Page view (handled automatically by GTM, but available for SPA navigation)
export function trackPageView(url: string, title?: string) {
  push({
    event: "page_view",
    page_location: url,
    page_title: title,
  });
}

// MS4.4: E-commerce events

export function trackViewItem(item: {
  id: string;
  name: string;
  price: number;
  currency: string;
  brand?: string;
  category?: string;
  variant?: string;
}) {
  push({ ecommerce: null }); // Clear previous ecommerce data
  push({
    event: "view_item",
    ecommerce: {
      currency: item.currency,
      value: item.price,
      items: [
        {
          item_id: item.id,
          item_name: item.name,
          price: item.price,
          item_brand: item.brand,
          item_category: item.category,
          item_variant: item.variant,
          quantity: 1,
        },
      ],
    },
  });
}

export function trackAddToCart(item: {
  id: string;
  name: string;
  price: number;
  currency: string;
  quantity: number;
  brand?: string;
  variant?: string;
}) {
  push({ ecommerce: null });
  push({
    event: "add_to_cart",
    ecommerce: {
      currency: item.currency,
      value: item.price * item.quantity,
      items: [
        {
          item_id: item.id,
          item_name: item.name,
          price: item.price,
          item_brand: item.brand,
          item_variant: item.variant,
          quantity: item.quantity,
        },
      ],
    },
  });
}

export function trackRemoveFromCart(item: {
  id: string;
  name: string;
  price: number;
  currency: string;
  quantity: number;
}) {
  push({ ecommerce: null });
  push({
    event: "remove_from_cart",
    ecommerce: {
      currency: item.currency,
      value: item.price * item.quantity,
      items: [
        {
          item_id: item.id,
          item_name: item.name,
          price: item.price,
          quantity: item.quantity,
        },
      ],
    },
  });
}

export function trackBeginCheckout(items: {
  id: string;
  name: string;
  price: number;
  quantity: number;
}[], currency: string, value: number) {
  push({ ecommerce: null });
  push({
    event: "begin_checkout",
    ecommerce: {
      currency,
      value,
      items: items.map((item) => ({
        item_id: item.id,
        item_name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
    },
  });
}

// MS4.5: Custom events

export function trackSearch(query: string) {
  push({
    event: "search",
    search_term: query,
  });
}

export function trackSignUp(method: string = "shopify") {
  push({
    event: "sign_up",
    method,
  });
}

export function trackLogin(method: string = "shopify") {
  push({
    event: "login",
    method,
  });
}

export function trackSubscriptionSignup(plan: string, value: number, currency: string) {
  push({
    event: "subscription_signup",
    plan_name: plan,
    value,
    currency,
  });
}

export function trackEvent(eventName: string, params?: Record<string, unknown>) {
  push({
    event: eventName,
    ...params,
  });
}
