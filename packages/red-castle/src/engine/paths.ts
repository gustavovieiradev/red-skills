import { resolve } from "node:path";

export const CASTLE_WORKTREE_LANES = [
  "manual",
  "feedback",
  "landing",
  "rebase",
  "cascade",
  "adopt",
  "reconcile",
  "docs",
] as const;

export type CastleWorktreeLane = (typeof CASTLE_WORKTREE_LANES)[number];

export interface EnginePaths {
  readonly redRoot: string;
  readonly stateRoot: string;
  readonly castleStateRoot: string;
  readonly castleHistory: string;
  readonly castleValidation: string;
  readonly tmpRoot: string;
  readonly supervisorsRoot: string;
  readonly supervisor: (id: string) => string;
  readonly supervisorLog: (id: string) => string;
  readonly supervisorState: (id: string) => string;
  readonly workersRoot: string;
  readonly worker: (workerId: string) => string;
  readonly workerLog: (workerId: string) => string;
  readonly workerLiveness: (workerId: string) => string;
  readonly workerState: (workerId: string) => string;
  readonly monitorsRoot: string;
  readonly monitor: (id: string) => string;
  readonly monitorLog: (id: string) => string;
  readonly worktreesRoot: string;
  readonly workerWorktreesRoot: string;
  readonly workerWorktree: (
    workerId: string,
    ticketId: number | string,
  ) => string;
  readonly worktreeLane: (lane: CastleWorktreeLane) => string;
}

export function createEnginePaths(redRoot: string): EnginePaths {
  const root = resolve(redRoot);
  const stateRoot = resolve(root, "state");
  const castleStateRoot = resolve(stateRoot, "castle");
  const tmpRoot = resolve(root, "tmp");
  const supervisorsRoot = resolve(tmpRoot, "supervisors");
  const workersRoot = resolve(tmpRoot, "workers");
  const monitorsRoot = resolve(tmpRoot, "monitors");
  const worktreesRoot = resolve(tmpRoot, "worktrees");
  const workerWorktreesRoot = resolve(worktreesRoot, "workers");

  return {
    redRoot: root,
    stateRoot,
    castleStateRoot,
    castleHistory: resolve(castleStateRoot, "history.toonl"),
    castleValidation: resolve(castleStateRoot, "validation.toonl"),
    tmpRoot,
    supervisorsRoot,
    supervisor: (id) => resolve(supervisorsRoot, id),
    supervisorLog: (id) => resolve(supervisorsRoot, id, "supervisor.log.toonl"),
    supervisorState: (id) => resolve(supervisorsRoot, id, "state.toon"),
    workersRoot,
    worker: (workerId) => resolve(workersRoot, workerId),
    workerLog: (workerId) => resolve(workersRoot, workerId, "worker.log.toonl"),
    workerLiveness: (workerId) =>
      resolve(workersRoot, workerId, "liveness.toonl"),
    workerState: (workerId) => resolve(workersRoot, workerId, "state.toon"),
    monitorsRoot,
    monitor: (id) => resolve(monitorsRoot, id),
    monitorLog: (id) => resolve(monitorsRoot, id, "monitor.log.toonl"),
    worktreesRoot,
    workerWorktreesRoot,
    workerWorktree: (workerId, ticketId) =>
      resolve(workerWorktreesRoot, `${workerId}-${ticketId}`),
    worktreeLane: (lane) => resolve(worktreesRoot, lane),
  };
}
