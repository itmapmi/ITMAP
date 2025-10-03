import * as cron from 'node-cron';
import { newsProcessor } from './newsProcessor';

export class CronJobManager {
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  /**
   * Initialize all cron jobs
   */
  public initializeCronJobs(): void {
    console.log('Initializing cron jobs...');

    // Daily news processing at 6:00 AM UTC
    const dailyNewsJob = cron.schedule('0 6 * * *', async () => {
      console.log('Starting scheduled daily news processing...');
      try {
        await newsProcessor.processAllMarkets();
        console.log('Scheduled daily news processing completed successfully');
      } catch (error) {
        console.error('Error in scheduled daily news processing:', error);
      }
    }, {
      timezone: 'UTC'
    });

    this.jobs.set('dailyNews', dailyNewsJob);

    // Weekly vendor position backup at Sunday 2:00 AM UTC
    const weeklyBackupJob = cron.schedule('0 2 * * 0', async () => {
      console.log('Starting weekly vendor position backup...');
      try {
        await this.backupVendorPositions();
        console.log('Weekly vendor position backup completed');
      } catch (error) {
        console.error('Error in weekly vendor position backup:', error);
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
   * Get status of all jobs
   */
  public getJobStatus(): { [jobName: string]: { running: boolean, nextRun?: string } } {
    const status: { [jobName: string]: { running: boolean, nextRun?: string } } = {};

    // Return static status for the jobs we know exist
    status['dailyNews'] = {
      running: this.jobs.has('dailyNews'),
      nextRun: 'Daily at 6:00 AM UTC'
    };
    
    status['weeklyBackup'] = {
      running: this.jobs.has('weeklyBackup'),
      nextRun: 'Weekly on Sunday at 2:00 AM UTC'  
    };
    
    status['healthCheck'] = {
      running: this.jobs.has('healthCheck'),
      nextRun: 'Every hour'
    };
    
    status['userLogsCleanup'] = {
      running: this.jobs.has('userLogsCleanup'),
      nextRun: 'Daily at 3:00 AM UTC'
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
   * Manually trigger daily news processing
   */
  public async triggerDailyNewsProcessing(): Promise<void> {
    console.log('Manually triggering daily news processing...');
    try {
      await newsProcessor.processAllMarkets();
      console.log('Manual daily news processing completed successfully');
    } catch (error) {
      console.error('Error in manual daily news processing:', error);
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
   * Cleanup old news items (keep last 90 days)
   */
  public async cleanupOldNews(): Promise<void> {
    try {
      console.log('Starting cleanup of old news items...');
      
      // This would require a new storage method to delete old news
      // For now, just log the action
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);
      
      console.log(`Would cleanup news items older than ${cutoffDate.toISOString()}`);
      console.log('News cleanup completed (currently a no-op - would need database cleanup method)');
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