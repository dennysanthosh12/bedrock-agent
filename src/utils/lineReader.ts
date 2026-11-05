import readline from "node:readline";

/**
 * Wraps a readline.Interface's async iterator to provide sequential, awaitable prompts.
 *
 * Node's `readline/promises` Interface.question() is unreliable with non-TTY stdin — repeated
 * calls can silently drop buffered lines (see https://github.com/nodejs/node/issues/30687-style
 * reports). Iterating the interface as an async iterable does not have this problem and works
 * identically for piped input and real TTYs, so all prompting in this app goes through here.
 */
export class LineReader {
  private iterator: AsyncIterator<string>;

  constructor(private rl: readline.Interface) {
    this.iterator = rl[Symbol.asyncIterator]();
  }

  /** Returns null when stdin has closed (EOF), so callers can distinguish that from an empty line. */
  async ask(promptText: string): Promise<string | null> {
    process.stdout.write(promptText);
    const { value, done } = await this.iterator.next();
    if (done) return null;
    return value;
  }

  close(): void {
    this.rl.close();
  }
}
