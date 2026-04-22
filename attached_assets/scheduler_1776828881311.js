import cron from 'node-cron';
import { scrapeAllVendors } from './scraper.js';
import { analyzeAllPending } from './analyzer.js';

let scheduledTask = null;

/**
 * Start the daily scrape + analyze schedule.
 * Default: runs at 6:00 AM every day.
 */
export function startScheduler(cronExpression = '0 6 * * *') {
    if (scheduledTask) {
        console.log('[Scheduler] Already running, stopping previous schedule...');
        scheduledTask.stop();
    }

    console.log(`[Scheduler] Starting daily schedule: ${cronExpression}`);

    scheduledTask = cron.schedule(cronExpression, async () => {
        console.log(`[Scheduler] Running scheduled scrape at ${new Date().toISOString()}`);

        try {
            const scrapeResults = await scrapeAllVendors();
            console.log('[Scheduler] Scrape complete:', JSON.stringify(scrapeResults));

            let totalAnalyzed = 0;
            let batch = 0;
            while (true) {
                batch++;
                console.log(`[Scheduler] Analysis batch ${batch}...`);
                const analysisResults = await analyzeAllPending();
                const count = analysisResults.analyzed || 0;
                totalAnalyzed += count;
                console.log(`[Scheduler] Batch ${batch}: ${count} articles analyzed`);
                if (count === 0) break;
            }
            console.log(`[Scheduler] All analysis complete: ${totalAnalyzed} total articles analyzed`);

        } catch (error) {
            console.error('[Scheduler] Scheduled job failed:', error);
        }
    });

    return scheduledTask;
}

export function stopScheduler() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
        console.log('[Scheduler] Stopped');
    }
}
