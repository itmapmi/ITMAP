import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { getUnanalyzedNews, getRecentNewsByVendor, insertAnalysis } from './db.js';
import { fetchPageHtml } from './browser.js';

const DEMO_MODE = !process.env.OPENAI_API_KEY;

let openai;
function getOpenAI() {
    if (!openai && !DEMO_MODE) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

async function fetchArticleContent(url) {
    if (!url || !url.startsWith('http')) return '';

    try {
        const html = await fetchPageHtml(url);
        return extractArticleText(html);
    } catch (err) {
        console.log(`[Analyzer] Failed to fetch article content for ${url}: ${err.message}`);
        return '';
    }
}

function extractArticleText(html) {
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, svg, nav, footer, header, aside').remove();
    $('[class*="cookie"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="sidebar"], [class*="menu"], [class*="share"], [class*="social"], [class*="comment"], [class*="related"], [class*="recommend"]').remove();

    const articleSelectors = ['article', '[role="article"]', '.article-body', '.article-content', '.post-content', '.entry-content', '.blog-content', '.story-body', 'main'];
    let content = '';

    for (const selector of articleSelectors) {
        const el = $(selector);
        if (el.length > 0 && el.text().trim().length > 200) {
            content = el.text().trim();
            break;
        }
    }

    if (!content || content.length < 200) {
        content = $('body').text().trim();
    }

    return content
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 15000);
}

