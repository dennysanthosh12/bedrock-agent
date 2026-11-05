import chalk from "chalk";
import type { PermissionMode } from "../types.js";
import type { LineReader } from "../utils/lineReader.js";

export class PermissionManager {
  private mode: PermissionMode;
  /** remembers "always allow" choices for the session, keyed by a caller-supplied scope string */
  private sessionAllow = new Set<string>();

  constructor(mode: PermissionMode, private lines: LineReader) {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  async request(summary: string, detail: string, scope?: string): Promise<boolean> {
    if (this.mode === "auto") return true;

    if (scope && this.sessionAllow.has(scope)) return true;

    // In plan mode, nothing that mutates state is allowed to actually run.
    if (this.mode === "plan") {
      console.log(chalk.yellow(`\n[plan mode] Would request approval for: ${summary}`));
      return false;
    }

    console.log(chalk.yellow(`\n⚠ Permission requested: ${summary}`));
    if (detail) console.log(chalk.gray(detail));
    const raw = await this.lines.ask(chalk.cyan("Allow? [y]es / [n]o / [a]lways for this session: "));
    const answer = (raw ?? "").trim().toLowerCase();

    if (answer === "a" || answer === "always") {
      if (scope) this.sessionAllow.add(scope);
      return true;
    }
    return answer === "y" || answer === "yes";
  }

  async askUser(
    question: string,
    options: { label: string; description?: string }[],
    multiSelect = false
  ): Promise<string[]> {
    if (this.mode === "auto") {
      // no human available; default to the first option so automation doesn't block forever
      return options.length ? [options[0].label] : [];
    }
    console.log(chalk.cyan(`\n? ${question}`));
    options.forEach((o, i) => {
      console.log(chalk.gray(`  ${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`));
    });
    const prompt = multiSelect ? "Enter option number(s), comma-separated: " : "Enter option number: ";
    const answer = ((await this.lines.ask(chalk.cyan(prompt))) ?? "").trim();
    const indices = answer
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < options.length);
    const chosen = indices.map((i) => options[i].label);
    return chosen.length ? chosen : [answer]; // fall back to free-text "Other" answer
  }

  close(): void {
    // lifecycle of the underlying LineReader/readline.Interface is owned by whoever created it (index.ts)
  }
}
