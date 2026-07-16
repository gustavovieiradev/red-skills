import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TrackerIssue, TrackerPort, TrackerLabelMutation, TrackerIssueReference } from "../port.js";
import { parseTrackerClaimRecords, type RawTrackerClaimComment } from "../claim.js";

const execFileAsync = promisify(execFile);

export type GhExec = (args: readonly string[]) => Promise<string>;

export interface GitHubTrackerAdapterOptions {
  readonly gh?: GhExec;
  readonly repo?: string;
}

interface GhIssueListRow {
  readonly number?: unknown;
  readonly body?: unknown;
  readonly labels?: unknown;
}

interface GhIssueViewRow {
  readonly state?: unknown;
  readonly number?: unknown;
  readonly title?: unknown;
  readonly url?: unknown;
  readonly comments?: unknown;
}

interface GhApiIssueCommentRow {
  readonly id?: unknown;
}

export function createGitHubTrackerAdapter(options: GitHubTrackerAdapterOptions = {}): TrackerPort {
  const gh = options.gh ?? defaultGhExec;
  const withRepo = (args: string[]): string[] =>
    options.repo ? [...args, "--repo", options.repo] : args;
  const postClaimComment = async (issue: number, body: string): Promise<number> => {
    const stdout = await gh(withRepo(["api", "repos/:owner/:repo/issues/" + String(issue) + "/comments", "-f", `body=${body}`]));
    const row = parseJson<GhApiIssueCommentRow>(stdout);
    if (typeof row.id !== "number") {
      throw new Error("GitHub claim comment response did not include a numeric id");
    }
    return row.id;
  };

  return {
    async listOpenIssuesByLabel(label) {
      const stdout = await gh(
        withRepo([
          "issue",
          "list",
          "--state",
          "open",
          "--label",
          label,
          "--json",
          "number,body,labels",
          "--limit",
          "1000",
        ]),
      );
      return parseIssueList(stdout);
    },
    async isIssueClosed(issue) {
      const stdout = await gh(withRepo(["issue", "view", String(issue), "--json", "state"]));
      const row = parseJson<GhIssueViewRow>(stdout);
      return row.state === "CLOSED";
    },
    async editIssueLabels(issue, mutation) {
      const args = ["issue", "edit", String(issue)];
      appendLabelArgs(args, "--remove-label", mutation.remove);
      appendLabelArgs(args, "--add-label", mutation.add);
      await gh(withRepo(args));
    },
    async commentOnIssue(issue, body) {
      await gh(withRepo(["issue", "comment", String(issue), "--body", body]));
    },
    async issueReference(issue) {
      const stdout = await gh(withRepo(["issue", "view", String(issue), "--json", "number,title,url"]));
      const row = parseJson<GhIssueViewRow>(stdout);
      const number = typeof row.number === "number" ? row.number : issue;
      return {
        number,
        title: typeof row.title === "string" ? row.title : undefined,
        url: typeof row.url === "string" ? row.url : undefined,
      } satisfies TrackerIssueReference;
    },
    async postIssueClaim(issue, body) {
      return postClaimComment(issue, body);
    },
    async listIssueClaims(issue) {
      const stdout = await gh(withRepo(["issue", "view", String(issue), "--json", "comments"]));
      const row = parseJson<GhIssueViewRow>(stdout);
      return parseTrackerClaimRecords(parseRawClaimComments(row.comments));
    },
    async concedeIssueClaim(issue, body) {
      await postClaimComment(issue, body);
    },
  };
}

async function defaultGhExec(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args as string[], { encoding: "utf8" });
  return stdout;
}

function appendLabelArgs(args: string[], flag: string, labels: readonly string[]): void {
  if (labels.length === 0) return;
  args.push(flag, labels.join(","));
}

function parseIssueList(stdout: string): TrackerIssue[] {
  const rows = parseJson<GhIssueListRow[]>(stdout);
  if (!Array.isArray(rows)) return [];
  const issues: TrackerIssue[] = [];
  for (const row of rows) {
    if (typeof row.number !== "number") continue;
    issues.push({
      number: row.number,
      body: typeof row.body === "string" ? row.body : "",
      labels: parseLabels(row.labels),
    });
  }
  return issues;
}

function parseLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      labels.push(item);
      continue;
    }
    if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
      labels.push(item.name);
    }
  }
  return labels;
}

function parseRawClaimComments(value: unknown): RawTrackerClaimComment[] {
  if (!Array.isArray(value)) return [];
  const comments: RawTrackerClaimComment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; body?: unknown; createdAt?: unknown };
    if (typeof row.id !== "number" || typeof row.body !== "string") continue;
    comments.push({
      id: row.id,
      body: row.body,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    });
  }
  return comments;
}

function parseJson<T>(stdout: string): T {
  const text = stdout.trim();
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}