function getCategoryPrompt(category) {
    const prompts = {
        'Product Announcement': `=== PRODUCT LAUNCH / PRODUCT UPDATE ANALYSIS ===

P1 — THE SIGNAL: What is actually new here, stripped of marketing? Lead with the single most important technical or business fact. If this is incremental dressed up as transformative, say so plainly.

P2 — TECHNICAL ASSESSMENT: Evaluate the technical claims. What is the actual architecture? How does it differ from what this vendor already offered? What claims are unverified? What benchmarks or proof points are missing?

P3 — COMPETITIVE LANDSCAPE: Compare this announcement against SPECIFIC named competing products on: architecture approach and technical differentiation, performance claims (apples-to-apples where possible), pricing and licensing model, deployment flexibility (on-prem, hybrid, cloud, SaaS), ecosystem breadth and integration maturity, proven scale and production track record. State which competitors are directly threatened, which are unaffected, and which may actually benefit.

P4 — BUYER GUIDANCE: Concrete recommendations: If you're currently evaluating this vendor — what to ask in your next briefing. If you're a customer of a competitor — whether this changes your renewal calculus. If you're mid-procurement — whether to pause, accelerate, or add this to your shortlist. Timeline: when will this be production-ready and enterprise-proven?

P5 (if warranted) — RISKS: Execution risk, integration complexity, maturity concerns, dependency risks, or red flags.`,

        'Partnership': `=== PARTNERSHIP & ECOSYSTEM ANALYSIS ===

P1 — THE SIGNAL: What does this partnership actually deliver to customers? Is this a deep technical integration, a go-to-market arrangement, a certification, or just a logo swap? Distinguish between partnerships with real engineering investment vs. press-release-only alliances.

P2 — PARTNERSHIP DEPTH ASSESSMENT: Evaluate: What specific technical integration exists or is planned? Is this exclusive or does the partner work with competitors? Who benefits more — the vendor or the partner? What customer problem does this actually solve? What's the commercial model (resell, co-sell, OEM, referral)?

P3 — COMPETITIVE ECOSYSTEM MAP: Map out: What equivalent partnerships do competitors have? Does this close a gap or create new differentiation? Are there ecosystem lock-in or switching cost implications? Reference specific competitor partnerships.

P4 — BUYER IMPACT: For customers of this vendor and the partner: What new capabilities or workflows does this enable? What existing integrations might be affected? Is there a migration or upgrade required? How does this affect multi-vendor environments?

P5 (if warranted) — DURABILITY: What is the track record of partnerships in this space? How often do they lead to real product integration vs. quietly fading? Reference historical examples.`,

        'M&A': `=== M&A ANALYSIS ===

P1 — THE SIGNAL: What is the acquirer buying — technology, talent, customers, or market position? Lead with the strategic logic, not the press release narrative. State the deal terms if known (price, structure, expected close date).

P2 — TARGET ASSESSMENT: What is the target company's actual position? Product maturity and differentiation, customer base, revenue trajectory and profitability (if known), technology that the acquirer lacks, talent and IP value, known liabilities or risks.

P3 — STRATEGIC FIT & INTEGRATION RISK: How does this fill gaps in the acquirer's portfolio? What is the acquirer's track record integrating acquisitions? (Reference specific past acquisitions and their outcomes.) What comparable deals have competitors done? At what valuations? How did those turn out?

P4 — COMPETITIVE IMPLICATIONS: Name every vendor affected: Who loses a potential acquisition target? Who faces a stronger combined competitor? Who might respond with their own M&A? Who benefits if the integration stumbles? How does this shift market share dynamics in the segment?

P5 — BUYER GUIDANCE: If you're a customer of the target — what to expect during transition. If you're a customer of the acquirer — what changes to your roadmap. If you're evaluating alternatives — how this changes the shortlist. Red flags: product overlap that may lead to sunsetting, support disruption during integration, contractual changes.`,

        'Financial Results': `=== FINANCIAL RESULTS ANALYSIS ===

P1 — THE HEADLINE NUMBER IN CONTEXT: Lead with the most significant metric and immediately contextualize it. Compare to consensus estimates, prior guidance, and the vendor's own historical trajectory. State whether this is a beat, miss, or in-line, and by how much.

P2 — STORAGE-SPECIFIC DEEP DIVE: Focus on: Storage/data services revenue and growth rate, product mix shifts (all-flash vs. hybrid, subscription vs. perpetual, cloud vs. on-prem), demand signals mentioned on the earnings call, guidance for next quarter, any storage-specific restructuring or investments.

P3 — COMPETITIVE FINANCIAL BENCHMARKING: Compare side-by-side: Revenue growth rates of direct competitors in this segment, margin trends, subscription/ARR metrics and transition progress, R&D investment levels. Use specific numbers.

P4 — STRATEGIC READ-THROUGH: What do these numbers tell us about: Market demand trends (AI storage, cloud repatriation, ransomware recovery, data growth), this vendor's strategic execution, customer spending patterns, pricing pressure or premium pricing power.

P5 — BUYER IMPLICATIONS: Financial health as a vendor selection criterion (can you rely on this vendor for 5-10 years?). Are pricing changes likely based on financial pressure or strength? Is R&D investment increasing or decreasing in your product area?`,

        'Customer Success': `=== CUSTOMER WIN ANALYSIS ===

P1 — THE SIGNAL: What makes this customer win noteworthy? Is it the scale, the vertical, the displacement of a competitor, or the use case? If this is a routine win being dressed up as news, say so.

P2 — DEAL ANALYSIS: Assess what we can infer: What vendor/product was displaced (if known or inferable)? What was the decision criteria? What is the deployment scale? Is this a new workload or a migration? What's NOT mentioned?

P3 — PATTERN RECOGNITION: Is this vendor gaining traction in this vertical/segment? What comparable wins have competitors announced? Is there a trend?

P4 — COMPETITIVE IMPACT: Who is losing and why? Which specific competitor likely lost this deal? What does this say about shifting buyer preferences? Are there structural advantages driving these wins?

P5 — BUYER RELEVANCE: If you're in the same industry — what does this tell you about the vendor's capability in your workload? If you're evaluating this vendor — is this reference relevant to your scale and use case? What reference questions should you ask?`,

        'Leadership Changes': `=== LEADERSHIP CHANGE ANALYSIS ===

P1 — THE SIGNAL: Who is arriving or departing, and why does it matter? Lead with the strategic implication, not the biography. If the departure is unexplained or sudden, note that directly.

P2 — LEADER ASSESSMENT: For appointments: Track record at previous companies — what did they build, ship, or transform? What does their background signal about strategic direction? For departures: What was the leader's legacy and strategic direction? What initiatives may stall or pivot? Is this part of a pattern of executive turnover?

P3 — COMPETITIVE LEADERSHIP LANDSCAPE: What leadership changes have competitors made recently? How does this vendor's executive stability compare? Who are the equivalent leaders at competing vendors and what are they executing?

P4 — STRATEGIC IMPLICATIONS: What is likely to change in product roadmap, go-to-market, or culture? What is the typical timeline for a new leader to make an impact? What should customers watch for in the next 6-12 months?

P5 — BUYER GUIDANCE: If you're a current customer — what to watch for in terms of product direction, support quality, or sales team changes. If you're mid-evaluation — whether to pause pending strategic clarity. Red flags: rapid succession of leadership changes, departure of technical founders, loss of key engineering leaders.`,

        'General': `=== GENERAL ANALYSIS (keep shorter) ===

P1 — WHAT IT IS: Briefly state what the announcement is and whether it has any substantive value for enterprise storage decision-makers. Be direct — if this is an event sponsorship, an award, or a thought leadership piece with no news, say so.

P2 — CONTEXT IF RELEVANT: If there's any useful signal buried in the announcement (e.g., a conference keynote that previews product direction, an analyst report that confirms market share data), extract and present it.

P3 — BUYER RELEVANCE: State whether enterprise storage professionals need to pay attention to this. If not, say "This is a routine announcement with no immediate implications for enterprise storage procurement decisions."`
    };
    return prompts[category] || prompts['General'];
}

