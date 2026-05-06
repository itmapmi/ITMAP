import type { Express } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../auth";
import crypto from "crypto";
import { insertPromptRepositorySchema } from "@shared/schema";

export function registerAdminRoutes(app: Express): void {

  // ── Prompt Repository ────────────────────────────────────────────────────

  app.get("/api/admin/prompts", requireAdmin, async (req, res) => {
    try {
      const stage = req.query.stage as any;
      const promptType = req.query.promptType as any;
      const prompts = await storage.listPrompts({ stage, promptType });
      res.json(prompts);
    } catch (err: any) {
      console.error("Error listing prompts:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/prompts/:id", requireAdmin, async (req, res) => {
    try {
      const p = await storage.getPrompt(req.params.id);
      if (!p) return res.status(404).json({ error: "Prompt not found" });
      res.json(p);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/prompts", requireAdmin, async (req, res) => {
    try {
      const data = insertPromptRepositorySchema.parse({ ...req.body, isSystem: false });
      const created = await storage.createPrompt(data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/admin/prompts/:id", requireAdmin, async (req, res) => {
    try {
      const { name, description, content } = req.body ?? {};
      const updated = await storage.updatePrompt(req.params.id, { name, description, content });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/admin/prompts/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deletePrompt(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Cron Job Management ───────────────────────────────────────────────────

  app.get("/api/admin/cron-jobs/status", async (_req, res) => {
    try {
      const { cronJobManager } = await import("../cronJobs");
      res.json(cronJobManager.getJobStatus());
    } catch (error) {
      console.error("Error getting cron job status:", error);
      res.status(500).json({ error: "Failed to get cron job status" });
    }
  });

  app.post("/api/admin/cron-jobs/:jobName/start", async (req, res) => {
    try {
      const { cronJobManager } = await import("../cronJobs");
      const success = cronJobManager.startJob(req.params.jobName);
      if (success) res.json({ message: `Job ${req.params.jobName} started successfully` });
      else res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error starting cron job:", error);
      res.status(500).json({ error: "Failed to start cron job" });
    }
  });

  app.post("/api/admin/cron-jobs/:jobName/stop", async (req, res) => {
    try {
      const { cronJobManager } = await import("../cronJobs");
      const success = cronJobManager.stopJob(req.params.jobName);
      if (success) res.json({ message: `Job ${req.params.jobName} stopped successfully` });
      else res.status(404).json({ error: "Job not found" });
    } catch (error) {
      console.error("Error stopping cron job:", error);
      res.status(500).json({ error: "Failed to stop cron job" });
    }
  });

  // ── Newsroom URL Health Check ─────────────────────────────────────────────

  app.get("/api/admin/newsroom-url-health", requireAdmin, async (_req, res) => {
    try {
      const { getHealthCheckResults } = await import("../news/ingestion/urlHealthCheck");
      res.json(getHealthCheckResults());
    } catch (error) {
      console.error("Error getting newsroom URL health results:", error);
      res.status(500).json({ error: "Failed to get health check results" });
    }
  });

  app.post("/api/admin/newsroom-url-health/run", requireAdmin, async (_req, res) => {
    try {
      const { checkAllNewsroomUrls } = await import("../news/ingestion/urlHealthCheck");
      const { dispatchHealthAlertEmails } = await import("../cronJobs");
      const results = await checkAllNewsroomUrls();
      dispatchHealthAlertEmails(results).catch(err => console.error("[Route] Error dispatching health alert emails:", err));
      res.json({ results, lastCheckedAt: new Date() });
    } catch (error) {
      console.error("Error running newsroom URL health check:", error);
      res.status(500).json({ error: "Failed to run health check" });
    }
  });

  // ── Alert Settings ────────────────────────────────────────────────────────

  app.get("/api/admin/alert-settings", requireAdmin, async (_req, res) => {
    try {
      const settings = await storage.getAlertSettings();
      res.json(settings ?? { emailAlertsEnabled: true, recipientEmails: null });
    } catch (error) {
      console.error("Error getting alert settings:", error);
      res.status(500).json({ error: "Failed to get alert settings" });
    }
  });

  app.put("/api/admin/alert-settings", requireAdmin, async (req, res) => {
    try {
      const { emailAlertsEnabled, recipientEmails } = req.body as { emailAlertsEnabled?: boolean; recipientEmails?: string | null };
      const updated = await storage.upsertAlertSettings({
        ...(emailAlertsEnabled !== undefined ? { emailAlertsEnabled } : {}),
        ...(recipientEmails !== undefined ? { recipientEmails: recipientEmails || null } : {}),
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating alert settings:", error);
      res.status(500).json({ error: "Failed to update alert settings" });
    }
  });

  app.post("/api/admin/alert-settings/test", requireAdmin, async (_req, res) => {
    try {
      const { sendNewsroomAlertEmail } = await import("../emailService");
      const alertSettings = await storage.getAlertSettings();
      let recipients: string[] = [];
      if (alertSettings?.recipientEmails) {
        recipients = alertSettings.recipientEmails.split(',').map(e => e.trim()).filter(Boolean);
      }
      if (recipients.length === 0) {
        const adminUsers = await storage.getAdminUsers();
        recipients = adminUsers.map(u => u.email).filter((e): e is string => !!e);
      }
      const fakeResult = [{
        vendorId: 'test-vendor', vendorName: 'Test Vendor (Example)',
        url: 'https://example.com/newsroom', status: 'broken' as const,
        statusCode: 503, error: 'Test alert — this vendor is not actually down', lastChecked: new Date(),
      }];
      const result = await sendNewsroomAlertEmail(fakeResult, recipients);
      res.json(result);
    } catch (error) {
      console.error("Error sending test alert email:", error);
      res.status(500).json({ error: "Failed to send test email" });
    }
  });

  // ── Bulk Upload Support Matrix ────────────────────────────────────────────

  app.post("/api/admin/bulk-upload-support-matrix", requireAdmin, async (req, res) => {
    try {
      const { categories, features, supportData } = req.body;
      console.log(`Received bulk upload: ${categories?.length} categories, ${features?.length} features, ${supportData?.length} support records`);
      const marketResult = await storage.getAllMarkets();
      const market = marketResult.find(m => m.name === 'Enterprise Storage');
      if (!market) return res.status(404).json({ error: 'Enterprise Storage market not found' });
      let createdCategories = 0, createdFeatures = 0, updatedSupport = 0;
      for (const category of categories) {
        const existing = await storage.getMarketFeatureCategories(market.id);
        if (!existing.find((c: any) => c.name === category.name)) {
          await storage.createFeatureCategory({ name: category.name, marketId: market.id, displayOrder: category.displayOrder });
          createdCategories++;
        }
      }
      const allCategories = await storage.getMarketFeatureCategories(market.id);
      const categoryMap: { [key: string]: string } = {};
      allCategories.forEach((c: any) => categoryMap[c.name] = c.id);
      for (const feature of features) {
        const existing = await storage.getMarketFeatures(market.id);
        if (!existing.find((f: any) => f.name === feature.name)) {
          await storage.createFeature({ name: feature.name, description: feature.description, categoryId: categoryMap[feature.category], displayOrder: feature.displayOrder });
          createdFeatures++;
        }
      }
      const vendors = await storage.getVendorsByMarket(market.id);
      const vendorMap: { [key: string]: string } = {};
      vendors.forEach((v: any) => { vendorMap[v.product || v.name] = v.id; });
      const allFeatures = await storage.getMarketFeatures(market.id);
      const featureMap: { [key: string]: string } = {};
      allFeatures.forEach((f: any) => featureMap[f.name] = f.id);
      for (const support of supportData) {
        const vendorId = vendorMap[support.vendorProduct];
        const featureId = featureMap[support.featureName];
        if (vendorId && featureId) {
          await storage.createOrUpdateFeatureSupport({ vendorId, featureId, supportLevel: support.supportLevel, notes: support.notes });
          updatedSupport++;
        } else {
          console.log(`Skipping support record - vendor: ${support.vendorProduct}, feature: ${support.featureName}`);
        }
      }
      res.json({ success: true, created: { categories: createdCategories, features: createdFeatures, supportRecords: updatedSupport } });
    } catch (error) {
      console.error("Error bulk uploading support matrix:", error);
      res.status(500).json({ error: "Failed to bulk upload support matrix" });
    }
  });

  // ── Score Recalculation ───────────────────────────────────────────────────

  app.post("/api/admin/update-product-capabilities-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ error: "Market ID is required" });
      const vendors = await storage.getVendorsByMarket(marketId);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const features = allFeatures.filter(feature => {
        const categoryName = feature.category?.name?.toLowerCase() || '';
        return !categoryName.includes('ecosystem') && !categoryName.includes('integration') && !categoryName.includes('partnership') && !categoryName.includes('third-party');
      });
      const supportData = await storage.getVendorFeatureSupport(marketId);
      const allCriteria = await storage.getAllCriteria();
      const productCapabilitiesCriteria = allCriteria.find(c => c.name === 'Product Capabilities');
      if (!productCapabilitiesCriteria) return res.status(404).json({ error: "Product Capabilities criteria not found" });
      const supportLookup = new Map<string, number>();
      supportData.forEach(support => supportLookup.set(`${support.vendorId}-${support.featureId}`, support.supportLevel));
      let updatedScores = 0;
      for (const vendor of vendors) {
        const totalScore = features.reduce((sum, feature) => {
          const supportLevel = supportLookup.get(`${vendor.id}-${feature.id}`) || 0;
          let score = 0;
          switch (supportLevel) { case 4: score = 1.0; break; case 3: score = 0.75; break; case 2: score = 0.5; break; }
          return sum + score;
        }, 0);
        const maxScore = features.length * 1.0;
        const normalizedScore = maxScore > 0 ? Number(((Number(totalScore.toFixed(2)) / maxScore) * 10).toFixed(1)) : 0;
        await storage.createOrUpdateVendorScore({ vendorId: vendor.id, criteriaId: productCapabilitiesCriteria.id, score: normalizedScore });
        updatedScores++;
        console.log(`Updated Product Capabilities score for ${vendor.name}: ${normalizedScore}/10`);
      }
      res.json({ success: true, message: `Updated Product Capabilities scores for ${updatedScores} vendors`, updatedScores, marketId });
    } catch (error) {
      console.error("Error updating product capabilities scores:", error);
      res.status(500).json({ error: "Failed to update product capabilities scores" });
    }
  });

  app.post("/api/admin/update-isv-ecosystem-scores", requireAdmin, async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ error: "Market ID is required" });
      const vendors = await storage.getVendorsByMarket(marketId);
      const allFeatures = await storage.getMarketFeatures(marketId);
      const ecosystemFeatures = allFeatures.filter(feature => {
        const categoryName = feature.category?.name?.toLowerCase() || '';
        return categoryName.includes('ecosystem') || categoryName.includes('integration') || categoryName.includes('partnership') || categoryName.includes('third-party');
      });
      const supportData = await storage.getVendorFeatureSupport(marketId);
      const allCriteria = await storage.getAllCriteria();
      const isvEcosystemCriteria = allCriteria.find(c => c.name.toLowerCase().includes('isv') && c.name.toLowerCase().includes('ecosystem'));
      if (!isvEcosystemCriteria) return res.status(404).json({ error: "ISV Ecosystem criteria not found" });
      if (ecosystemFeatures.length === 0) return res.status(400).json({ error: "No ecosystem features found in this market" });
      const supportLookup = new Map<string, number>();
      supportData.forEach(support => supportLookup.set(`${support.vendorId}-${support.featureId}`, support.supportLevel));
      let updatedScores = 0;
      for (const vendor of vendors) {
        const totalScore = ecosystemFeatures.reduce((sum, feature) => {
          const supportLevel = supportLookup.get(`${vendor.id}-${feature.id}`) || 0;
          let score = 0;
          switch (supportLevel) { case 4: score = 1.0; break; case 3: score = 0.75; break; case 2: score = 0.5; break; }
          return sum + score;
        }, 0);
        const maxScore = ecosystemFeatures.length * 1.0;
        const normalizedScore = maxScore > 0 ? Number(((Number(totalScore.toFixed(2)) / maxScore) * 10).toFixed(2)) : 0;
        await storage.createOrUpdateVendorScore({ vendorId: vendor.id, criteriaId: isvEcosystemCriteria.id, score: normalizedScore });
        updatedScores++;
        console.log(`Updated ISV Ecosystem score for ${vendor.name}: ${normalizedScore}/10`);
      }
      res.json({ success: true, message: `Updated ISV Ecosystem scores for ${updatedScores} vendors`, updatedScores, marketId, ecosystemFeatures: ecosystemFeatures.length });
    } catch (error) {
      console.error("Error updating ISV ecosystem scores:", error);
      res.status(500).json({ error: "Failed to update ISV ecosystem scores" });
    }
  });

  // ── Operations Management ─────────────────────────────────────────────────

  app.get("/api/admin/operations/user-logs", requireAdmin, async (req, res) => {
    try {
      const { page, limit, startDate, endDate } = req.query;
      const pageNum = page ? parseInt(page as string) : 1;
      const limitNum = limit ? parseInt(limit as string) : 50;
      const offset = (pageNum - 1) * limitNum;
      const options: any = { limit: limitNum, offset };
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      const logs = await storage.getUserActivityLogs(options);
      res.json({ logs, total: logs.length, page: pageNum, limit: limitNum });
    } catch (error) {
      console.error("Error fetching user activity logs:", error);
      res.status(500).json({ error: "Failed to fetch user activity logs" });
    }
  });

  app.delete("/api/admin/operations/user-logs/prune", requireAdmin, async (_req, res) => {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const deletedCount = await storage.pruneUserLogsBefore(sixMonthsAgo);
      res.json({ success: true, deletedCount, message: `Deleted ${deletedCount} logs older than 6 months` });
    } catch (error) {
      console.error("Error pruning user activity logs:", error);
      res.status(500).json({ error: "Failed to prune user activity logs" });
    }
  });

  // ── Functional Spec Download ──────────────────────────────────────────────

  app.get("/api/download/functional-spec", requireAdmin, async (_req, res) => {
    try {
      const {
        Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
        TableCell, WidthType, AlignmentType, ShadingType,
        PageBreak, convertInchesToTwip,
      } = await import("docx");

      const heading1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } });
      const heading2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 80 } });
      const body = (text: string) => new Paragraph({ children: [new TextRun({ text, size: 22 })], spacing: { after: 120 } });
      const bullet = (text: string, level = 0) => new Paragraph({ children: [new TextRun({ text, size: 22 })], bullet: { level }, spacing: { after: 80 } });
      const tableHeaderCell = (text: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })], shading: { fill: "1E3A5F", type: ShadingType.CLEAR, color: "FFFFFF" } });
      const tableCell = (text: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })] });
      const makeTable = (headers: string[], rows: string[][]) => new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: headers.map(tableHeaderCell), tableHeader: true }), ...rows.map(row => new TableRow({ children: row.map(tableCell) }))],
      });
      const spacer = () => new Paragraph({ text: "", spacing: { after: 120 } });

      const doc = new Document({
        styles: {
          default: {
            heading1: { run: { bold: true, size: 32, color: "1E3A5F" }, paragraph: { spacing: { before: 400, after: 120 } } },
            heading2: { run: { bold: true, size: 26, color: "1E3A5F" }, paragraph: { spacing: { before: 300, after: 80 } } },
            heading3: { run: { bold: true, size: 23, color: "2D6A9F" }, paragraph: { spacing: { before: 200, after: 60 } } },
          },
        },
        sections: [{
          properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) } } },
          children: [
            new Paragraph({ children: [new TextRun({ text: "Spectio", bold: true, size: 72, color: "1E3A5F" })], alignment: AlignmentType.CENTER, spacing: { before: 800, after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: "Functional Specification Document", size: 36, color: "2D6A9F" })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: "Enterprise Market Research Platform", size: 26, color: "555555" })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: "Version 1.0  |  March 2026", size: 22, color: "888888" })], alignment: AlignmentType.CENTER, spacing: { after: 800 } }),
            new Paragraph({ children: [new PageBreak()] }),
            heading1("1. Overview"),
            body("Spectio is a private, enterprise-grade market research platform designed for technology vendor analysis. It provides structured methodologies for evaluating vendors across complex technology markets, combining interactive visualizations, AI-assisted intelligence, and professional-grade PDF reporting. The platform is positioned as an independent and unbiased source of market intelligence for enterprise buyers."),
            body("The platform is accessible at spectio.ai and is currently live for one market: Public Cloud Object Storage Providers, covering 12 vendors across 98 features and 8 evaluation criteria."),
            spacer(),
            heading1("2. User Roles"),
            makeTable(["Role", "Description"], [
              ["Guest (unauthenticated)", "Cannot access platform content. Sees login/register pages only."],
              ["User (authenticated)", "Can browse all market data, read all reports, interact with AI Chat, and view all tabs. Read-only."],
              ["Admin", "Full access including creating/editing markets, vendors, criteria, scores, features, news sources, reports, and running bulk operations. Admin-only routes are protected server-side."],
            ]),
            spacer(),
            heading1("3. Authentication"),
            heading2("3.1 Supported Methods"),
            bullet("Email/Password — Standard registration and login with bcrypt-hashed passwords."),
            bullet("Google OAuth — Login via Google account (OAuth 2.0)."),
            bullet("LinkedIn OAuth — Login via LinkedIn account (OAuth 2.0)."),
            spacer(),
            heading2("3.2 Session Behavior"),
            bullet("Sessions are persisted in the database (PostgreSQL via express-session)."),
            bullet("On login, the system records: user ID, session ID, IP address, user agent, and login timestamp."),
            bullet("On logout, the session's logout time is recorded."),
            bullet("Admin users are redirected to /admin on login; regular users are redirected to /."),
            spacer(),
            heading1("4. Navigation & Pages"),
            heading2("4.1 Public Pages"),
            makeTable(["Page", "Route", "Description"], [
              ["Home", "/", "Hero section, platform overview, feature highlights, market preview."],
              ["Markets", "/markets", "Grid of all available (visible) markets."],
              ["Login", "/login", "Email/password and OAuth login form."],
              ["Register", "/register", "New user registration."],
            ]),
            spacer(),
            heading2("4.2 Authenticated Pages"),
            makeTable(["Page", "Route", "Description"], [
              ["Market Details", "/markets/:marketId", "Full market analysis with 7 tabs."],
              ["Report Viewer", "/reports/:reportId", "View a published research report in the browser."],
              ["Admin Portal", "/admin", "Admin-only management portal."],
            ]),
            spacer(),
            heading1("5. Market Details Page"),
            body("The central analytical view of the platform. Accessible at /markets/:marketId. Contains 7 tabs:"),
            makeTable(["Tab", "Description"], [
              ["Vendor Evaluation", "Interactive quadrant chart (D3.js) with timeline scrubber."],
              ["Product Evaluation", "Harvey Ball feature support matrix across all product feature categories."],
              ["Ecosystem Support", "Harvey Ball matrix showing third-party ecosystem integrations."],
              ["Methodology", "Rich-text page describing the research methodology for the market."],
              ["New Players", "Curated list of emerging vendors not yet included in the main evaluation."],
              ["News", "Live news feed of recent vendor announcements with AI impact scores."],
              ["AI Chat", "Conversational AI assistant with full database context for the market."],
            ]),
            spacer(),
            heading1("12. Vendor Evaluation Mathematical Model"),
            heading2("12.1 Criteria and Axes"),
            makeTable(["Axis", "Criteria"], [
              ["X (Execution)", "Product Capabilities, Customer Experience, Pricing Strategy, ISV Ecosystem"],
              ["Y (Viability)", "Innovation, Business Model, Partner Ecosystem, Revenue"],
            ]),
            spacer(),
            heading2("12.2 Auto-Calculated Score Formula"),
            body("For each feature: Harvey Ball 4 → 1.0 pts, 3 → 0.75 pts, 2 → 0.5 pts, 1 → 0 pts, 0 → 0 pts."),
            body("Normalized Score (0-10) = (Sum of feature points / Number of features) × 10"),
            spacer(),
            heading2("12.3 Weight-to-Multiplier Conversion"),
            makeTable(["Weight Range", "Multiplier"], [
              ["0 – 25%", "0.5×"], ["26 – 45%", "1.5×"], ["46 – 65%", "2.5×"], ["66 – 100%", "3.0×"],
            ]),
            spacer(),
            heading1("20. Technical Architecture"),
            makeTable(["Layer", "Technology"], [
              ["Frontend", "React 18, TypeScript, Vite, Tailwind CSS, Radix UI / shadcn"],
              ["Backend", "Node.js, Express.js, TypeScript"],
              ["ORM", "Drizzle ORM"],
              ["Database", "PostgreSQL (Neon serverless)"],
              ["AI", "OpenAI GPT-4.1 mini via Replit AI Integrations"],
              ["PDF Generation", "Puppeteer + system Chromium"],
              ["Deployment", "Replit, custom domain spectio.ai"],
            ]),
            spacer(),
          ],
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Disposition", 'attachment; filename="Spectio_Functional_Specification_v1.0.docx"');
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.send(buffer);
    } catch (error) {
      console.error("Error generating functional spec document:", error);
      res.status(500).json({ error: "Failed to generate document" });
    }
  });

  // ── External API Key Management ───────────────────────────────────────────

  app.get('/api/admin/api-keys', requireAdmin, async (_req, res) => {
    try {
      res.json(await storage.listExternalApiKeys());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/api-keys', requireAdmin, async (req, res) => {
    try {
      const { name, allowedMarketIds } = req.body as { name?: string; allowedMarketIds?: string[] | null };
      if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
      const rawKey = `spectio_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.substring(0, 14);
      const created = await storage.createExternalApiKey({
        name: name.trim(), keyHash, keyPrefix,
        allowedMarketIds: Array.isArray(allowedMarketIds) && allowedMarketIds.length > 0 ? allowedMarketIds : null,
      });
      res.status(201).json({ ...created, rawKey });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/api-keys/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive, allowedMarketIds } = req.body as { name?: string; isActive?: boolean; allowedMarketIds?: string[] | null };
      const updates: Record<string, any> = {};
      if (typeof name === 'string' && name.trim()) updates.name = name.trim();
      if (typeof isActive === 'boolean') updates.isActive = isActive;
      if (Object.prototype.hasOwnProperty.call(req.body, 'allowedMarketIds')) {
        updates.allowedMarketIds = Array.isArray(allowedMarketIds) && allowedMarketIds.length > 0 ? allowedMarketIds : null;
      }
      res.json(await storage.updateExternalApiKey(id, updates));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/api-keys/:id', requireAdmin, async (req, res) => {
    try {
      await storage.deleteExternalApiKey(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI Suggestions ────────────────────────────────────────────────────────

  app.get('/api/admin/ai-suggestions', requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
      res.json(await storage.getAiSuggestions({ status, vendorId, marketId }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/ai-suggestions/count', requireAdmin, async (_req, res) => {
    try {
      res.json({ count: await storage.getPendingAiSuggestionsCount() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/ai-suggestions/:id/approve', requireAdmin, async (req, res) => {
    try {
      const suggestion = await storage.getAiSuggestionById(req.params.id);
      if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
      if (suggestion.status !== 'pending') return res.status(400).json({ error: 'Suggestion is not pending' });

      const finalValue = req.body.value !== undefined ? parseFloat(req.body.value) : null;
      const finalCommentary = req.body.commentary !== undefined ? req.body.commentary : (suggestion.suggestedCommentary ?? undefined);

      // Admin can override which subject (criteria/feature) to apply the update to
      const evalType: string = req.body.overrideEvalType ?? (suggestion.suggestionType === 'criterion_score' ? 'vendor_evaluation' : 'product_evaluation');
      const subjectId: string = req.body.overrideSubjectId ?? suggestion.subjectId;

      if (finalValue == null || isNaN(finalValue)) {
        return res.status(400).json({ error: 'Missing or invalid value' });
      }

      if (evalType === 'vendor_evaluation') {
        await storage.createOrUpdateVendorScore({ vendorId: suggestion.vendorId, criteriaId: subjectId, score: finalValue, notes: finalCommentary });
      } else {
        // product_evaluation or ecosystem_evaluation — both update feature support
        await storage.createOrUpdateVendorFeatureSupport({ vendorId: suggestion.vendorId, featureId: subjectId, supportLevel: Math.round(finalValue), comments: finalCommentary });
      }

      const updated = await storage.updateAiSuggestionStatus(suggestion.id, 'approved');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Vendor Signals ────────────────────────────────────────────────────────

  app.get('/api/admin/vendor-signals', requireAdmin, async (req, res) => {
    const VALID_SOURCE_TYPES = ['hackernews', 'reddit', 'github', 'layoffs'] as const;
    type ValidSource = typeof VALID_SOURCE_TYPES[number];

    try {
      const { getVendorSignals } = await import('../storage/signals');

      const vendorId = typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
      const rawSource = typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined;
      const sourceType: ValidSource | undefined =
        rawSource && (VALID_SOURCE_TYPES as readonly string[]).includes(rawSource)
          ? (rawSource as ValidSource)
          : undefined;
      const parsedLimit = parseInt(req.query.limit as string, 10);
      const parsedOffset = parseInt(req.query.offset as string, 10);
      const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
      const offset = !isNaN(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

      const signals = await getVendorSignals({ vendorId, marketId, sourceType, limit, offset });
      res.json(signals);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/vendor-signals/collect', requireAdmin, async (req, res) => {
    const COLLECT_TIMEOUT_MS = 60_000;

    try {
      const { vendorId, marketId } = req.body ?? {};
      const { collectSignalsForVendor, collectSignalsForMarket, collectSignalsForAllVendors } = await import('../signals/orchestrator');
      const { storage: st } = await import('../storage');

      const collectPromise = (async () => {
        if (vendorId) {
          const vendor = await st.getVendorById(vendorId);
          if (!vendor) throw Object.assign(new Error('Vendor not found'), { statusCode: 404 });
          return [await collectSignalsForVendor(vendor.id, vendor.name, vendor.marketId, vendor.website)];
        }
        if (marketId) return collectSignalsForMarket(marketId);
        return collectSignalsForAllVendors();
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Collection timed out after 60 seconds')), COLLECT_TIMEOUT_MS)
      );

      const results = await Promise.race([collectPromise, timeoutPromise]);
      const totalNew = results.reduce((s, r) => s + r.new, 0);
      const totalSuggestions = results.reduce((s, r) => s + r.suggestionsTriggered, 0);
      res.json({ results, summary: { totalNew, totalSuggestions } });
    } catch (err: any) {
      const status = err.statusCode ?? 500;
      console.error('[Admin] Signal collection error:', err);
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/admin/vendor-signals/:id', requireAdmin, async (req, res) => {
    try {
      const { deleteVendorSignal } = await import('../storage/signals');
      await deleteVendorSignal(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/ai-suggestions/:id/reject', requireAdmin, async (req, res) => {
    try {
      const suggestion = await storage.getAiSuggestionById(req.params.id);
      if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
      const updated = await storage.updateAiSuggestionStatus(suggestion.id, 'rejected');
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
