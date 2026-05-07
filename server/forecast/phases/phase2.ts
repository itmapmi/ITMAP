export type QuestionCluster = "purpose" | "methodology" | "drivers" | "output";

export interface QuestionTemplate {
  id: string;
  cluster: QuestionCluster;
  text: string;
  options?: string[];
  allowFreeText: boolean;
  expressDefault: string;
  expressIncluded: boolean;
  condition?: (answers: AnswerEntry[]) => boolean;
}

export interface AnswerEntry {
  questionId: string;
  question: string;
  cluster: QuestionCluster;
  answer: string;
  skipped: boolean;
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

export const QUESTION_BANK: QuestionTemplate[] = [
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
    options: undefined,
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
    options: undefined,
    allowFreeText: true,
    expressDefault: "None specified — system will identify logical adjacencies.",
    expressIncluded: false,
    condition: (answers) =>
      !!answers.find(
        (a) =>
          a.questionId === "drivers-2" &&
          (a.answer.toLowerCase().includes("significant") || a.answer.toLowerCase().includes("yes"))
      ),
  },
  {
    id: "output-1",
    cluster: "output",
    text: "How should the market be segmented in the output? (e.g. by deployment model, geography, customer size, use case, vertical)",
    options: undefined,
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

function getProgressMessage(answers: AnswerEntry[], mode: "express" | "full"): string {
  const clusters = new Set(answers.filter((a) => !a.skipped).map((a) => a.cluster));
  const covered: string[] = [];
  const remaining: string[] = [];

  if (clusters.has("purpose")) covered.push("strategic context");
  else remaining.push("strategic context");

  if (clusters.has("methodology")) covered.push("methodology");
  else remaining.push("methodology");

  if (clusters.has("drivers")) covered.push("market dynamics");
  else remaining.push("market dynamics");

  if (clusters.has("output")) covered.push("output preferences");
  else remaining.push("output preferences");

  if (remaining.length === 0) return "All areas covered — ready to build your brief.";
  if (covered.length === 0) return "Let me understand your needs before we start modelling.";

  const coveredStr = covered.length === 1 ? covered[0] : covered.slice(0, -1).join(", ") + " and " + covered.slice(-1);
  const remainingStr =
    remaining.length === 1
      ? remaining[0]
      : remaining.length === 2
      ? remaining.join(" and ")
      : remaining.slice(0, -1).join(", ") + " and " + remaining.slice(-1);

  return `I have your ${coveredStr} — ${remaining.length === 1 ? "one more area" : `${remaining.length} more areas`} to cover: ${remainingStr}.`;
}

export function getNextQuestion(
  answers: AnswerEntry[],
  mode: "express" | "full"
): InterviewQuestion | null {
  const answeredIds = new Set(answers.map((a) => a.questionId));

  const eligibleQuestions = QUESTION_BANK.filter((q) => {
    if (answeredIds.has(q.id)) return false;
    if (mode === "express" && !q.expressIncluded) return false;
    if (q.condition && !q.condition(answers)) return false;
    return true;
  });

  if (eligibleQuestions.length === 0) return null;

  const next = eligibleQuestions[0];
  const total = QUESTION_BANK.filter((q) => {
    if (mode === "express" && !q.expressIncluded) return false;
    return true;
  }).length;

  const remaining = eligibleQuestions.length - 1;

  return {
    questionId: next.id,
    cluster: next.cluster,
    text: next.text,
    options: next.options,
    allowFreeText: next.allowFreeText,
    progressMessage: getProgressMessage(answers, mode),
    totalAsked: answers.length + 1,
    estimatedRemaining: remaining,
    isLast: remaining === 0,
  };
}

export function getDefaultForQuestion(questionId: string): { defaultAnswer: string; rationale: string } | null {
  const q = QUESTION_BANK.find((q) => q.id === questionId);
  if (!q) return null;

  const rationales: Record<string, string> = {
    "purpose-1": "I'll treat this as supporting internal planning, which uses the most balanced methodology.",
    "purpose-2":
      "I'll target directional confidence (±30%), which is appropriate for most strategy work and keeps the timeline manageable.",
    "method-1":
      "I'll use a hybrid approach, blending top-down macro sizing with bottom-up vendor triangulation.",
    "method-2": "I'll build the base year from scratch using available public data.",
    "drivers-1":
      "I'll propose the most commonly cited growth drivers for this market type based on the boundary you've defined.",
    "drivers-2":
      "I'll assume moderate discontinuity risk and include one scenario pathway for an adverse macro event.",
    "drivers-3":
      "I'll identify adjacent markets automatically based on the boundary definition.",
    "output-1":
      "I'll use the most natural segmentation for this market based on how participants typically report it.",
    "output-2":
      "I'll produce bull, base, and bear scenarios — this gives you the most flexibility at no extra cost.",
    "output-3":
      "I'll use any credible public sources, citing each one in the audit trail.",
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
    "purpose-2":
      "I'll target directional confidence. If you need investment-grade precision, come back and answer this.",
    "method-1":
      "I'll choose the methodology that best suits the available data — likely a hybrid approach.",
    "method-2": "I'll build the base year estimate entirely from public sources.",
    "drivers-1":
      "I'll propose the drivers myself, but your input here would make them much more defensible.",
    "drivers-2":
      "I'll model a standard bull/base/bear spread without a specific discontinuity scenario.",
    "drivers-3":
      "I'll note adjacent markets in the brief without specifically weighting them as indicators.",
    "output-1":
      "I'll use the segmentation I judge to be most analytically useful for this market.",
    "output-2": "I'll produce three scenarios (bull/base/bear).",
    "output-3":
      "I'll use any credible public source, citing each in the audit log.",
  };

  return {
    consequence: consequences[q.id] ?? "I'll apply a sensible default for this area.",
    defaultApplied: q.expressDefault,
  };
}

export function assembleBrief(answers: AnswerEntry[], mode: "express" | "full"): AssembledBrief {
  const get = (id: string) => answers.find((a) => a.questionId === id)?.answer ?? null;
  const raw = (id: string) => answers.find((a) => a.questionId === id);

  const confidenceRaw = get("purpose-2") ?? "";
  let confidenceLevel: string | null = null;
  if (confidenceRaw.toLowerCase().includes("directional")) confidenceLevel = "directional";
  else if (confidenceRaw.toLowerCase().includes("decision")) confidenceLevel = "decision-grade";
  else if (confidenceRaw.toLowerCase().includes("m&a")) confidenceLevel = "M&A-grade";

  const methodRaw = get("method-1") ?? "";
  let methodologyPreference: string | null = null;
  if (methodRaw.toLowerCase().includes("top-down")) methodologyPreference = "top-down";
  else if (methodRaw.toLowerCase().includes("bottom-up")) methodologyPreference = "bottom-up";
  else if (methodRaw.toLowerCase().includes("demand")) methodologyPreference = "demand-side";
  else if (methodRaw.toLowerCase().includes("hybrid") || methodRaw.toLowerCase().includes("let the system"))
    methodologyPreference = "hybrid";

  const driversRaw = get("drivers-1") ?? "";
  const drivers =
    driversRaw && !raw("drivers-1")?.skipped
      ? driversRaw
          .split(/[,;\n•\-]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const discontRaw = get("drivers-2") ?? "";
  const discontinuities =
    discontRaw && !raw("drivers-2")?.skipped ? [discontRaw].filter(Boolean) : [];

  const adjRaw = get("drivers-3") ?? "";
  const adjacentMarkets =
    adjRaw && !raw("drivers-3")?.skipped
      ? adjRaw
          .split(/[,;\n•\-]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const outputRaw = get("output-1") ?? null;
  const scenarioRaw = get("output-2") ?? null;
  const outputFormat = [outputRaw, scenarioRaw].filter(Boolean).join(" | ") || null;

  const transcript = answers.map((a) => ({ question: a.question, answer: a.answer }));

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
    interviewTranscript: transcript,
  };
}
