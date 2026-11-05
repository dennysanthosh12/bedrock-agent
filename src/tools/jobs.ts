import type { ChildProcess } from "node:child_process";

export interface BackgroundJob {
  id: string;
  command: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  status: "running" | "exited";
  exitCode: number | null;
}

let counter = 0;

export class JobRegistry {
  private jobs = new Map<string, BackgroundJob>();

  create(command: string, process: ChildProcess): BackgroundJob {
    const id = `bash_${++counter}`;
    const job: BackgroundJob = { id, command, process, stdout: "", stderr: "", status: "running", exitCode: null };
    process.stdout?.on("data", (d) => (job.stdout += d.toString()));
    process.stderr?.on("data", (d) => (job.stderr += d.toString()));
    process.on("close", (code) => {
      job.status = "exited";
      job.exitCode = code;
    });
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): BackgroundJob | undefined {
    return this.jobs.get(id);
  }

  list(): BackgroundJob[] {
    return [...this.jobs.values()];
  }

  kill(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.process.kill();
    return true;
  }

  /** Returns and clears new output since last read. */
  drain(id: string): { stdout: string; stderr: string } | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const out = { stdout: job.stdout, stderr: job.stderr };
    job.stdout = "";
    job.stderr = "";
    return out;
  }
}
