/**
 * An async-iterable queue of SDK user messages.
 *
 * This is the heart of the "long-lived session" mechanism. The Agent SDK's
 * `query()` keeps the session open for as long as its `prompt` async iterator
 * has not finished. By driving `query()` with this queue, the iterator BLOCKS
 * (awaits) whenever there is nothing to send instead of returning — so the
 * session never ends on its own. It only ends when `close()` is called
 * explicitly (e.g. on shutdown).
 *
 * This is exactly what the escalation flow needs: while waiting for the user's
 * approval, the queue is empty, the iterator is parked, and the SDK session
 * stays alive. When the approval arrives (TASK-31/TASK-32 will push it in),
 * `push()` wakes the iterator and the conversation continues.
 */
export interface QueueUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: string | null;
}

export class MessageQueue<T = QueueUserMessage> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private resolveNext: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;

  /** Enqueue a message; wakes a parked consumer if one is waiting. */
  push(item: T): void {
    if (this.closed) {
      throw new Error("Cannot push to a closed MessageQueue");
    }
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  /** End the queue — this lets the SDK session terminate gracefully. */
  close(): void {
    this.closed = true;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /** True once `close()` has been called. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Number of buffered, not-yet-consumed messages. */
  get pending(): number {
    return this.buffer.length;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({
            value: undefined as unknown as T,
            done: true,
          });
        }
        // Park until push()/close() resolves us. This is what keeps the
        // session alive while waiting for the next input (e.g. an approval).
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolveNext = resolve;
        });
      },
    };
  }
}