function getKeyTakeawayGuidance(category) {
    const verbs = {
        'Product Announcement': '"Evaluate" | "Shortlist" | "Test" | "Wait for GA" | "Skip"',
        'Partnership': '"Assess integration" | "Verify depth" | "Monitor"',
        'M&A': '"Review roadmap" | "Prepare contingency" | "Watch integration"',
        'Financial Results': '"Note momentum" | "Flag risk" | "Compare margins"',
        'Customer Success': '"Request reference" | "Validate fit" | "Track pattern"',
        'Leadership Changes': '"Monitor direction" | "Pause evaluation" | "No action needed"',
        'General': '"Low priority" | "File for reference" | "No action needed"',
    };
    return verbs[category] || verbs['General'];
}

async function analyzeNewsItem(newsItem, contextNews = []) {
    if (DEMO_MODE) {
        return generateDemoAnalysis(newsItem);
    }

    const client = getOpenAI();

    console.log(`[Analyzer] Fetching full article content: ${newsItem.url}`);
    const articleContent = await fetchArticleContent(newsItem.url);
    const contentAvailable = articleContent && articleContent.length > 100;
    console.log(`[Analyzer] Article content: ${contentAvailable ? `${articleContent.length} chars` : 'not available, using title/summary only'}`);

    const contextStr = contextNews.length > 0
        ? `\n\nRECENT NEWS FROM THIS AND COMPETING VENDORS (for cross-vendor context):\n${contextNews.map(n => `- [${n.impact_score || '?'}] ${n.vendor_name}: ${n.title}${n.opinion_en ? ' — ' + n.opinion_en.substring(0, 200) : ''}`).join('\n')}`
        : '';

    const articleSection = contentAvailable
        ? `\nFULL ARTICLE TEXT:\n${articleContent}`
        : `\nSUMMARY: ${newsItem.summary || 'No detailed content available — analyze based on the title and your industry knowledge.'}`;

    const allCategoryStructures = Object.keys({ 'Product Announcement': 1, 'Partnership': 1, 'M&A': 1, 'Financial Results': 1, 'Customer Success': 1, 'Leadership Changes': 1, 'General': 1 })
        .map(cat => getCategoryPrompt(cat)).join('\n\n');

    const prompt = `ROLE & EDITORIAL STANCE:

You are an independent enterprise storage and data infrastructure analyst writing for StorageNews.ai. Your readers are storage architects, infrastructure VPs, IT directors, and CTOs making real procurement, partnership, and strategy decisions.

YOUR EDITORIAL PRINCIPLES:
1. SKEPTICAL BY DEFAULT — Press releases are marketing. Earnings calls are investor relations. Your job is to extract what actually matters and flag what doesn't hold up.
2. VENDOR-NEUTRAL — You have no affiliations. Praise what deserves it. Criticize what warrants it. Never soften criticism to seem balanced, and never amplify praise to seem enthusiastic.
3. SPECIFIC OVER VAGUE — Name vendors, products, features, numbers, and timelines. Never write "competitors in this space" when you can write "NetApp ONTAP and Dell PowerStore."
4. PRACTICAL — Every paragraph should help a reader make a decision or take an action. If it doesn't, cut it.
5. HONEST ABOUT UNCERTAINTY — If you don't know something or can't verify a claim, say so explicitly. "We could not independently verify..." is always acceptable.

NEVER USE THESE PHRASES (replace with specific, falsifiable statements):
"remains to be seen", "could potentially disrupt", "in today's rapidly evolving landscape", "positions [vendor] well for the future", "a step in the right direction", "only time will tell", "sends a strong signal to the market", "underscores the importance of", "game-changer", "raises the bar", "doubles down on", "makes waves", "shakes up the industry"

---

ARTICLE TO ANALYZE:
Title: ${newsItem.title}
Vendor: ${newsItem.vendor_name}
URL: ${newsItem.url}
Date Published: ${newsItem.published_date || 'Unknown'}
${articleSection}
${contextStr}

---

STEP 1 — CLASSIFY THE ARTICLE:

| Category               | Criteria                                                    |
|------------------------|-------------------------------------------------------------|
| Product Announcement   | New product line, platform, service tier, features,         |
|                        | version upgrades, performance improvements                  |
| M&A                    | Acquisitions, mergers, divestitures, acqui-hires,           |
|                        | majority stake purchases                                    |
| Financial Results      | Quarterly/annual earnings, revenue, funding rounds, IPO     |
| Partnership            | Technology alliances, channel partnerships, OEM deals,      |
|                        | certification programs, integration announcements           |
| Customer Success       | Named customer deployments, case studies, migration         |
|                        | stories, large contract wins                                |
| Leadership Changes     | C-suite appointments, board changes, VP+ departures,        |
|                        | reorgs affecting product/strategy direction                 |
| General                | Events, awards, analyst mentions, routine updates,          |
|                        | thought leadership                                          |

IMPACT SCORING:
- HIGH: Changes the competitive calculus for buyers evaluating this segment. Examples: new product category entry, major acquisition, significant pricing model change, loss/win of a top-10 customer, CEO departure, earning/revenue announcement.
- MEDIUM: Noteworthy for people tracking this vendor or segment but doesn't force re-evaluation. Examples: meaningful feature addition, Fortune 500 customer win, VP+ hire, technology partnership with integration depth.
- LOW: Incremental or routine. Examples: minor version updates, event sponsorships, awards, routine partnerships without technical depth, results in line with expectations.

---

STEP 2 — WRITE CATEGORY-SPECIFIC ANALYSIS:

Based on the category you assigned, follow the matching analysis structure below:

${allCategoryStructures}

---

VENDOR CONTEXT — APPLIES TO ALL CATEGORIES (2-4 paragraphs):

PARAGRAPH 1 — DIRECT COMPETITIVE RESPONSE: Name every vendor directly affected by this announcement. For each, state their current competitive position, their most recent relevant move, and how this announcement changes (or doesn't change) the dynamic. Use specific product names, not just vendor names.

PARAGRAPH 2 — MARKET SEGMENT DYNAMICS: Where does this fit in the broader market evolution? What trends are driving all vendors in this segment (AI-driven storage demand, cloud repatriation, ransomware resilience, NVMe-oF adoption, etc.)? Is the announcing vendor leading, following, or diverging from the market consensus?

PARAGRAPH 3 — HISTORICAL CONTEXT: How have similar announcements played out in the past? What comparable moves did competitors make and what were the outcomes?

PARAGRAPH 4 (if warranted) — WHAT TO WATCH NEXT: What competitive responses are likely? What would change this assessment?

---

KEY TAKEAWAY — One sentence, max 30 words. Must follow this pattern:
[Action Verb] — [Specific insight with at least one named entity]

GOOD examples:
  "Evaluate — Vast Data's NFS-over-RDMA support closes the performance gap with Pure FlashBlade for AI training workloads."
  "Watch integration — Cisco's acquisition of {target} mirrors HPE-Zerto; expect 12-18 months before unified product."
  "Flag risk — Dell ISG revenue declined 8% while Pure grew 18%; widening gap suggests share shift in all-flash."

BAD examples (NEVER write these):
  "This announcement has significant implications for the storage market."
  "Organizations should keep an eye on this developing situation."

---

CHINESE CONTENT GUIDELINES:
- opinion_cn: Translate the English analysis to Simplified Chinese. Use standard Chinese IT terminology (存储架构师, 全闪存阵列, 混合云, 数据保护). Keep all vendor names, product names, and technical terms in English. Maintain the same paragraph structure, analytical depth, and skepticism as the English version.
- vendor_context_cn: Direct translation of the English vendor_context to Chinese. Keep all vendor names and product names in English.
- key_takeaway_cn: Direct translation of the English key_takeaway to Chinese, same action-oriented format.
- title_cn: Translate the article headline to Chinese. Keep vendor names, product names, and technical terms in English.

---

Respond with valid JSON only:
{
  "impact_score": "HIGH" or "MEDIUM" or "LOW",
  "category": "Product Announcement" | "M&A" | "Financial Results" | "Partnership" | "Customer Success" | "Leadership Changes" | "General",
  "opinion_en": "Full category-specific analysis as described above",
  "opinion_cn": "Chinese translation of opinion_en",
  "vendor_context": "2-4 paragraph competitive analysis as described above",
  "vendor_context_cn": "Chinese translation of vendor_context",
  "key_takeaway": "Action Verb — specific insight with named entities, max 30 words",
  "key_takeaway_cn": "Chinese translation of key_takeaway",
  "title_cn": "Chinese translation of headline"
}`;

    try {
        const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            max_tokens: 8000,
            response_format: { type: 'json_object' },
        });

        const content = completion.choices[0].message.content.trim();
        let jsonStr = content.replace(/^```json?\s*\n?/i, '').replace(/\n?\s*```$/i, '');
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('[Analyzer] AI analysis failed:', error.message);
        return generateDemoAnalysis(newsItem);
    }
}

