import { MessageQueue } from "../messageQueue";

describe("MessageQueue (long-lived session driver)", () => {
  it("delivers buffered items in FIFO order", async () => {
    const q = new MessageQueue<number>();
    q.push(1);
    q.push(2);
    const it = q[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe(1);
    expect((await it.next()).value).toBe(2);
  });

  it("parks (does not resolve) while empty — keeps the session open", async () => {
    const q = new MessageQueue<number>();
    const it = q[Symbol.asyncIterator]();
    let resolved = false;
    const pending = it.next().then((r) => {
      resolved = true;
      return r;
    });

    // Give the microtask queue a chance; it must still be parked.
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Pushing wakes the parked consumer.
    q.push(99);
    const result = await pending;
    expect(resolved).toBe(true);
    expect(result).toEqual({ value: 99, done: false });
  });

  it("close() ends the iterator (lets the session terminate)", async () => {
    const q = new MessageQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.close();
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(q.isClosed).toBe(true);
  });

  it("push() after close() throws", () => {
    const q = new MessageQueue<number>();
    q.close();
    expect(() => q.push(1)).toThrow(/closed/);
  });
});
