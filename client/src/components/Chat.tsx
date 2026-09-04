import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: any;
  createdAt: string;
}

interface ChatProps {
  marketId: string;
  conversationId?: string;
  mobileMode?: boolean;
  marketName?: string;
}

export function Chat({ marketId, conversationId: initialConversationId, mobileMode = false, marketName }: ChatProps) {
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/conversations", conversationId, "messages"],
    enabled: !!conversationId,
  });

  const autoScroll = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => { autoScroll(); }, [messages, streamingContent, isStreaming]);

  const sendMessage = async (q: string) => {
    if (!q.trim() || isStreaming) return;
    setStreamError(null);
    setStreamingContent("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ question: q, marketId, conversationId }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: any;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.token) {
            setStreamingContent((prev) => prev + event.token);
          } else if (event.done) {
            const cid: string = event.conversationId;
            setConversationId(cid);
            setStreamingContent("");
            setIsStreaming(false);
            queryClient.invalidateQueries({
              queryKey: ["/api/chat/conversations", cid, "messages"],
            });
          } else if (event.error) {
            setStreamError(event.error);
            setIsStreaming(false);
            setStreamingContent("");
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setStreamError("Failed to send message. Please try again.");
      }
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isStreaming) return;
    const q = question;
    setQuestion("");
    sendMessage(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (mobileMode) {
    const visibleMessages = streamingContent
      ? [...messages, { id: "streaming", role: "assistant" as const, content: streamingContent, createdAt: "" }]
      : messages;
    return (
      <div className="flex h-full min-h-0 flex-col bg-white font-[Montserrat] text-slate-950">
        <div className="flex min-h-[58px] items-center justify-between border-b border-slate-200 bg-blue-100 px-4">
          <span className="font-[Menlo] text-[10px] uppercase tracking-widest text-sky-800">Market</span>
          <strong className="text-right text-sm">{marketName || "Market evidence"}</strong>
        </div>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-semibold"><Bot className="h-4 w-4 text-sky-500" /> Market assistant</div>
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="chat-messages-area">
          {!loadingMessages && visibleMessages.length === 0 && (
            <div className="flex max-w-[88%] items-start gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-sky-500"><Bot className="h-3 w-3" /></span>
              <p className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-600">Ask me about the stored vendor scores, features, ecosystem support, news, and market positioning.</p>
            </div>
          )}
          {visibleMessages.map(msg => (
            <div key={msg.id} className={`flex max-w-[88%] items-start gap-2 ${msg.role === "user" ? "ml-auto" : ""}`}>
              {msg.role === "assistant" && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-sky-500"><Bot className="h-3 w-3" /></span>}
              <div className={`rounded border p-3 text-[13px] leading-relaxed ${msg.role === "user" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                {msg.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown> : <p className="whitespace-pre-wrap">{msg.content}</p>}
              </div>
            </div>
          ))}
          {isStreaming && !streamingContent && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-sky-500" /> Analyzing stored evidence…</div>}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 p-3">
          <Textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask about this market…" className="min-h-[46px] flex-1 resize-none bg-slate-50 text-[13px]" disabled={isStreaming} data-testid="input-chat-question" />
          <Button type="submit" size="icon" className="h-[46px] w-[46px] bg-sky-500 hover:bg-sky-600" disabled={!question.trim() || isStreaming} data-testid="button-send-message"><Send className="h-4 w-4" /></Button>
        </form>
        {streamError && <p className="px-3 pb-3 text-xs text-destructive">{streamError}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <ScrollArea
        ref={scrollRef}
        className="flex-1 p-4"
        data-testid="chat-messages-area"
      >
        {loadingMessages ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12">
            <Sparkles className="h-12 w-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Ask ITMAP AI</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Get insights about vendors, features, scores, recent news, and market positioning.
              I can answer questions like:
            </p>
            <ul className="text-xs text-muted-foreground mt-3 space-y-1 text-left">
              <li>• Who are the Leaders in this market?</li>
              <li>• Compare Vendor A vs Vendor B across all criteria</li>
              <li>• What are the recent news for Vendor X?</li>
              <li>• Which vendor has the best API Integration feature?</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`chat-message-${msg.role}-${msg.id}`}
              >
                <Card
                  className={`max-w-[85%] p-4 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-sm prose-thead:bg-muted prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </Card>
              </div>
            ))}

            {/* Live streaming bubble */}
            {isStreaming && (
              <div className="flex justify-start" data-testid="chat-message-streaming">
                <Card className="max-w-[85%] p-4 bg-muted">
                  {streamingContent ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-sm prose-thead:bg-muted prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Analyzing data…</span>
                    </div>
                  )}
                </Card>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about vendors, scores, features, or recent news..."
            className="flex-1 min-h-[60px] max-h-[120px] resize-none"
            disabled={isStreaming}
            data-testid="input-chat-question"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!question.trim() || isStreaming}
            className="h-[60px] w-[60px]"
            data-testid="button-send-message"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        {streamError && (
          <p className="text-sm text-destructive mt-2" data-testid="text-error-message">
            {streamError}
          </p>
        )}
      </div>
    </div>
  );
}