function generateDemoAnalysis(newsItem) {
    const title = newsItem.title.toLowerCase();

    let impact_score = 'MEDIUM';
    if (title.match(/acqui|merger|security|vulnerab|breach|launch|major|billion|critical/)) {
        impact_score = 'HIGH';
    } else if (title.match(/update|minor|blog|event|webinar|certif/)) {
        impact_score = 'LOW';
    }

    const vendorName = newsItem.vendor_name;

    let category = 'General';
    if (title.match(/acqui|merger|buyout|divest/)) category = 'M&A';
    else if (title.match(/revenue|earning|quarter|financial|fiscal|profit/)) category = 'Financial Results';
    else if (title.match(/partner|alliance|collaborat|integrat|joint/)) category = 'Partnership';
    else if (title.match(/customer|deploy|case study|success|implementa/)) category = 'Customer Success';
    else if (title.match(/launch|announce|releas|new product|unveil|introduc|platform|update/)) category = 'Product Announcement';
    else if (title.match(/appoint|ceo|cto|cio|board|executive|leader|hire|depart|resign/)) category = 'Leadership Changes';

    return {
        impact_score,
        category,
        opinion_en: `**Analysis of ${vendorName}'s Latest Move**\n\nThis announcement from ${vendorName} regarding "${newsItem.title}" represents a ${impact_score.toLowerCase()}-impact development in the enterprise storage landscape. ${impact_score === 'HIGH' ? 'This could significantly reshape competitive dynamics in the enterprise storage market, potentially affecting procurement decisions across the industry.' : impact_score === 'MEDIUM' ? 'While not a game-changer, this development signals continued investment and strategic positioning in key market segments.' : 'This is a routine development that maintains the vendor\'s market presence without significantly altering the competitive landscape.'}\n\nEnterprise IT decision-makers should ${impact_score === 'HIGH' ? 'closely evaluate how this impacts their existing storage strategy and vendor relationships.' : 'take note of this development as part of their ongoing vendor monitoring.'}`,
        opinion_cn: `**${vendorName}最新动态分析**\n\n${vendorName}关于"${newsItem.title}"的公告代表了企业存储领域的一个${impact_score === 'HIGH' ? '高' : impact_score === 'MEDIUM' ? '中等' : '低'}影响力发展。${impact_score === 'HIGH' ? '这可能会显著重塑企业存储市场的竞争格局，可能影响整个行业的采购决策。' : impact_score === 'MEDIUM' ? '虽然不是颠覆性的变化，但这一发展标志着在关键市场领域的持续投资和战略定位。' : '这是一个常规发展，维持了供应商的市场存在，但不会显著改变竞争格局。'}\n\n企业IT决策者应${impact_score === 'HIGH' ? '密切评估这如何影响他们现有的存储策略和供应商关系。' : '将此发展作为持续供应商监控的一部分加以关注。'}`,
        vendor_context: `In the broader enterprise storage market, ${vendorName}'s move comes amid increased competition from major players. This development should be evaluated alongside recent announcements from competing vendors to understand the evolving market landscape.`,
        vendor_context_cn: `在更广泛的企业存储市场中，${vendorName}的举措正值主要厂商竞争加剧之际。这一发展应与竞争供应商的最新公告一起评估，以了解不断变化的市场格局。`,
        key_takeaway: `${vendorName} ${impact_score === 'HIGH' ? 'makes a significant strategic move' : impact_score === 'MEDIUM' ? 'continues steady market progression' : 'maintains routine operations'} with implications for enterprise storage buyers.`,
        key_takeaway_cn: `${vendorName}${impact_score === 'HIGH' ? '做出重大战略举措' : impact_score === 'MEDIUM' ? '持续稳步推进市场布局' : '保持常规运营'}，对企业存储采购者具有参考意义。`,
        title_cn: '',
    };
}

