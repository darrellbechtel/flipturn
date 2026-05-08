import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Redis connection so importing queue.ts doesn't try to talk to a
// live ioredis instance (Queue construction calls getRedis()).
vi.mock('../src/redis.js', () => ({
  getRedis: vi.fn(() => ({})),
}));

// Mock bullmq's Queue so we can capture .add() calls without a Redis backend.
// Each test resets the captured calls via vi.clearAllMocks().
const addMock = vi.fn(async () => ({ id: 'mock-job-id' }));
const QueueCtor = vi.fn(function MockQueue(this: unknown, _name: string, _opts: unknown) {
  // bullmq's Queue is constructed; we only need .add for these tests.
  (this as { add: typeof addMock }).add = addMock;
});

vi.mock('bullmq', () => ({
  Queue: QueueCtor,
}));

beforeEach(() => {
  // Reset call history but keep the mock implementations.
  addMock.mockClear();
  QueueCtor.mockClear();
  // Each test re-imports queue.ts to reset the lazy singleton state.
  vi.resetModules();
});

describe('enqueueWarmerRun', () => {
  it('adds a job to PRIORITY_WARMER_QUEUE with the provided clubName and reason', async () => {
    const { enqueueWarmerRun, PRIORITY_WARMER_QUEUE } = await import('../src/queue.js');

    await enqueueWarmerRun('Club Warrior Swimmers@UW', 'admin');

    expect(QueueCtor).toHaveBeenCalledTimes(1);
    expect(QueueCtor).toHaveBeenCalledWith(
      PRIORITY_WARMER_QUEUE,
      expect.objectContaining({ connection: expect.anything() }),
    );

    expect(addMock).toHaveBeenCalledTimes(1);
    const [jobName, jobData, jobOpts] = addMock.mock.calls[0]!;
    expect(jobName).toBe('warm:Club Warrior Swimmers@UW');
    expect(jobData).toEqual({
      clubName: 'Club Warrior Swimmers@UW',
      reason: 'admin',
    });
    expect(jobOpts).toMatchObject({
      delay: 0,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  });

  it('defaults reason to "cron" and delayMs to 0 when omitted', async () => {
    const { enqueueWarmerRun } = await import('../src/queue.js');

    await enqueueWarmerRun('Etobicoke Olympium SC');

    expect(addMock).toHaveBeenCalledTimes(1);
    const [, jobData, jobOpts] = addMock.mock.calls[0]!;
    expect((jobData as { reason: string }).reason).toBe('cron');
    expect((jobOpts as { delay: number }).delay).toBe(0);
  });

  it('forwards a non-zero delayMs to the BullMQ job options', async () => {
    const { enqueueWarmerRun } = await import('../src/queue.js');

    await enqueueWarmerRun('Some Club', 'cron', 12_345);

    const [, , jobOpts] = addMock.mock.calls[0]!;
    expect((jobOpts as { delay: number }).delay).toBe(12_345);
  });

  it('uses jobId "warm:<clubName>:<UTC-day-bucket>" for daily dedup', async () => {
    const { enqueueWarmerRun } = await import('../src/queue.js');

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const fixedNow = Date.UTC(2026, 4, 8, 14, 30, 0); // 2026-05-08T14:30:00Z
    const expectedBucket = Math.floor(fixedNow / ONE_DAY_MS);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedNow));
    try {
      await enqueueWarmerRun('Club Alpha', 'cron');
    } finally {
      vi.useRealTimers();
    }

    const [, , jobOpts] = addMock.mock.calls[0]!;
    const jobId = (jobOpts as { jobId: string }).jobId;
    expect(jobId).toBe(`warm:Club Alpha:${expectedBucket}`);
    // Spot-check the format: "warm:<name>:<integer>"
    expect(jobId).toMatch(/^warm:Club Alpha:\d+$/);
  });

  it('lazy-initializes the Queue singleton (one Queue across multiple enqueues)', async () => {
    const { enqueueWarmerRun } = await import('../src/queue.js');

    await enqueueWarmerRun('Club A');
    await enqueueWarmerRun('Club B');

    // Singleton: Queue constructor invoked exactly once across multiple enqueues.
    expect(QueueCtor).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledTimes(2);
  });
});
