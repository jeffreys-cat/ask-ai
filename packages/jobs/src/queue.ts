export interface JobQueue<T> {
  enqueue(job: T): Promise<void>;
}

export function createInlineQueue<T>(handler: (job: T) => Promise<void>): JobQueue<T> {
  return {
    async enqueue(job: T) {
      await handler(job);
    },
  };
}
