import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Sparkles } from "lucide-react";
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
}

export function Chat({ marketId, conversationId: initialConversationId }: ChatProps) {
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState(initialConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch messages if we have a conversation ID
  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/conversations", conversationId, "messages"],
    enabled: !!conversationId,
  });

  // Ask question mutation
  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      return await apiRequestJson(
        `/api/chat/ask`,
        "POST",
        {
          question: q,
          marketId,
          conversationId,
        }
      );
    },
    onSuccess: (data: any) => {
      // Update conversation ID if this is a new conversation
      if (!conversationId) {
        setConversationId(data.conversationId);
      }
      // Invalidate messages to refresh
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations", data.conversationId, "messages"],
      });
      setQuestion("");
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, askMutation.isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || askMutation.isPending) return;
    askMutation.mutate(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

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
        ) : messages.length === 0 ? (
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

            {/* Loading indicator for pending response */}
            {askMutation.isPending && (
              <div className="flex justify-start">
                <Card className="max-w-[85%] p-4 bg-muted">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Analyzing data...
                    </span>
                  </div>
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
            disabled={askMutation.isPending}
            data-testid="input-chat-question"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!question.trim() || askMutation.isPending}
            className="h-[60px] w-[60px]"
            data-testid="button-send-message"
          >
            {askMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        {askMutation.isError && (
          <p className="text-sm text-destructive mt-2" data-testid="text-error-message">
            Failed to send message. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}