export async function analyzeAllPending() {
    const pending = getUnanalyzedNews(20);
    const results = [];

    for (const newsItem of pending) {
        console.log(`[Analyzer] Analyzing: ${newsItem.title}`);

        const contextNews = getRecentNewsByVendor(newsItem.vendor_id, newsItem.id, 5);

        const analysis = await analyzeNewsItem(newsItem, contextNews);

        insertAnalysis({
            news_item_id: newsItem.id,
            impact_score: analysis.impact_score,
            category: analysis.category || 'General',
            opinion_en: analysis.opinion_en,
            opinion_cn: analysis.opinion_cn,
            vendor_context: analysis.vendor_context || '',
            key_takeaway: analysis.key_takeaway || '',
            vendor_context_cn: analysis.vendor_context_cn || '',
            key_takeaway_cn: analysis.key_takeaway_cn || '',
            title_cn: analysis.title_cn || '',
        });

        results.push({
            id: newsItem.id,
            title: newsItem.title,
            vendor: newsItem.vendor_name,
            impact: analysis.impact_score,
            category: analysis.category || 'General',
        });
    }

    return { analyzed: results.length, results, demoMode: DEMO_MODE };
}

export async function analyzeSingleItem(newsItemId) {
    const { getNewsItemById } = await import('./db.js');
    const newsItem = getNewsItemById(newsItemId);
    if (!newsItem) throw new Error(`News item ${newsItemId} not found`);

    const contextNews = getRecentNewsByVendor(newsItem.vendor_id, newsItem.id, 5);
    const analysis = await analyzeNewsItem(
        { ...newsItem, vendor_name: newsItem.vendor_name },
        contextNews
    );

    insertAnalysis({
        news_item_id: newsItemId,
        impact_score: analysis.impact_score,
        category: analysis.category || 'General',
        opinion_en: analysis.opinion_en,
        opinion_cn: analysis.opinion_cn,
        vendor_context: analysis.vendor_context || '',
        key_takeaway: analysis.key_takeaway || '',
        vendor_context_cn: analysis.vendor_context_cn || '',
        key_takeaway_cn: analysis.key_takeaway_cn || '',
        title_cn: analysis.title_cn || '',
    });

    return analysis;
}

