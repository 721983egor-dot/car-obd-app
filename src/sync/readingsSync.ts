import type { ObdReadingSnapshot } from '../obd/types';

/**
 * Stub for later cloud sync (Car API: obd_readings).
 * No real network — companion phase 2 will POST here.
 */
export interface ReadingsSyncClient {
  /** Push one snapshot for a car. Returns local queue id / future server id. */
  enqueue(carId: string, reading: ObdReadingSnapshot): Promise<{ queuedId: string }>;
  /** Flush queue when online — not implemented yet. */
  flush(): Promise<{ sent: number; failed: number }>;
}

export class LocalQueueReadingsSync implements ReadingsSyncClient {
  private queue: Array<{ queuedId: string; carId: string; reading: ObdReadingSnapshot }> = [];

  async enqueue(carId: string, reading: ObdReadingSnapshot): Promise<{ queuedId: string }> {
    const queuedId = `local-${Date.now()}-${this.queue.length}`;
    this.queue.push({ queuedId, carId, reading });
    // Intentionally no fetch() — backend not wired.
    console.info('[ReadingsSync] queued (stub)', { queuedId, carId, at: reading.recordedAt });
    return { queuedId };
  }

  async flush(): Promise<{ sent: number; failed: number }> {
    // Future: POST /api/obd_readings
    return { sent: 0, failed: this.queue.length };
  }

  /** Test helper */
  peekQueue(): ReadonlyArray<{ queuedId: string; carId: string; reading: ObdReadingSnapshot }> {
    return this.queue;
  }
}

/** Singleton stub used by UI. */
export const readingsSync: ReadingsSyncClient = new LocalQueueReadingsSync();
