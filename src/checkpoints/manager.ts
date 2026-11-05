import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface Checkpoint {
  filePath: string;
  previousContent: string | null; // null = file did not exist before
  timestamp: number;
  label: string;
}

/** In-session undo stack for file mutations, used for /rewind and the Undo tool. */
export class CheckpointManager {
  private stack: Checkpoint[] = [];

  /** Call before mutating a file. */
  record(filePath: string, label: string): void {
    const previousContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
    this.stack.push({ filePath, previousContent, timestamp: Date.now(), label });
  }

  list(): Checkpoint[] {
    return [...this.stack].reverse();
  }

  /** Undo the most recent N checkpoints (default 1), restoring prior file content. */
  undo(count = 1): string[] {
    const restored: string[] = [];
    for (let i = 0; i < count && this.stack.length; i++) {
      const cp = this.stack.pop()!;
      if (cp.previousContent === null) {
        if (existsSync(cp.filePath)) unlinkSync(cp.filePath);
        restored.push(`removed ${cp.filePath} (was created by "${cp.label}")`);
      } else {
        mkdirSync(dirname(cp.filePath), { recursive: true });
        writeFileSync(cp.filePath, cp.previousContent, "utf-8");
        restored.push(`restored ${cp.filePath} (undid "${cp.label}")`);
      }
    }
    return restored;
  }

  clear(): void {
    this.stack = [];
  }
}
