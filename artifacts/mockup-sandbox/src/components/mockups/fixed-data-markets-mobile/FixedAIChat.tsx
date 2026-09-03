import { useState } from "react";
import { Bot, FileText, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Shell, Section } from "./_shared";
import "./_ai-chat.css";

type Message = { role: "user" | "assistant"; content: string; sources?: string[] };

const starterMessages: Message[] = [
  { role: "user", content: "How do Dell and HPE compare on the stored evaluation criteria?" },
  { role: "assistant", content: "Using the published evaluation rows for this market, Dell records higher scores on Product capabilities (84 vs 78), Customer experience (76 vs 73), and Innovation (81 vs 69). HPE records higher scores on Business model (82 vs 79). Dell also records the higher Revenue score (88 vs 85).", sources: ["Vendor Evaluation · criterion scores"] },
  { role: "user", content: "Which vendor is positioned as a Leader?" },
  { role: "assistant", content: "The stored quadrant positions show Dell at (78, 72) and HPE at (61, 57). This frame does not apply a separate Leader label; the coordinates are the available market positioning evidence.", sources: ["Vendor Evaluation · quadrant positions"] },
];

export function FixedAIChat() {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [question, setQuestion] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);

  const submit = (value = question) => {
    const q = value.trim();
    if (!q || analyzing) return;
    setError("");
    setQuestion("");
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setAnalyzing(true);
    window.setTimeout(() => {
      const known = /vendor|dell|hpe|exaGrid|ibm|quantum|score|criterion|quadrant|position|news|product|ecosystem/i.test(q);
      if (!known) {
        setError("This assistant answers only from the selected market's stored evidence. Try a question about vendors, scores, product or ecosystem support, news, or quadrant positions.");
        setAnalyzing(false);
        return;
      }
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "I found the relevant stored records, but this fixed-data view does not generate a new interpretation for that question. Open the cited evidence sections to inspect the underlying rows.",
        sources: ["Market evidence workspace · stored records"],
      }]);
      setAnalyzing(false);
    }, 1050);
  };

  return <Shell active="ai" title="AI market analyst" subtitle="Ask precise questions about this published market. Answers stay inside the stored evaluation evidence.">
    <div className="ai-page">
      <div className="ai-context"><span className="status"/><strong>Analyst context active</strong><small>CONTINUITY · ON</small></div>
      <div className="ai-scope">
        <div className="ai-scope-top"><span className="fdm-label">Market scope</span><button onClick={() => setScopeOpen(v => !v)}>{scopeOpen ? "Hide scope" : "What can I ask?"}</button></div>
        <strong>Backup &amp; Recovery</strong>
        {scopeOpen && <p>Stored market definition, vendors, criterion scores and comments, product and ecosystem support, recent vendor news, and quadrant positions. No browsing or outside sources.</p>}
        {!scopeOpen && <p><code>5 vendors · 5 criteria · snapshot 18 Jun 2024</code></p>}
      </div>
      <Section n="01" title="Research thread" action={<button className="fdm-link" onClick={() => setMessages(starterMessages)}><RotateCcw size={12}/> Reset</button>}>
        <div className="ai-thread">
          {messages.map((message, i) => <div className={`ai-msg ${message.role}`} key={`${message.role}-${i}`}>
            {message.role === "assistant" && <span className="ai-avatar"><Bot size={13}/></span>}
            <div className="ai-bubble"><p>{message.content}</p>{message.role === "assistant" && message.content.includes("Dell records") && <table className="ai-table"><thead><tr><th>Criterion</th><th>Dell</th><th>HPE</th></tr></thead><tbody><tr><td>Product capabilities</td><td>84</td><td>78</td></tr><tr><td>Innovation</td><td>81</td><td>69</td></tr><tr><td>Revenue</td><td>88</td><td>85</td></tr></tbody></table>}{message.sources?.map(source => <span className="ai-cite" key={source}><FileText size={11}/>{source}</span>)}</div>
          </div>)}
          {analyzing && <div className="ai-msg assistant"><span className="ai-avatar"><Bot size={13}/></span><div className="ai-bubble ai-analyzing"><span className="ai-dots"><i/><i/><i/></span>Analyzing stored evidence</div></div>}
        </div>
      </Section>
      <div className="ai-prompts">{["Compare Dell and HPE scores","What news is stored?","Show ecosystem support"].map(prompt => <button key={prompt} onClick={() => submit(prompt)}>{prompt}</button>)}</div>
      <div className="ai-composer"><form onSubmit={event => { event.preventDefault(); submit(); }}><textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about this market's evidence…" aria-label="Ask about this market's evidence" disabled={analyzing}/><button className="ai-send" type="submit" disabled={!question.trim() || analyzing} aria-label="Submit question"><Send size={17}/></button></form>{error && <div className="ai-error">{error}</div>}<p className="ai-footnote"><ShieldCheck size={11} style={{verticalAlign:"-2px",marginRight:4}}/>Answers are grounded in stored ITMAP market evidence. Conversation context persists in this thread.</p></div>
    </div>
  </Shell>;
}

export default FixedAIChat;