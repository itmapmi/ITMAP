import * as cron from 'node-cron';
import { scrapeAllVendors, scrapeSingleVendor, type ScrapeResult } from './news/ingestion/scraper';
import { analyzeAllPending } from './news/impact/analyzer';
import { checkAllNewsroomUrls, getNewlyBrokenResults } from './news/ingestion/urlHealthCheck';
import { sendNewsroomAlertEmail } from './emailService';
import { storage } from './storage';

export class CronJobManager {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private lastRun: Map<string, { timestamp: Date; status: 'success' | 'failed'; error?: string }> = new Map();

  /**
   * Initialize all cron jobs
   */
  public initializeCronJobs(): void {
    console.log('Initializing cron jobs...');

    // Daily database backup to GCS at 2:30 AM UTC
    const dbBackupJob = cron.schedule('30 2 * * *', async () => {
      console.log('[dbBackup] Starting daily database backup...');
      try {
        const { runDatabaseBackup } = await import('./backup');
        const result = await runDatabaseBackup();
        console.log(`[dbBackup] Done — ${result.filename} (${result.sizeMb} MB) → ${result.bucket}`);
        this.lastRun.set('dbBackup', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[dbBackup] Failed:', error);
        this.lastRun.set('dbBackup', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });

    this.jobs.set('dbBackup', dbBackupJob);

    // Weekly vendor position backup at Sunday 2:00 AM UTC
    const weeklyBackupJob = cron.schedule('0 2 * * 0', async () => {
      console.log('Starting weekly vendor position backup...');
      try {
        await this.backupVendorPositions();
        console.log('Weekly vendor position backup completed');
        this.lastRun.set('weeklyBackup', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('Error in weekly vendor position backup:', error);
        this.lastRun.set('weeklyBackup', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('weeklyBackup', weeklyBackupJob);

    // Health check every hour
    const healthCheckJob = cron.schedule('0 * * * *', () => {
      console.log('Cron jobs health check - All systems running');
      this.logJobStatus();
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('healthCheck', healthCheckJob);

    // Daily user activity logs cleanup at 3:00 AM UTC (remove logs older than 6 months)
    const userLogsCleanupJob = cron.schedule('0 3 * * *', async () => {
      console.log('Starting user activity logs cleanup...');
      try {
        await this.cleanupOldUserLogs();
        console.log('User activity logs cleanup completed');
      } catch (error) {
        console.error('Error in user activity logs cleanup:', error);
      }
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('userLogsCleanup', userLogsCleanupJob);

    // Weekly news cleanup at Sunday 4:00 AM UTC (remove articles older than 90 days)
    const newsCleanupJob = cron.schedule('0 4 * * 0', async () => {
      console.log('Starting weekly news cleanup...');
      try {
        await this.cleanupOldNews();
        console.log('Weekly news cleanup completed');
        this.lastRun.set('newsCleanup', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('Error in weekly news cleanup:', error);
        this.lastRun.set('newsCleanup', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('newsCleanup', newsCleanupJob);

    // Daily newsroom URL health check at 6:30 AM UTC — runs before the scrape
    const newsroomHealthCheckJob = cron.schedule('30 6 * * *', async () => {
      console.log('[Cron] Starting daily newsroom URL health check...');
      try {
        const results = await checkAllNewsroomUrls();
        const broken = results.filter(r => r.status === 'broken');
        if (broken.length > 0) {
          console.warn(`[Cron] ${broken.length} newsroom URL(s) are unreachable: ${broken.map(r => r.vendorName).join(', ')}`);
        }
        console.log(`[Cron] Newsroom URL health check done: ${results.length} checked, ${broken.length} broken`);
        this.lastRun.set('newsroomHealthCheck', { timestamp: new Date(), status: 'success' });

        // Send email alerts for newly-broken URLs
        await dispatchHealthAlertEmails(results);
      } catch (error) {
        console.error('[Cron] Error in newsroom URL health check:', error);
        this.lastRun.set('newsroomHealthCheck', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('newsroomHealthCheck', newsroomHealthCheckJob);

    // Daily news pipeline at 7:00 AM UTC — scrape then analyze in sequence
    const newsIngestionJob = cron.schedule('0 7 * * *', () => {
      this.runNewsIngestion();
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('newsIngestion', newsIngestionJob);

    // Monthly new-players discovery scan — runs on the 1st of each month at 5:00 AM UTC.
    // Iterates over every market and asks the AI agent to surface new candidate vendors,
    // which land in the new_players table for admin approval.
    const newPlayersDiscoveryJob = cron.schedule('0 5 1 * *', async () => {
      console.log('[Cron] Starting monthly new-players discovery scan...');
      try {
        const { discoverNewPlayers } = await import('./agents/new-players-discovery');
        const markets = await storage.getAllMarkets();
        let scanned = 0;
        let totalAdded = 0;
        let failed = 0;
        for (const market of markets) {
          try {
            const result = await discoverNewPlayers(market.id);
            scanned++;
            totalAdded += result.added.length;
            console.log(
              `[Cron] Discovery: ${market.name} → +${result.added.length} added, ${result.skippedDuplicates.length} skipped (of ${result.totalSuggested} suggested)`
            );
          } catch (err) {
            failed++;
            console.error(`[Cron] Discovery failed for market "${market.name}" (${market.id}):`, err);
          }
        }
        console.log(
          `[Cron] Monthly discovery done: ${scanned}/${markets.length} markets scanned, ${totalAdded} new candidates added, ${failed} failed`
        );
        this.lastRun.set('newPlayersDiscovery', { timestamp: new Date(), status: failed === 0 ? 'success' : 'failed' });
      } catch (error) {
        console.error('[Cron] Error in monthly new-players discovery scan:', error);
        this.lastRun.set('newPlayersDiscovery', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('newPlayersDiscovery', newPlayersDiscoveryJob);

    // Weekly signal cleanup — Sundays 5:00 AM UTC (remove signals older than 120 days + linked suggestions)
    const signalCleanupJob = cron.schedule('0 5 * * 0', async () => {
      console.log('[Cron] Starting weekly signal cleanup (>120 days)...');
      try {
        const { pruneOldSignals } = await import('./storage/signals');
        const { signals, suggestions } = await pruneOldSignals(120);
        console.log(`[Cron] Signal cleanup done: ${signals} signal(s) removed, ${suggestions} suggestion(s) removed`);
        this.lastRun.set('signalCleanup', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in signal cleanup:', error);
        this.lastRun.set('signalCleanup', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });

    this.jobs.set('signalCleanup', signalCleanupJob);

    // Signal collection once daily — 8:00 AM UTC (reduced from twice daily to cut noise volume)
    const signalCollectionJob = cron.schedule('0 8 * * *', async () => {
      console.log('[Cron] Starting vendor signal collection...');
      try {
        const { collectSignalsForAllVendors } = await import('./signals/orchestrator');
        const results = await collectSignalsForAllVendors();
        const totalNew = results.reduce((s, r) => s + r.new, 0);
        const totalSuggestions = results.reduce((s, r) => s + r.suggestionsTriggered, 0);
        console.log(`[Cron] Signal collection done: ${totalNew} new signals, ${totalSuggestions} suggestions triggered`);
        this.lastRun.set('signalCollection', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in signal collection:', error);
        this.lastRun.set('signalCollection', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });

    this.jobs.set('signalCollection', signalCollectionJob);

    // Phase 2: Weekly datasheet digest emails — Mondays 8:00 UTC
    const weeklyDatasheetDigestJob = cron.schedule('0 8 * * 1', async () => {
      console.log('[Cron] Starting weekly datasheet digest...');
      try {
        const { runWeeklyDatasheetDigest } = await import('./datasheets/digestCron');
        const summary = await runWeeklyDatasheetDigest();
        console.log(`[Cron] Datasheet digest done: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed`);
        this.lastRun.set('weeklyDatasheetDigest', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in weekly datasheet digest:', error);
        this.lastRun.set('weeklyDatasheetDigest', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });
    this.jobs.set('weeklyDatasheetDigest', weeklyDatasheetDigestJob);

    // Phase 2: Weekly datasheet re-extraction for opted-in vendors — Sundays 3:30 UTC
    const weeklyDatasheetReextractJob = cron.schedule('30 3 * * 0', async () => {
      console.log('[Cron] Starting weekly datasheet re-extraction...');
      try {
        const { runWeeklyReextract } = await import('./datasheets/reextractCron');
        const summary = await runWeeklyReextract();
        console.log(`[Cron] Datasheet re-extract done: ${summary.checked} checked, ${summary.changed} updated, ${summary.failed} failed`);
        this.lastRun.set('weeklyDatasheetReextract', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in weekly datasheet re-extract:', error);
        this.lastRun.set('weeklyDatasheetReextract', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });
    this.jobs.set('weeklyDatasheetReextract', weeklyDatasheetReextractJob);

    // ── CVE Intelligence sync jobs ─────────────────────────────────────
    // Gated behind FEATURE_CVE_MODULE env var (set to 'false' to disable).
    // Defaults to enabled; set FEATURE_CVE_MODULE=false to skip registration.
    if (process.env.FEATURE_CVE_MODULE !== 'false') {
    // NVD: every 2 hours (incremental after initial population)
    const nvdSyncJob = cron.schedule('0 */2 * * *', async () => {
      console.log('[Cron] Starting NVD CVE sync...');
      try {
        const { runNvdSync } = await import('./cve/sync/nvd');
        await runNvdSync();
        this.lastRun.set('nvdSync', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in NVD sync:', error);
        this.lastRun.set('nvdSync', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });
    this.jobs.set('nvdSync', nvdSyncJob);

    // KEV: daily at 05:00 UTC
    const kevSyncJob = cron.schedule('0 5 * * *', async () => {
      console.log('[Cron] Starting CISA KEV sync...');
      try {
        const { runKevSync } = await import('./cve/sync/kev');
        await runKevSync();
        this.lastRun.set('kevSync', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in KEV sync:', error);
        this.lastRun.set('kevSync', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });
    this.jobs.set('kevSync', kevSyncJob);

    // EPSS: daily at 04:00 UTC
    const epssSyncJob = cron.schedule('0 4 * * *', async () => {
      console.log('[Cron] Starting FIRST EPSS sync...');
      try {
        const { runEpssSync } = await import('./cve/sync/epss');
        await runEpssSync();
        this.lastRun.set('epssSync', { timestamp: new Date(), status: 'success' });
      } catch (error) {
        console.error('[Cron] Error in EPSS sync:', error);
        this.lastRun.set('epssSync', { timestamp: new Date(), status: 'failed', error: String(error) });
      }
    }, { timezone: 'UTC' });
    this.jobs.set('epssSync', epssSyncJob);
    } // end FEATURE_CVE_MODULE gate

    console.log(`Initialized ${this.jobs.size} cron jobs`);
  }

  /**
   * Start all cron jobs
   */
  public startAllJobs(): void {
    console.log('Starting all cron jobs...');
    let startedCount = 0;

    this.jobs.forEach((job, name) => {
      try {
        job.start();
        startedCount++;
        console.log(`Started cron job: ${name}`);
      } catch (error) {
        console.error(`Error starting cron job ${name}:`, error);
      }
    });

    console.log(`Started ${startedCount}/${this.jobs.size} cron jobs`);
  }

  /**
   * Stop all cron jobs
   */
  public stopAllJobs(): void {
    console.log('Stopping all cron jobs...');
    
    this.jobs.forEach((job, name) => {
      try {
        job.stop();
        console.log(`Stopped cron job: ${name}`);
      } catch (error) {
        console.error(`Error stopping cron job ${name}:`, error);
      }
    });
  }

  /**
   * Start a specific job
   */
  public startJob(jobName: string): boolean {
    const job = this.jobs.get(jobName);
    if (job) {
      job.start();
      console.log(`Started cron job: ${jobName}`);
      return true;
    }
    console.error(`Cron job not found: ${jobName}`);
    return false;
  }

  /**
   * Stop a specific job
   */
  public stopJob(jobName: string): boolean {
    const job = this.jobs.get(jobName);
    if (job) {
      job.stop();
      console.log(`Stopped cron job: ${jobName}`);
      return true;
    }
    console.error(`Cron job not found: ${jobName}`);
    return false;
  }

  /**
   * Run the news ingestion pipeline (scrape + analyze).
   * Called by the daily cron and also on startup when a pipeline gap is detected.
   */
  public async runNewsIngestion(): Promise<void> {
    console.log('[Cron] Starting daily news pipeline (scrape + analyze)...');
    try {
      const allVendors = await storage.getAllVendors();
      const missingUrl = allVendors.filter(v => !v.newsroomUrl);
      if (missingUrl.length > 0) {
        console.warn(
          `[Cron] WARNING: ${missingUrl.length} vendor(s) are missing a newsroom URL and will be skipped by the scraper: ${missingUrl.map(v => v.name).join(', ')}`
        );
      }

      const scrapeResults = await scrapeAllVendors();
      const totalNew = scrapeResults.reduce((sum, r) => sum + r.newCount, 0);
      console.log(`[Cron] Scrape done: ${totalNew} new articles across ${scrapeResults.length} vendors`);

      const { analyzed } = await analyzeAllPending(50);
      console.log(`[Cron] Analysis done: ${analyzed} articles analyzed`);

      this.lastRun.set('newsIngestion', { timestamp: new Date(), status: 'success' });
    } catch (error) {
      console.error('[Cron] Error in daily news pipeline:', error);
      this.lastRun.set('newsIngestion', { timestamp: new Date(), status: 'failed', error: String(error) });
    }
  }

  /**
   * Get status of all jobs
   */
  public getJobStatus(): { [jobName: string]: { running: boolean, nextRun?: string, lastRun?: { timestamp: Date; status: string; error?: string } } } {
    const status: { [jobName: string]: { running: boolean, nextRun?: string, lastRun?: { timestamp: Date; status: string; error?: string } } } = {};

    // Return static status for the jobs we know exist
    status['newsIngestion'] = {
      running: this.jobs.has('newsIngestion'),
      nextRun: 'Daily at 7:00 AM UTC (scrape)',
      lastRun: this.lastRun.get('newsIngestion')
    };

    status['dbBackup'] = {
      running: this.jobs.has('dbBackup'),
      nextRun: 'Daily at 2:30 AM UTC',
      lastRun: this.lastRun.get('dbBackup')
    };

    status['weeklyBackup'] = {
      running: this.jobs.has('weeklyBackup'),
      nextRun: 'Weekly on Sunday at 2:00 AM UTC',
      lastRun: this.lastRun.get('weeklyBackup')
    };
    
    status['healthCheck'] = {
      running: this.jobs.has('healthCheck'),
      nextRun: 'Every hour'
    };
    
    status['userLogsCleanup'] = {
      running: this.jobs.has('userLogsCleanup'),
      nextRun: 'Daily at 3:00 AM UTC'
    };
    
    status['newsCleanup'] = {
      running: this.jobs.has('newsCleanup'),
      nextRun: 'Weekly on Sunday at 4:00 AM UTC',
      lastRun: this.lastRun.get('newsCleanup')
    };

    status['newsroomHealthCheck'] = {
      running: this.jobs.has('newsroomHealthCheck'),
      nextRun: 'Daily at 6:30 AM UTC',
      lastRun: this.lastRun.get('newsroomHealthCheck')
    };

    status['newPlayersDiscovery'] = {
      running: this.jobs.has('newPlayersDiscovery'),
      nextRun: 'Monthly on the 1st at 5:00 AM UTC',
      lastRun: this.lastRun.get('newPlayersDiscovery')
    };

    status['signalCollection'] = {
      running: this.jobs.has('signalCollection'),
      nextRun: 'Daily at 8:00 AM UTC',
      lastRun: this.lastRun.get('signalCollection')
    };

    status['signalCleanup'] = {
      running: this.jobs.has('signalCleanup'),
      nextRun: 'Weekly on Sunday at 5:00 AM UTC (removes signals >120 days old)',
      lastRun: this.lastRun.get('signalCleanup')
    };

    return status;
  }

  /**
   * Log status of all jobs
   */
  private logJobStatus(): void {
    const status = this.getJobStatus();
    console.log('Cron Jobs Status:', JSON.stringify(status, null, 2));
  }

  /**
   * Manually trigger news scraping (and then analysis)
   */
  public async triggerNewsIngestion(vendorId?: string): Promise<{ scrapeResults: ScrapeResult[]; analyzed: number }> {
    console.log('[Cron] Manually triggering news pipeline (scrape + analyze)...');
    try {
      if (!vendorId) {
        const { storage } = await import('./storage');
        const allVendors = await storage.getAllVendors();
        const missingUrl = allVendors.filter(v => !v.newsroomUrl);
        if (missingUrl.length > 0) {
          console.warn(
            `[Cron] WARNING: ${missingUrl.length} vendor(s) are missing a newsroom URL and will be skipped by the scraper: ${missingUrl.map(v => v.name).join(', ')}`
          );
        }
      }

      const scrapeResults = vendorId
        ? await scrapeSingleVendor(vendorId)
        : await scrapeAllVendors();
      const resultsArray = Array.isArray(scrapeResults) ? scrapeResults : [scrapeResults];
      const totalNew = resultsArray.reduce((sum, r) => sum + r.newCount, 0);
      console.log(`[Cron] Manual scrape done: ${totalNew} new articles`);

      const { analyzed } = await analyzeAllPending(50);
      console.log(`[Cron] Manual analysis done: ${analyzed} articles analyzed`);
      this.lastRun.set('newsIngestion', { timestamp: new Date(), status: 'success' });

      return { scrapeResults: resultsArray, analyzed };
    } catch (error) {
      console.error('[Cron] Error in manual news pipeline:', error);
      this.lastRun.set('newsIngestion', { timestamp: new Date(), status: 'failed', error: String(error) });
      throw error;
    }
  }

  /**
   * Backup vendor positions for historical tracking
   */
  private async backupVendorPositions(): Promise<void> {
    try {
      const { storage } = await import('./storage');
      const markets = await storage.getAllMarkets();
      
      for (const market of markets) {
        const vendors = await storage.getVendorsByMarket(market.id);
        const scores = await storage.getMarketVendorScores(market.id);
        
        for (const vendor of vendors) {
          // Calculate aggregate scores for execution and viability
          const vendorScores = scores.filter(s => s.vendorId === vendor.id);
          
          if (vendorScores.length === 0) continue;
          
          // Get criteria weights for proper calculation
          const weights = await storage.getMarketCriteriaWeights(market.id);
          const weightMap = new Map(weights.map(w => [w.criteriaId, w.weight]));
          
          let executionTotal = 0;
          let viabilityTotal = 0;
          let executionWeight = 0;
          let viabilityWeight = 0;
          
          for (const score of vendorScores) {
            const weightValue = weightMap.get(score.criteriaId) || '50'; // Default 50% if no weight set
            const weight = Number(weightValue);
            const scoreValue = Number(score.score);
            const category = score.criteria.category.toLowerCase();
            
            if (category.includes('execution')) {
              executionTotal += scoreValue * weight;
              executionWeight += weight;
            } else if (category.includes('viability') || category.includes('vision')) {
              viabilityTotal += scoreValue * weight;
              viabilityWeight += weight;
            }
          }
          
          const executionScore = executionWeight > 0 ? (executionTotal / executionWeight).toString() : '0';
          const viabilityScore = viabilityWeight > 0 ? (viabilityTotal / viabilityWeight).toString() : '0';
          
          // Save historical position
          await storage.saveHistoricalPosition({
            vendorId: vendor.id,
            marketId: market.id,
            executionScore,
            viabilityScore,
            recordedAt: new Date()
          });
          
          console.log(`Backed up position for ${vendor.name}: execution=${executionScore}, viability=${viabilityScore}`);
        }
      }
    } catch (error) {
      console.error('Error backing up vendor positions:', error);
      throw error;
    }
  }

  /**
   * Cleanup old news items and fetch logs (keep last 12 months)
   */
  public async cleanupOldNews(): Promise<void> {
    try {
      console.log('Starting cleanup of old news items and fetch logs...');
      
      const { newsStorage } = await import('./news/storage');
      
      // Calculate cutoff date (12 months / 365 days ago)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 365);
      
      console.log(`Cleaning up news articles and fetch logs older than ${cutoffDate.toISOString()}`);
      
      // Delete old articles
      const deletedArticles = await newsStorage.deleteArticlesOlderThan(cutoffDate);
      console.log(`Deleted ${deletedArticles} articles older than 12 months`);

      // Delete old fetch logs
      const deletedLogs = await newsStorage.deleteFetchLogsOlderThan(cutoffDate);
      console.log(`Deleted ${deletedLogs} fetch logs older than 12 months`);
      
      console.log('News cleanup completed successfully');
    } catch (error) {
      console.error('Error cleaning up old news:', error);
      throw error;
    }
  }

  /**
   * Cleanup user activity logs older than 6 months
   */
  public async cleanupOldUserLogs(): Promise<void> {
    try {
      console.log('Starting cleanup of user activity logs older than 6 months...');
      
      const { storage } = await import('./storage');
      
      // Calculate cutoff date (6 months ago)
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 6);
      
      console.log(`Cleaning up user activity logs older than ${cutoffDate.toISOString()}`);
      
      // Delete logs older than cutoff date
      await storage.pruneUserLogsBefore(cutoffDate);
      
      console.log('User activity logs cleanup completed successfully');
    } catch (error) {
      console.error('Error cleaning up user activity logs:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const cronJobManager = new CronJobManager();

/**
 * Resolves alert recipients and sends alert emails for newly-broken URLs.
 * Respects the global email alerts toggle and per-vendor opt-out flags.
 */
export async function dispatchHealthAlertEmails(
  results: import('./news/ingestion/urlHealthCheck').UrlHealthResult[]
): Promise<void> {
  try {
    const alertSettings = await storage.getAlertSettings();

    // Global opt-out
    if (alertSettings && !alertSettings.emailAlertsEnabled) {
      console.log('[EmailAlert] Email alerts are globally disabled. Skipping.');
      return;
    }

    // Determine newly broken URLs
    const newlyBroken = getNewlyBrokenResults(results);
    if (newlyBroken.length === 0) {
      console.log('[EmailAlert] No newly-broken URLs. Skipping alert email.');
      return;
    }

    // Filter out vendors that opted out of alerts
    const allVendors = await storage.getAllVendors();
    const disabledVendorIds = new Set(
      allVendors.filter(v => v.newsroomAlertDisabled).map(v => v.id)
    );
    const alertable = newlyBroken.filter(r => !disabledVendorIds.has(r.vendorId));
    if (alertable.length === 0) {
      console.log('[EmailAlert] All newly-broken vendors have alerts disabled. Skipping.');
      return;
    }

    // Resolve recipient emails
    let recipients: string[] = [];
    if (alertSettings?.recipientEmails) {
      recipients = alertSettings.recipientEmails
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);
    }
    if (recipients.length === 0) {
      const adminUsers = await storage.getAdminUsers();
      recipients = adminUsers.map(u => u.email).filter((e): e is string => !!e);
    }

    await sendNewsroomAlertEmail(alertable, recipients);
  } catch (err) {
    console.error('[EmailAlert] Error dispatching health alert emails:', err);
  }
}