export async function batchRetranslate(batchSize = 10) {
    const { getDb } = await import('./db.js');
    const db = getDb();

    const items = db.prepare(`
        SELECT n.id, n.title, n.summary, n.url, n.vendor_id, v.name as vendor_name,
               a.impact_score, a.category, a.opinion_en, a.vendor_context, a.key_takeaway
        FROM news_items n
        JOIN vendors v ON n.vendor_id = v.id
        JOIN analyses a ON n.id = a.news_item_id
        WHERE (a.title_cn IS NULL OR a.title_cn = '' OR a.vendor_context_cn IS NULL OR a.vendor_context_cn = '')
        ORDER BY n.scraped_at DESC
        LIMIT ?
    `).all(batchSize);

    if (items.length === 0) {
        return { translated: 0, message: 'All articles already have Chinese translations' };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { translated: 0, message: 'No OpenAI API key available' };
    }

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });
    const results = [];

    for (const item of items) {
        try {
            console.log(`[Retranslate] Translating: ${item.title}`);
            const prompt = `Translate the following enterprise storage news fields to Chinese. Keep all vendor names, product names, and technical terms in English. Return valid JSON only.

TITLE: ${item.title}
VENDOR CONTEXT: ${item.vendor_context || 'N/A'}
KEY TAKEAWAY: ${item.key_takeaway || 'N/A'}

{
  "title_cn": "Chinese translation of the title",
  "vendor_context_cn": "Chinese translation of vendor context",
  "key_takeaway_cn": "Chinese translation of key takeaway"
}`;

            const completion = await client.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 1000,
            });

            const content = completion.choices[0].message.content.trim();
            const jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
            const translated = JSON.parse(jsonStr);

            db.prepare(`
                UPDATE analyses SET title_cn = ?, vendor_context_cn = ?, key_takeaway_cn = ?
                WHERE news_item_id = ?
            `).run(
                translated.title_cn || '',
                translated.vendor_context_cn || '',
                translated.key_takeaway_cn || '',
                item.id
            );

            results.push({ id: item.id, title: item.title, status: 'ok' });
        } catch (err) {
            console.error(`[Retranslate] Failed for ${item.id}:`, err.message);
            results.push({ id: item.id, title: item.title, status: 'error', error: err.message });
        }
    }

    return { translated: results.filter(r => r.status === 'ok').length, total: items.length, results };
}
