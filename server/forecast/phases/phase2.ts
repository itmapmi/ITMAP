import { z } from "zod";
import OpenAI from "openai";

// ── Zod schemas (exported so routes can validate + get typed data) ─────────

export const answerEntrySchema = z.object({
  questionId: z.string(),
  question: z.string(),
  cluster: z.enum(["boundary", "purpose", "methodology", "drivers", "output"]),
  answer: z.string(),
  skipped: z.boolean(),
});

export type AnswerEntry = z.infer<typeof answerEntrySchema>;

export type QuestionCluster = "boundary" | "purpose" | "methodology" | "drivers" | "output";

// ── Question bank ──────────────────────────────────────────────────────────
// Five clusters (2–4 questions each):
//   boundary     — validate and sharpen the AI-extracted boundary
//   purpose      — strategic context for the forecast
//   methodology  — sizing approach and base-year anchor
//   drivers      — growth forces and discontinuities
//   output       — segmentation, scenarios, source requirements

interface QuestionTemplate {
  id: string;
  cluster: QuestionCluster;
  text: string;
  options?: string[];
  allowFreeText: boolean;
  expressDefault: string;  // applied in assembleBrief for unasked express questions
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
const MIN_QUESTIONS_FULL = 8;   // full mode must ask at least this many before allowing early done
const MAX_QUESTIONS_EXPRESS = 5;

const QUESTION_BANK: QuestionTemplate[] = [
  // ── Cluster 1: boundary ─────────────────────────────────────────────────
  {
    id: "boundary-1",
    cluster: "boundary",
    text: "Looking at the market scope I extracted — are there any key segments that should be included but aren't, or segments I've included that should be out of scope?",
    allowFreeText: true,
    expressDefault: "The extracted boundary looks correct.",
    expressIncluded: true,
  },
  {
    id: "boundary-2",
    cluster: "boundary",
    text: "Is there a specific customer profile or deal size this market should focus on? (e.g. enterprise only, SMB, public sector, or all segments)",
    options: [
      "All segments (no filter)",
      "Enterprise / large accounts only",
      "SMB / mid-market",
      "Public sector / government",
    ],
    allowFreeText: true,
    expressDefault: "All segments (no filter)",
    expressIncluded: false,
  },
  {
    id: "boundary-3",
    cluster: "boundary",
    text: "Should adjacent or enabling technology layers be included in this forecast? (e.g. implementation services, hardware, complementary SaaS)",
    options: [
      "No — software / platform revenue only",
      "Yes — include associated services revenue",
      "Yes — include hardware where bundled",
      "Depends — I'll define the boundaries in the scope",
    ],
    allowFreeText: true,
    expressDefault: "No — software / platform revenue only",
    expressIncluded: false,
  },

  // ── Cluster 2: purpose ──────────────────────────────────────────────────
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
    text: "What confidence level do you need? Directional suits strategy decks. Decision-grade is for investment cases. M&A-grade requires primary data.",
    options: [
      "Directional (±30% — fast, good for strategy)",
      "Decision-grade (±15% — solid investment case)",
      "M&A-grade (±8% — requires primary research)",
    ],
    allowFreeText: false,
    expressDefault: "Directional (±30% — fast, good for strategy)",
    expressIncluded: false,
  },

  // ── Cluster 3: methodology ──────────────────────────────────────────────
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

  // ── Cluster 4: drivers ──────────────────────────────────────────────────
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

  // ── Cluster 5: output ───────────────────────────────────────────────────
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
  const all: QuestionCluster[] = ["boundary", "purpose", "methodology", "drivers", "output"];
  const covered = all.filter((c) => clusters.has(c));
  const remaining = all.filter((c) => !clusters.has(c));

