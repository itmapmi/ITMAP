import { z } from "zod";
import OpenAI from "openai";

// ── Zod schemas (exported so routes can validate + get typed data) ─────────

export const answerEntrySchema = z.object({
  questionId: z.string(),
  question: z.string(),
  cluster: z.enum(["purpose", "methodology", "drivers", "output"]),
  answer: z.string(),
  skipped: z.boolean(),
});

export type AnswerEntry = z.infer<typeof answerEntrySchema>;

export type QuestionCluster = "purpose" | "methodology" | "drivers" | "output";

// ── Question bank ──────────────────────────────────────────────────────────

interface QuestionTemplate {
  id: string;
  cluster: QuestionCluster;
  text: string;
  options?: string[];
  allowFreeText: boolean;
  expressDefault: string;
  expressIncluded: boolean;
  condition?: (answers: AnswerEntry[]) => boolean;
}

export interface InterviewQuestion {
  questionId: string;
  cluster: QuestionCluster;
  text: string;
  options?: string[];
  allowFreeText: boolean;
  progressMessage: string;
  totalAsked: number;
  estimatedRemaining: number;
  isLast: boolean;
}

const MAX_QUESTIONS_FULL = 12;
const MAX_QUESTIONS_EXPRESS = 5;

const QUESTION_BANK: QuestionTemplate[] = [
  {
    id: "purpose-1",
    cluster: "purpose",
    text: "What decision or deliverable is this forecast primarily supporting?",
    options: [
      "Internal strategy / planning",
      "Board or investor presentation",
      "M&A due diligence",
      "Market entry or expansion",
      "Academic / research",
    ],
    allowFreeText: true,
    expressDefault: "Internal strategy / planning",
    expressIncluded: true,
  },
  {
    id: "purpose-2",
    cluster: "purpose",
    text: "What confidence level do you need? Directional suits strategy decks. Decision-grade is for investment cases. M&A-grade requires primary data and carries higher cost.",
    options: [
      "Directional (±30% — fast, good for strategy)",
      "Decision-grade (±15% — solid investment case)",
      "M&A-grade (±8% — requires primary research)",
    ],
    allowFreeText: false,
    expressDefault: "Directional (±30% — fast, good for strategy)",
    expressIncluded: true,
  },
  {
    id: "method-1",
    cluster: "methodology",
    text: "Do you have a preferred approach for sizing this market?",
    options: [
      "Top-down (from macro to segment)",
      "Bottom-up (aggregate vendor revenues)",
      "Demand-side (TAM from buyer behaviour)",
      "Hybrid — let the system decide",
    ],
    allowFreeText: false,
    expressDefault: "Hybrid — let the system decide",
    expressIncluded: true,
  },
  {
    id: "method-2",
    cluster: "methodology",
    text: "Do you have a base year anchor — an existing data point or prior estimate to build from?",
    options: [
      "Yes, I have a specific number",
      "Yes, roughly (±20% confidence)",
      "No — start from scratch",
    ],
    allowFreeText: true,
    expressDefault: "No — start from scratch",
    expressIncluded: false,
  },
  {
    id: "drivers-1",
    cluster: "drivers",
    text: "What are the two or three most important forces driving growth in this market over the forecast period?",
    allowFreeText: true,
    expressDefault: "System will propose drivers based on the market definition.",
    expressIncluded: true,
  },
  {
    id: "drivers-2",
    cluster: "drivers",
    text: "Are there potential discontinuities — regulatory shifts, technology disruptions, or macro shocks — that could significantly alter the trajectory?",
    options: [
      "Yes — significant discontinuities are likely",
      "Possibly — one or two scenarios worth modelling",
      "No major discontinuities expected",
    ],
    allowFreeText: true,
    expressDefault: "Possibly — one or two scenarios worth modelling",
    expressIncluded: false,
  },
  {
    id: "drivers-3",
    cluster: "drivers",
    text: "Which adjacent markets should we track as leading indicators or scenario boundaries?",
    allowFreeText: true,
    expressDefault: "None specified — system will identify logical adjacencies.",
    expressIncluded: false,
    condition: (answers) =>
      !!answers.find(
        (a) =>
          a.questionId === "drivers-2" &&
          (a.answer.toLowerCase().includes("significant") || a.answer.toLowerCase().includes("yes — significant"))
      ),
  },
  {
    id: "output-1",
    cluster: "output",
    text: "How should the market be segmented in the output? (e.g. by deployment model, geography, customer size, use case, vertical)",
    allowFreeText: true,
    expressDefault: "Standard segmentation based on market structure.",
    expressIncluded: false,
  },
  {
    id: "output-2",
    cluster: "output",
    text: "Do you need scenario analysis, or is a single base case sufficient?",
    options: [
      "Bull / base / bear scenarios",
      "Base case with sensitivity tables only",
      "Single base case is enough",
    ],
    allowFreeText: false,
    expressDefault: "Bull / base / bear scenarios",
    expressIncluded: true,
  },
  {
    id: "output-3",
    cluster: "output",
    text: "Any specific source requirements? For M&A-grade work we typically require primary research.",
    options: [
      "Public sources only",
      "Vendor-disclosed data acceptable",
      "Any credible sources",
      "Must include primary research",
    ],
    allowFreeText: false,
    expressDefault: "Any credible sources",
    expressIncluded: false,
    condition: (answers) =>
      !!answers.find(
        (a) =>
          a.questionId === "purpose-1" &&
          (a.answer.toLowerCase().includes("m&a") || a.answer.toLowerCase().includes("due diligence"))
      ),
  },
];

