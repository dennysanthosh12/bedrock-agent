/** Minimal unified-style line diff (LCS-based) for displaying Edit/Write changes. */
export function lineDiff(oldText: string, newText: string, context = 2): string {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  const n = a.length;
  const m = b.length;

  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  type Op = { type: "same" | "add" | "del"; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++] });
  while (j < m) ops.push({ type: "add", line: b[j++] });

  // Render with limited context around changes
  const out: string[] = [];
  let lastShown = -1;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== "same") {
      const start = Math.max(0, k - context);
      if (start > lastShown + 1) out.push("...");
      for (let c = Math.max(start, lastShown + 1); c < k; c++) {
        out.push(`  ${ops[c].line}`);
      }
      lastShown = k - 1;
    }
  }
  // second pass to actually emit changed + trailing context (simpler: rebuild linearly)
  out.length = 0;
  lastShown = -1;
  for (let k = 0; k < ops.length; k++) {
    const isChange = ops[k].type !== "same";
    const nearChange =
      isChange || ops.slice(Math.max(0, k - context), Math.min(ops.length, k + context + 1)).some((o) => o.type !== "same");
    if (!nearChange) continue;
    if (k > lastShown + 1) out.push("...");
    const prefix = ops[k].type === "add" ? "+" : ops[k].type === "del" ? "-" : " ";
    out.push(`${prefix} ${ops[k].line}`);
    lastShown = k;
  }
  return out.join("\n");
}
