"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const COMMENT_MAX_LENGTH = 500;

type CommentItem = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string | null;
  status: "pending" | "approved" | "rejected";
};

type CommentSectionProps = {
  /** "article" or "farmer" */
  targetType: "article" | "farmer";
  /** Sanity slug of the target */
  targetId: string;
  /** i18n strings */
  i18n: {
    title: string;
    placeholder: string;
    submit: string;
    submitting: string;
    loginRequired: string;
    postedMessage: string;
    deletedMessage: string;
    errorPosting: string;
    errorDeleting: string;
    noComments: string;
    delete: string;
    characterCount: string;
    moderation: string;
  };
  /** locale for date formatting */
  locale: string;
};

export function CommentSection({
  targetType,
  targetId,
  i18n,
  locale,
}: CommentSectionProps) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch comments on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchComments() {
      try {
        const url = `/api/user/comments?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch comments");
        const data = await res.json();
        if (!cancelled) {
          setComments(data.comments ?? []);
        }
      } catch {
        // Silently fail — empty state shown
      } finally {
        if (!cancelled) setIsLoadingComments(false);
      }
    }

    fetchComments();
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId]);

  // Detect logged-in user ID from cookie (numeric Shopify customer ID)
  useEffect(() => {
    if (typeof document !== "undefined") {
      const match = document.cookie.match(/shop_customer_id=([^;]+)/);
      if (match) setCurrentUserId(decodeURIComponent(match[1]));
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (typeof document !== "undefined" && !document.cookie.includes("shop_auth=1")) {
        toast(i18n.loginRequired);
        return;
      }

      const trimmed = body.trim();
      if (!trimmed) return;
      if (trimmed.length > COMMENT_MAX_LENGTH) return;

      setIsSubmitting(true);

      try {
        const res = await fetch("/api/user/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, body: trimmed }),
        });

        if (!res.ok) throw new Error("Failed to post comment");

        const data = await res.json();
        // Add optimistic comment (pending or approved depending on server)
        setComments((prev) => [
          {
            id: data.id,
            authorId: currentUserId ?? "",
            authorName: "You",
            body: trimmed,
            createdAt: new Date().toISOString(),
            status: "approved",
          },
          ...prev,
        ]);
        setBody("");
        toast(i18n.postedMessage);
      } catch {
        toast.error(i18n.errorPosting);
      } finally {
        setIsSubmitting(false);
      }
    },
    [body, targetType, targetId, currentUserId, i18n]
  );

  const handleDelete = useCallback(
    async (commentId: string) => {
      setDeletingId(commentId);

      try {
        const res = await fetch("/api/user/comments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId }),
        });

        if (!res.ok) throw new Error("Failed to delete comment");

        setComments((prev) => prev.filter((c) => c.id !== commentId));
        toast(i18n.deletedMessage);
      } catch {
        toast.error(i18n.errorDeleting);
      } finally {
        setDeletingId(null);
      }
    },
    [i18n]
  );

  const charCount = body.length;
  const isOverLimit = charCount > COMMENT_MAX_LENGTH;
  const isLoggedIn =
    typeof document !== "undefined" && document.cookie.includes("shop_auth=1");

  return (
    <section className="mt-16 pt-12 border-t border-border">
      <h2 className="text-lg mb-6 flex items-center gap-2">
        <MessageSquare className="size-5" aria-hidden="true" />
        {i18n.title}
        {!isLoadingComments && comments.length > 0 && (
          <span className="text-muted-foreground text-sm font-normal ml-1">
            ({comments.length})
          </span>
        )}
      </h2>

      {/* Comment form */}
      <form onSubmit={handleSubmit} className="mb-10">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={i18n.placeholder}
            rows={4}
            maxLength={COMMENT_MAX_LENGTH}
            disabled={isSubmitting}
            aria-label={i18n.placeholder}
            className={cn(
              "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isOverLimit && "border-destructive focus-visible:ring-destructive"
            )}
          />
          <span
            className={cn(
              "absolute bottom-2 right-3 text-xs",
              isOverLimit ? "text-destructive" : "text-muted-foreground"
            )}
            aria-live="polite"
          >
            {i18n.characterCount.replace("{count}", String(charCount))}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{i18n.moderation}</p>
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitting || !body.trim() || isOverLimit || !isLoggedIn}
          >
            {isSubmitting ? i18n.submitting : i18n.submit}
          </Button>
        </div>
      </form>

      {/* Comment list */}
      {isLoadingComments ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse space-y-2 py-4 border-b border-border">
              <div className="h-3 bg-muted w-1/4" />
              <div className="h-4 bg-muted w-3/4" />
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{i18n.noComments}</p>
      ) : (
        <div className="space-y-1">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="py-4 border-b border-border last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium truncate">
                      {comment.authorName}
                    </span>
                    {comment.createdAt && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(comment.createdAt).toLocaleDateString(locale, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {comment.body}
                  </p>
                </div>

                {/* Delete button — only for the comment author */}
                {currentUserId && comment.authorId === currentUserId && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(comment.id)}
                    disabled={deletingId === comment.id}
                    aria-label={i18n.delete}
                    className="shrink-0 mt-0.5"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
