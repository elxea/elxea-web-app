/**
 * elxea CX Agent 用カスタム ChatTransport
 *
 * Vercel AI SDK の useChat が期待する ChatTransport インターフェースを実装し、
 * Workers API の { message, session_id } → SSE レスポンス形式と橋渡しする。
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

// ---------------------------------------------------------------------------
// Types (H-4: product_card / quick_replies イベント)
// ---------------------------------------------------------------------------

export type ProductCardItem = {
  name: string;
  price: string;
  url: string;
  image: string | null;
  description: string;
};

export type QuickReplyItem = {
  label: string;
  text: string;
};

/** SSE イベントのコールバック（UI ステート管理に使用） */
export interface ChatEventCallbacks {
  onProductCards?: (products: ProductCardItem[]) => void;
  onQuickReplies?: (items: QuickReplyItem[]) => void;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface ElxeaChatTransportOptions {
  /** Workers API の URL（例: https://elxea-agent.setaka.workers.dev/api/chat） */
  api: string;
  /** セッション ID を返す関数（遅延評価で最新値を取得） */
  getSessionId: () => string;
  /** Shopify Customer ID を返す関数（null = 未ログイン） */
  getShopifyCustomerId?: () => string | null;
  /** SSE イベントコールバック */
  callbacks?: ChatEventCallbacks;
}

export class ElxeaChatTransport implements ChatTransport<UIMessage> {
  private api: string;
  private getSessionId: () => string;
  private getShopifyCustomerId: () => string | null;
  private callbacks: ChatEventCallbacks;
  private abortController: AbortController | null = null;

  constructor(options: ElxeaChatTransportOptions) {
    this.api = options.api;
    this.getSessionId = options.getSessionId;
    this.getShopifyCustomerId = options.getShopifyCustomerId ?? (() => null);
    this.callbacks = options.callbacks ?? {};
  }

  /**
   * Abort any in-flight SSE request. Call this on component unmount
   * to prevent leaked connections and state updates after unmount.
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async sendMessages({
    messages,
  }: {
    messages: UIMessage[];
  }): Promise<ReadableStream<UIMessageChunk>> {
    // 最新のユーザーメッセージを取得
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const messageText =
      lastUserMsg?.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("") ?? "";

    const sessionId = this.getSessionId();
    if (!messageText || !sessionId) {
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    }

    // Workers API にリクエスト
    // ログイン済みユーザーは shopify_customer_id を送信して
    // cx-agent 側で identity resolution を行う
    const shopifyCustomerId = this.getShopifyCustomerId();
    const requestBody: Record<string, string> = {
      message: messageText,
      session_id: sessionId,
    };
    if (shopifyCustomerId) {
      requestBody.shopify_customer_id = shopifyCustomerId;
    }

    // Abort previous request if still in-flight
    this.abortController?.abort();
    this.abortController = new AbortController();

    const response = await fetch(this.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Chat API error: ${response.status} ${errorText}`);
    }

    const body = response.body;
    if (!body) throw new Error("No response body");

    // Workers の SSE レスポンスを Vercel AI SDK の UIMessageChunk に変換
    const partId = crypto.randomUUID();
    let textStarted = false;
    let textEnded = false;
    const callbacks = this.callbacks;

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue;

              try {
                const event = JSON.parse(jsonStr);

                if (event.type === "text_delta" && event.content) {
                  if (!textStarted) {
                    controller.enqueue({
                      type: "text-start",
                      id: partId,
                    } as UIMessageChunk);
                    textStarted = true;
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: partId,
                    delta: event.content,
                  } as UIMessageChunk);
                }

                // H-4: product_card イベントをコールバック経由で UI に伝達
                if (event.type === "product_card" && event.products) {
                  callbacks.onProductCards?.(event.products as ProductCardItem[]);
                }

                // H-4: quick_replies イベントをコールバック経由で UI に伝達
                if (event.type === "quick_replies" && event.items) {
                  callbacks.onQuickReplies?.(event.items as QuickReplyItem[]);
                }

                if (event.type === "done") {
                  if (textStarted && !textEnded) {
                    controller.enqueue({
                      type: "text-end",
                      id: partId,
                    } as UIMessageChunk);
                    textEnded = true;
                  }
                }
              } catch {
                // JSON パース失敗は無視
              }
            }
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        } finally {
          // H-5: text-end 送信保証 — ストリーム終了時に未送信なら必ず送る
          if (textStarted && !textEnded) {
            controller.enqueue({
              type: "text-end",
              id: partId,
            } as UIMessageChunk);
          }
          controller.close();
        }
      },
    });
  }

  async resumeStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