  const LABELS: Record<QuestionCluster, string> = {
    boundary: "scope validation",
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
// After each answer in full mode, calls gpt-4o-mini to decide the best next
// question from the eligible pool. The LLM may also signal the interview is
// complete by returning `{ done: true }` — this allows early termination when
// all important areas have already been addressed by earlier answers.

const adaptiveSelectorResponseSchema = z.union([
  z.object({ done: z.literal(true) }),
  z.object({ done: z.literal(false).optional(), nextQuestionId: z.string() }),
]);

async function selectNextQuestionAdaptive(
  answers: AnswerEntry[],
  eligible: QuestionTemplate[]
): Promise<string | "DONE"> {
  if (eligible.length === 0) return "DONE";
  if (eligible.length === 1) return eligible[0].id;

  const client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const systemPrompt = `You are managing a concise market forecast interview.
Review the answers given so far and decide what to do next.

Option A — If the remaining questions would add no new information beyond what the user
has already provided, return: { "done": true }

Option B — Otherwise, select the SINGLE most valuable next question from the eligible
list and return: { "nextQuestionId": "<id>" }

Return ONLY valid JSON matching one of these two shapes. nextQuestionId must be one
of the eligible IDs provided.`;

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
      max_tokens: 80,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return eligible[0].id;

    const raw = JSON.parse(content);
    const parsed = adaptiveSelectorResponseSchema.safeParse(raw);
    if (!parsed.success) return eligible[0].id;

    if (parsed.data.done === true) return "DONE";
    if ("nextQuestionId" in parsed.data) {
      const id = parsed.data.nextQuestionId;
      if (eligible.some((q) => q.id === id)) return id;
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

  if (answers.length >= maxQ) return null;

  const eligible = QUESTION_BANK.filter((q) => {
    if (answeredIds.has(q.id)) return false;
    if (mode === "express" && !q.expressIncluded) return false;
    if (q.condition && !q.condition(answers)) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  let nextId: string | "DONE";
  if (mode === "full" && eligible.length > 1) {
    nextId = await selectNextQuestionAdaptive(answers, eligible);
  } else {
    nextId = eligible[0].id;
  }

  // LLM signalled interview is complete — honour only after minimum floor
  if (nextId === "DONE") {
    if (mode === "full" && answers.length < MIN_QUESTIONS_FULL) {
      // Below floor: override the done signal and continue with next eligible question
      nextId = eligible[0].id;
    } else {
      return null;
    }
  }

  const next = eligible.find((q) => q.id === nextId) ?? eligible[0];

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
    "boundary-1": "I'll treat the extracted scope as accurate and proceed.",
    "boundary-2": "I'll include all customer segments in the total addressable market.",
    "boundary-3": "I'll track software and platform revenue only, excluding services and hardware.",
    "purpose-1": "I'll treat this as supporting internal planning, which uses the most balanced methodology.",
    "purpose-2": "I'll target directional confidence (±30%), appropriate for most strategy work.",
    "method-1": "I'll use a hybrid approach blending top-down macro sizing with bottom-up vendor triangulation.",
    "method-2": "I'll build the base year from scratch using available public data.",
    "drivers-1": "I'll propose the most commonly cited growth drivers for this market type based on the boundary.",
    "drivers-2": "I'll assume moderate discontinuity risk and include one adverse scenario pathway.",
    "drivers-3": "I'll identify adjacent markets automatically from the boundary definition.",
    "output-1": "I'll use the most natural segmentation for how participants in this market typically report.",
    "output-2": "I'll produce bull, base, and bear scenarios.",
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
    "boundary-1": "I'll proceed with the AI-extracted boundary as-is.",
    "boundary-2": "I'll size the total market across all customer segments without restriction.",
    "boundary-3": "I'll focus on core software/platform revenue and exclude adjacent layers.",
    "purpose-1": "Without strategic context, I'll calibrate for general-purpose analysis.",
    "purpose-2": "I'll target directional confidence. Return to this if you need investment-grade precision.",
    "method-1": "I'll choose the methodology best suited to the available data.",
    "method-2": "I'll build the base year estimate entirely from public sources.",
    "drivers-1": "I'll propose drivers myself, but your input here makes them significantly more defensible.",
    "drivers-2": "I'll model a standard bull/base/bear spread without a specific discontinuity scenario.",
    "drivers-3": "I'll note adjacent markets in the brief without specifically weighting them.",
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
  purpose: string;
  confidenceLevel: string;
  audience: string | null;
  methodologyPreference: string;
  baseYearAnchor: string | null;
  drivers: string[];
  discontinuities: string[];
  adjacentMarkets: string[];
  outputFormat: string;
  sourceRequirements: string;
  interviewTranscript: { question: string; answer: string }[];
}

// Helper: get answered value or fall back to the question's expressDefault.
// This ensures every brief field is populated regardless of interview mode.
function resolve(answers: AnswerEntry[], questionId: string): string {
  const entry = answers.find((a) => a.questionId === questionId);
  if (entry) return entry.answer;
  const q = QUESTION_BANK.find((q) => q.id === questionId);
  return q?.expressDefault ?? "";
}

export function assembleBrief(answers: AnswerEntry[], mode: "express" | "full"): AssembledBrief {
  // For every question not explicitly answered, resolve() returns the
  // question's expressDefault — ensuring no field is ever null/empty.

  const purposeRaw = resolve(answers, "purpose-1");
  const confidenceRaw = resolve(answers, "purpose-2");
  let confidenceLevel = "directional";
  if (confidenceRaw.toLowerCase().includes("decision")) confidenceLevel = "decision-grade";
  else if (confidenceRaw.toLowerCase().includes("m&a") || confidenceRaw.toLowerCase().includes("8%"))
    confidenceLevel = "M&A-grade";

  const methodRaw = resolve(answers, "method-1");
  let methodologyPreference = "hybrid";
  if (methodRaw.toLowerCase().includes("top-down")) methodologyPreference = "top-down";
  else if (methodRaw.toLowerCase().includes("bottom-up")) methodologyPreference = "bottom-up";
  else if (methodRaw.toLowerCase().includes("demand")) methodologyPreference = "demand-side";

  const driversRaw = resolve(answers, "drivers-1");
  const drivers = driversRaw
    ? driversRaw.split(/[,;\n•\-]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  const discontRaw = resolve(answers, "drivers-2");
  const discontinuities = discontRaw ? [discontRaw] : [];

  const adjRaw = answers.find((a) => a.questionId === "drivers-3")?.answer ?? "";
  const adjacentMarkets = adjRaw
    ? adjRaw.split(/[,;\n•\-]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  const segmentationRaw = resolve(answers, "output-1");
  const scenarioRaw = resolve(answers, "output-2");
  const outputFormat = [segmentationRaw, scenarioRaw].filter(Boolean).join(" | ");

  const sourceRaw = resolve(answers, "output-3");

  return {
    interviewMode: mode,
    purpose: purposeRaw,
    confidenceLevel,
    audience: null,
    methodologyPreference,
    baseYearAnchor: answers.find((a) => a.questionId === "method-2")?.answer ?? null,
    drivers,
    discontinuities,
    adjacentMarkets,
    outputFormat,
    sourceRequirements: sourceRaw,
    interviewTranscript: answers.map((a) => ({ question: a.question, answer: a.answer })),
  };
}