// ── Progress message ───────────────────────────────────────────────────────

function getProgressMessage(answers: AnswerEntry[], _mode: "express" | "full"): string {
  const clusters = new Set(answers.filter((a) => !a.skipped).map((a) => a.cluster));
  const all: QuestionCluster[] = ["purpose", "methodology", "drivers", "output"];
  const covered = all.filter((c) => clusters.has(c));
  const remaining = all.filter((c) => !clusters.has(c));

  const LABELS: Record<QuestionCluster, string> = {
    purpose: "strategic context",
    methodology: "methodology",
    drivers: "market dynamics",
    output: "output preferences",
  };

  if (remaining.length === 0) return "All areas covered — ready to build your brief.";
  if (covered.length === 0) return "Let me understand your needs before we start modelling.";

  const coveredStr = covered.map((c) => LABELS[c]).join(", ");
  const remainingStr = remaining.map((c) => LABELS[c]).join(" and ");

  return `I have your ${coveredStr} — ${remaining.length === 1 ? "one more area" : `${remaining.length} more areas`} to cover: ${remainingStr}.`;
}

// ── LLM adaptive selector (full mode only) ────────────────────────────────
//
// Called once per question turn in full mode. Uses gpt-4o-mini to decide
// which of the eligible remaining questions is most valuable to ask next.
// Hard cap MAX_QUESTIONS_FULL prevents runaway loops.
// Falls back to the first eligible question on any error.

async function selectNextQuestionAdaptive(
  answers: AnswerEntry[],
  eligible: QuestionTemplate[]
): Promise<string> {
  if (eligible.length <= 1) return eligible[0]?.id ?? "";

  const client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const systemPrompt = `You are managing a concise market forecast interview.
Select the SINGLE most valuable next question given what the user has already told you.
If an earlier answer has already covered a topic, skip the overlapping question.
Respond with ONLY valid JSON: { "nextQuestionId": string }
nextQuestionId must be one of the eligible IDs provided.`;

  const userPrompt = JSON.stringify({
    answeredSoFar: answers.map((a) => ({
      questionId: a.questionId,
      cluster: a.cluster,
      answer: a.answer.slice(0, 120),
    })),
    eligibleQuestions: eligible.map((q) => ({
      id: q.id,
      cluster: q.cluster,
      shortText: q.text.slice(0, 100),
    })),
  });

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 60,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return eligible[0].id;

    const parsed = JSON.parse(content) as { nextQuestionId?: unknown };
    const selectedId = parsed.nextQuestionId;
    if (typeof selectedId === "string" && eligible.some((q) => q.id === selectedId)) {
      return selectedId;
    }
    return eligible[0].id;
  } catch {
    return eligible[0].id;
  }
}

// ── Public interface ───────────────────────────────────────────────────────

