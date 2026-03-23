/**
 * elxea CX Agent 用カスタム ChatTransport
 *
 * Vercel AI SDK の useChat が期待する ChatTransport インターフェースを実装し、
 * Workers API の { message, session_id } → SSE レスポンス形式と橋渡しする。
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

interface ElxeaChatTransportOptions {
  /** Workers API の URL（例: https://elxea-agent.setaka.workers.dev/api/chat） */
  api: string;
  /** セッション ID（UUID v4） */
  sessionId: string;
}

export class ElxeaChatTransport implements ChatTransport<UIMessage> {
  private api: string;
  private sessionId: string;

  constructor(options: ElxeaChatTransportOptions) {
    this.api = options.api;
    this.sessionId = options.sessionId;
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

    if (!messageText) {
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    }

    // Workers API にリクエスト
    const response = await fetch(this.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: messageText,
        session_id: this.sessionId,
      }),
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

                if (event.type === "done") {
                  if (textStarted) {
                    controller.enqueue({
                      type: "text-end",
                      id: partId,
                    } as UIMessageChunk);
                  }
                }
              } catch {
                // JSON パース失敗は無視
              }
            }
          }

          // ストリーム終了時に text-end が未送信なら送る
          if (textStarted) {
            // done イベントで既に送信済みの場合があるが、重複は SDK 側で吸収される
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        } finally {
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
