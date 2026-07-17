import type { ScheduledTask, AutomationSettings } from '../contracts/automation-types.js'
import type { AutomationRuntime } from './automation-runtime.js'

/**
 * Automation Scheduler
 *
 * Lightweight cron-based scheduler for recurring automation tasks. Evaluates
 * enabled schedules on each tick, compares nextRunAt against current time, and
 * triggers task execution through AutomationRuntime.
 *
 * Does not implement full cron parsing — relies on external libraries or manual
 * nextRunAt calculation. This is a minimal orchestration layer.
 */

export type SchedulerDeps = {
  runtime: AutomationRuntime
  /**
   * Parse a cron expression and return the next run time after 'from'.
   * External cron library required (e.g., cronstrue, cron-parser).
   */
  cronNext: (cron: string, from: Date, timezone: string) => Date | null
  logError?: (category: string, message: string, detail?: unknown) => void
  now?: () => Date
}

export class AutomationScheduler {
  private deps: SchedulerDeps
  private settings: AutomationSettings | null = null
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(deps: SchedulerDeps) {
    this.deps = deps
  }

  sync(settings: AutomationSettings): void {
    this.settings = settings
  }

  /**
   * Start the scheduler. Ticks every minute to check for due schedules.
   * Idempotent: multiple start() calls have no effect if already running.
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.tick()
  }

  /**
   * Stop the scheduler and clear pending timers.
   */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    if (!this.running) return

    const now = this.now()
    const schedules = this.settings?.schedules ?? []

    for (const schedule of schedules) {
      if (!schedule.enabled) continue
      if (!schedule.nextRunAt || new Date(schedule.nextRunAt) <= now) {
        void this.executeSchedule(schedule, now)
      }
    }

    // Schedule next tick in 60 seconds
    this.timer = setTimeout(() => this.tick(), 60_000)
  }

  private async executeSchedule(schedule: ScheduledTask, now: Date): Promise<void> {
    const employee = this.settings?.employees.find((e) => e.id === schedule.employeeId)
    if (!employee) {
      this.logError('scheduler', 'Employee not found for schedule', { scheduleId: schedule.id })
      return
    }

    try {
      // Trigger task execution
      await this.deps.runtime.runTask({
        employeeId: schedule.employeeId,
        source: 'schedule',
        inputText: schedule.prompt,
        prompt: schedule.prompt,
        sourceMetadata: { scheduleId: schedule.id, scheduleName: schedule.name }
      })

      // Update last run time
      schedule.lastRunAt = now.toISOString()

      // Calculate next run time
      const next = this.deps.cronNext(schedule.cron, now, schedule.timezone)
      if (next) {
        schedule.nextRunAt = next.toISOString()
      } else {
        // Invalid cron or no future occurrence, disable schedule
        schedule.enabled = false
        this.logError('scheduler', 'Schedule disabled due to invalid cron or no future occurrence', {
          scheduleId: schedule.id,
          cron: schedule.cron
        })
      }

      schedule.updatedAt = now.toISOString()
    } catch (error) {
      this.logError('scheduler', 'Schedule execution failed', {
        scheduleId: schedule.id,
        error: error instanceof Error ? error.message : String(error)
      })

      // Retry logic based on failure policy
      const policy = schedule.failurePolicy
      if (policy.maxRetries > 0) {
        const nextRetry = new Date(now.getTime() + policy.retryDelayMinutes * 60_000)
        schedule.nextRunAt = nextRetry.toISOString()
      }
    }
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date()
  }

  private logError(category: string, message: string, detail?: unknown): void {
    if (this.deps.logError) {
      this.deps.logError(category, message, detail)
    }
  }
}