export async function getNextQuestion(
  answers: AnswerEntry[],
  mode: "express" | "full"
): Promise<InterviewQuestion | null> {
  const answeredIds = new Set(answers.map((a) => a.questionId));
  const maxQ = mode === "express" ? MAX_QUESTIONS_EXPRESS : MAX_QUESTIONS_FULL;

  // Hard cap
  if (answers.length >= maxQ) return null;

  const eligible = QUESTION_BANK.filter((q) => {
    if (answeredIds.has(q.id)) return false;
    if (mode === "express" && !q.expressIncluded) return false;
    if (q.condition && !q.condition(answers)) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  // Adaptive LLM selection in full mode
  const nextId =
    mode === "full" && eligible.length > 1
      ? await selectNextQuestionAdaptive(answers, eligible)
      : eligible[0].id;

  const next = eligible.find((q) => q.id === nextId) ?? eligible[0];

  const totalQuestions = mode === "express"
    ? QUESTION_BANK.filter((q) => q.expressIncluded).length
    : Math.min(eligible.length + answers.length, 10); // estimate

  const estimatedRemaining = Math.max(0, eligible.length - 1);

  return {
    questionId: next.id,
    cluster: next.cluster,
    text: next.text,
    options: next.options,
    allowFreeText: next.allowFreeText,
    progressMessage: getProgressMessage(answers, mode),
    totalAsked: answers.length + 1,
    estimatedRemaining,
    isLast: estimatedRemaining === 0,
  };
}

export function getDefaultForQuestion(questionId: string): { defaultAnswer: string; rationale: string } | null {
  const q = QUESTION_BANK.find((q) => q.id === questionId);
  if (!q) return null;

  const rationales: Record<string, string> = {
    "purpose-1": "I'll treat this as supporting internal planning, which uses the most balanced methodology.",
    "purpose-2": "I'll target directional confidence (±30%), appropriate for most strategy work and faster to produce.",
    "method-1": "I'll use a hybrid approach blending top-down macro sizing with bottom-up vendor triangulation.",
    "method-2": "I'll build the base year from scratch using available public data.",
    "drivers-1": "I'll propose the most commonly cited growth drivers for this market type based on the boundary.",
    "drivers-2": "I'll assume moderate discontinuity risk and include one adverse scenario pathway.",
    "drivers-3": "I'll identify adjacent markets automatically from the boundary definition.",
    "output-1": "I'll use the most natural segmentation for how participants in this market typically report.",
    "output-2": "I'll produce bull, base, and bear scenarios — maximum flexibility at no extra cost.",
    "output-3": "I'll use any credible public sources, citing each one in the audit trail.",
  };

  return {
    defaultAnswer: q.expressDefault,
    rationale: rationales[q.id] ?? "I'll apply the standard default for this question type.",
  };
}

export function getSkipConsequence(questionId: string): { consequence: string; defaultApplied: string } | null {
  const q = QUESTION_BANK.find((q) => q.id === questionId);
  if (!q) return null;

  const consequences: Record<string, string> = {
    "purpose-1": "Without strategic context, I'll calibrate for general-purpose analysis rather than a specific decision.",
    "purpose-2": "I'll target directional confidence. Return to this if you need investment-grade precision.",
    "method-1": "I'll choose the methodology best suited to the available data — likely a hybrid approach.",
    "method-2": "I'll build the base year estimate entirely from public sources.",
    "drivers-1": "I'll propose drivers myself, but your input here makes them significantly more defensible.",
    "drivers-2": "I'll model a standard bull/base/bear spread without a specific discontinuity scenario.",
    "drivers-3": "I'll note adjacent markets in the brief without specifically weighting them as indicators.",
    "output-1": "I'll use the segmentation I judge most analytically useful for this market type.",
    "output-2": "I'll produce three scenarios (bull/base/bear).",
    "output-3": "I'll use any credible public source, citing each in the audit log.",
  };

  return {
    consequence: consequences[q.id] ?? "I'll apply a sensible default for this area.",
    defaultApplied: q.expressDefault,
  };
}

export interface AssembledBrief {
  interviewMode: "express" | "full";
  purpose: string | null;
  confidenceLevel: string | null;
  audience: string | null;
  methodologyPreference: string | null;
  baseYearAnchor: string | null;
  drivers: string[];
  discontinuities: string[];
  adjacentMarkets: string[];
  outputFormat: string | null;
  sourceRequirements: string | null;
  interviewTranscript: { question: string; answer: string }[];
}

export function assembleBrief(answers: AnswerEntry[], mode: "express" | "full"): AssembledBrief {
  const get = (id: string) => answers.find((a) => a.questionId === id)?.answer ?? null;
  const wasSkipped = (id: string) => answers.find((a) => a.questionId === id)?.skipped ?? false;

  const confidenceRaw = get("purpose-2") ?? "";
  let confidenceLevel: string | null = null;
  if (confidenceRaw.toLowerCase().includes("directional")) confidenceLevel = "directional";
  else if (confidenceRaw.toLowerCase().includes("decision")) confidenceLevel = "decision-grade";
  else if (confidenceRaw.toLowerCase().includes("m&a") || confidenceRaw.toLowerCase().includes("8%"))
    confidenceLevel = "M&A-grade";

  const methodRaw = get("method-1") ?? "";
  let methodologyPreference: string | null = null;
  if (methodRaw.toLowerCase().includes("top-down")) methodologyPreference = "top-down";
  else if (methodRaw.toLowerCase().includes("bottom-up")) methodologyPreference = "bottom-up";
  else if (methodRaw.toLowerCase().includes("demand")) methodologyPreference = "demand-side";
  else methodologyPreference = "hybrid";

  const driversRaw = get("drivers-1") ?? "";
  const drivers =
    driversRaw && !wasSkipped("drivers-1")
      ? driversRaw.split(/[,;\n•\-]+/).map((s) => s.trim()).filter(Boolean)
      : [];

  const discontRaw = get("drivers-2") ?? "";
  const discontinuities = discontRaw && !wasSkipped("drivers-2") ? [discontRaw] : [];

  const adjRaw = get("drivers-3") ?? "";
  const adjacentMarkets =
    adjRaw && !wasSkipped("drivers-3")
      ? adjRaw.split(/[,;\n•\-]+/).map((s) => s.trim()).filter(Boolean)
      : [];

  const outputRaw = get("output-1");
  const scenarioRaw = get("output-2");
  const outputFormat = [outputRaw, scenarioRaw].filter(Boolean).join(" | ") || null;

  return {
    interviewMode: mode,
    purpose: get("purpose-1"),
    confidenceLevel,
    audience: null,
    methodologyPreference,
    baseYearAnchor: get("method-2"),
    drivers,
    discontinuities,
    adjacentMarkets,
    outputFormat,
    sourceRequirements: get("output-3"),
    interviewTranscript: answers.map((a) => ({ question: a.question, answer: a.answer })),
  };
}
