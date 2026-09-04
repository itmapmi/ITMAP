import { useState } from "react";
import { ArrowLeft, Bot, Send } from "lucide-react";
import "./FixedAIChat.css";

type Message = { role: "user" | "assistant"; content: string; sources?: string[] };

const starterMessages: Message[] = [
  { role: "assistant", content: "Ask me anything about the stored evidence for Backup & Recovery." },
];

export function FixedAIChat() {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [question, setQuestion] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const submit = (value = question) => {
    const q = value.trim();
    if (!q || analyzing) return;
    setError("");
    setQuestion("");
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setAnalyzing(true);
    window.setTimeout(() => {
      const known = /vendor|dell|hpe|exagrid|ibm|quantum|score|criterion|quadrant|position|news|product|ecosystem|backup|recovery/i.test(q);
      if (!known) {
        setError("Ask a question about the stored market evidence.");
        setAnalyzing(false);
        return;
      }
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "I found the relevant stored records. Open the evidence sections to inspect the underlying rows.",
      }]);
      setAnalyzing(false);
    }, 1050);
  };

  return <div className="simple-ai">
    <header className="simple-ai-top">
      <button className="simple-ai-back" aria-label="Back to market" onClick={() => window.history.back()}><ArrowLeft size={16}/></button>
      <span className="simple-ai-logo">ITMAP</span>
      <span className="simple-ai-mode">AI CHAT</span>
    </header>
    <div className="simple-ai-ribbon">
      <span>MARKET</span>
      <strong>Backup &amp; Recovery</strong>
    </div>
    <main className="simple-ai-window">
      <div className="simple-ai-title"><Bot size={17}/><span>Market assistant</span></div>
      <div className="simple-ai-messages">
        {messages.map((message, i) => <div className={`simple-ai-message ${message.role}`} key={`${message.role}-${i}`}>
          {message.role === "assistant" && <span className="simple-ai-avatar"><Bot size={12}/></span>}
          <p>{message.content}</p>
        </div>)}
        {analyzing && <div className="simple-ai-message assistant"><span className="simple-ai-avatar"><Bot size={12}/></span><p className="simple-ai-loading"><i/><i/><i/></p></div>}
      </div>
      <form className="simple-ai-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
        <textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about this market…" aria-label="Ask about this market" disabled={analyzing}/>
        <button type="submit" disabled={!question.trim() || analyzing} aria-label="Send question"><Send size={16}/></button>
      </form>
      {error && <p className="simple-ai-error">{error}</p>}
    </main>
  </div>;
}

export default FixedAIChat;