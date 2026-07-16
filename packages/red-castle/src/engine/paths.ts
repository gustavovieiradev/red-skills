import { join } from "node:path";

export interface EngineEntityPaths {
  readonly root: string;
  readonly state: string;
  readonly lane: string;
}

export interface EngineWorkerPaths extends EngineEntityPaths {
  readonly liveness: string;
}

export interface EnginePaths {
  readonly redRoot: string;
  readonly config: string;
  readonly stateRoot: string;
  readonly history: string;
  readonly tmpRoot: string;
  readonly supervisorsRoot: string;
  readonly workersRoot: string;
  readonly monitorsRoot: string;
  readonly worktreesRoot: string;
  readonly workerWorktreesRoot: string;
  readonly supervisor: (id: string) => EngineEntityPaths;
  readonly worker: (workerId: string) => EngineWorkerPaths;
  readonly monitor: (id: string) => EngineEntityPaths;
  readonly workerWorktree: (workerId: string, ticket: number | string) => string;
}

export function createEnginePaths(redRoot: string): EnginePaths {
  const stateRoot = join(redRoot, "state", "castle");
  const tmpRoot = join(redRoot, "tmp");
  const supervisorsRoot = join(tmpRoot, "supervisors");
  const workersRoot = join(tmpRoot, "workers");
  const monitorsRoot = join(tmpRoot, "monitors");
  const worktreesRoot = join(tmpRoot, "worktrees");
  const workerWorktreesRoot = join(worktreesRoot, "workers");

  return {
    redRoot,
    config: join(redRoot, "config.yaml"),
    stateRoot,
    history: join(stateRoot, "history.toonl"),
    tmpRoot,
    supervisorsRoot,
    workersRoot,
    monitorsRoot,
    worktreesRoot,
    workerWorktreesRoot,
    supervisor: (id) => {
      const root = join(supervisorsRoot, id);
      return {
        root,
        state: join(root, "state.toon"),
        lane: join(root, "lane.toonl"),
      };
    },
    worker: (workerId) => {
      const root = join(workersRoot, workerId);
      return {
        root,
        state: join(root, "state.toon"),
        lane: join(root, "worker.log.toonl"),
        liveness: join(root, "liveness.toonl"),
      };
    },
    monitor: (id) => {
      const root = join(monitorsRoot, id);
      return {
        root,
        state: join(root, "state.toon"),
        lane: join(root, "lane.toonl"),
      };
    },
    workerWorktree: (workerId, ticket) =>
      join(workerWorktreesRoot, `${workerId}-${ticket}`),
  };
}
