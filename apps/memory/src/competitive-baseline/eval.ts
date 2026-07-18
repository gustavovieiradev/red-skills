import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { buildMemoryAgentIntegrationStatus } from "../agent-integration-status.js";
import { buildMemoryCapabilityCatalog } from "../capability-catalog.js";
import { buildContextPack } from "../context-pack.js";
import { buildDocCoverageReport } from "../doc-coverage.js";
import { competitiveEvalFixture, type CompetitiveEvalFixture } from "../competitive-fixtures.js";
import { recall } from "../engine.js";
import { MemoryStore } from "../graph-store.js";
import { HistoricalMemoryStore } from "../historical-memory-store.js";
import { initGraph } from "../init.js";
import { lintMemoryRecords, type LintMemoryRecord } from "../lint.js";
import { appendMemoryEvent, parseMemoryEvent } from "../memory-events.js";
import {
  buildMemoryOperationalDashboard,
  buildMemoryOperationalDashboardArtifact,
} from "../operational-dashboard.js";
import { buildReadinessEnvelope } from "../readiness.js";
import { buildMemoryRoutingGuide, SUPPORTED_ROUTING_AGENTS } from "../routing-guide.js";
import type { EdgeLabel } from "../schema.js";
import { classifyCandidateMemory } from "../store-classifier.js";
import { commitMemoryGraph } from "../vcs-commit.js";
import { FixtureRecallStore, mean, p50, rawCorpusChars, roundMetric } from "./shared.js";
import type {
  CompetitiveEvalContextPackCase,
  CompetitiveEvalOptions,
  CompetitiveEvalPolicyCase,
  CompetitiveEvalRecallCase,
  CompetitiveEvalReport,
  FoundationEvidenceGateReport,
  FoundationGateAxis,
} from "./types.js";

const FOUNDATION_GATE_GOAL = "Memory README moat claims backed by executable eval output";

interface FoundationGateOptions {
  now: number;
}

async function evaluateFoundationEvidenceGate(
  fixture: CompetitiveEvalFixture,
  opts: FoundationGateOptions,
): Promise<FoundationEvidenceGateReport> {
  const root = await mkdtemp(join(tmpdir(), "memory-foundation-gate-"));
  try {
    const init = await initGraph(root, {
      project: "competitive-gate",
      hooks: true,
      skillTelemetry: true,
    });
    await seedAgentRoutingFiles(root);
    const store = await MemoryStore.open({ uri: init.storeUri, project: "competitive-gate" });
    let envelope: Awaited<ReturnType<typeof buildReadinessEnvelope>>;
    let vector = await store.vectorStatus();
    let hybridRecall: FoundationEvidenceGateReport["retrieval"]["hybridRecall"];
    let operatorSurface!: FoundationEvidenceGateReport["operatorSurface"];
    let multiAgentIntegration!: FoundationEvidenceGateReport["multiAgentIntegration"];
    try {
      const ridMap = await seedFoundationEvidence(store, fixture, opts.now);
      await seedFoundationDocCoverage(store, root, ridMap, fixture, opts.now);
      vector = await store.vectorStatus();

      const recallCases: CompetitiveEvalRecallCase[] = [];
      for (const item of fixture.recall) {
        const result = await recall(store, item.query, { k: item.k, depth: 1, now: opts.now });
        const returnedRids = result.nodes.slice(0, item.k).map((node) => node.rid);
        const expected = new Set(item.expectedRids.map((rid) => mappedRid(ridMap, rid)));
        const hits = returnedRids.filter((rid) => expected.has(rid));
        const firstExpectedIndex = returnedRids.findIndex((rid) => expected.has(rid));
        recallCases.push({
          id: item.id,
          query: item.query,
          expectedRids: [...expected],
          returnedRids,
          recallAtK: roundMetric(hits.length / item.expectedRids.length),
          precisionAtK: roundMetric(hits.length / item.k),
          reciprocalRank: firstExpectedIndex >= 0 ? roundMetric(1 / (firstExpectedIndex + 1)) : 0,
          latencyMs: 0,
        });
      }

      const vectorDiagnostics = await recall(store, fixture.recall[0]?.query ?? fixture.name, {
        k: fixture.recall[0]?.k ?? 3,
        depth: 1,
        now: opts.now,
      });
      hybridRecall = {
        queryCount: recallCases.length,
        meanRecallAtK: roundMetric(mean(recallCases.map((item) => item.recallAtK))),
        vector: {
          ...vectorDiagnostics.diagnostics.vector,
          projectionOverall: vector.overall,
          projectionTotal: vector.total,
        },
      };

      envelope = await buildReadinessEnvelope(store, FOUNDATION_GATE_GOAL, {
        now: opts.now,
        minEvidence: 2,
      });
      operatorSurface = await evaluateOperatorSurface(store, root);
      multiAgentIntegration = await evaluateMultiAgentIntegration(root, opts.now);
    } finally {
      await store.close();
    }

    const committed = await commitMemoryGraph(root, init.config, {
      message: "foundation evidence gate",
      author: "RedSkills Memory",
      email: "memory@reddb.io",
    });
    const asOfRecall = await probeAsOfRecall(init.storeUri, committed.commit?.hash, fixture, opts.now);

    const axes = foundationAxes({
      hybridRecall,
      asOfRecall,
      envelope,
      operatorSurface,
      multiAgentIntegration,
    });
    const score = axes.reduce((sum, axis) => sum + axis.score, 0);
    const maxScore = axes.reduce((sum, axis) => sum + axis.maxScore, 0);

    return {
      command: "pnpm --filter @reddb-io/benchmark-memory references:eval",
      evidenceBase: {
        name: fixture.name,
        source: fixture.source,
        nodes: fixture.nodes.length,
        edges: fixture.edges.length,
        redDbBacked: true,
      },
      retrieval: {
        score: axes.find((axis) => axis.id === "retrieval")?.score ?? 0,
        maxScore: 1,
        hybridRecall,
        asOfRecall,
      },
      readiness: {
        score: axes.find((axis) => axis.id === "readiness")?.score ?? 0,
        maxScore: 1,
        status: envelope.status,
        contractVersion: envelope.contract.version,
        consumerTargets: [...envelope.contract.consumer_targets],
      },
      trustGovernance: {
        score: axes.find((axis) => axis.id === "trust-governance")?.score ?? 0,
        maxScore: 1,
        claimCheck: envelope.trust.claim_check.status,
        privacyFindings: envelope.trust.privacy.findings,
        vcsTimeTravel: envelope.vcs.time_travel,
        eventLog: {
          status: envelope.operations.event_log.status,
          totalEvents: envelope.operations.event_log.total_events,
          kinds: envelope.operations.event_log.kinds,
        },
      },
      skillEvolution: {
        score: axes.find((axis) => axis.id === "skill-evolution")?.score ?? 0,
        maxScore: 1,
        telemetryEvents: envelope.operations.event_log.kinds["skill.telemetry"] ?? 0,
        communities: {
          count: envelope.communities.communities,
          assignments: envelope.communities.assignments,
        },
      },
      operatorSurface,
      multiAgentIntegration,
      composite: {
        score,
        maxScore,
        status: score === maxScore ? "ready-foundation" : "review-foundation",
        axes,
      },
      agentmemoryLiveBaseline: {
        state: "adapter-ready",
        implemented: true,
        note:
          "Agentmemory and Neo4j Agent Memory live baseline adapters are available through opt-in references:eval:v2 flags; normal runs remain checked-in fixture only.",
      },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedFoundationEvidence(
  store: MemoryStore,
  fixture: CompetitiveEvalFixture,
  now: number,
): Promise<Map<number, number>> {
  const rids = new Map<number, number>();
  for (const node of fixture.nodes) {
    const rid = await store.upsertNode({
      label: node.label,
      node_type: node.node_type,
      properties: {
        ...node.properties,
        scope: node.properties.scope ?? "project",
        tier: node.properties.tier ?? "durable",
        created_at: now,
        updated_at: now,
        provenance: {
          source_kind: "system",
          writer: "references:eval",
          command: "foundation evidence gate",
          evidence: [`competitive-fixture:${fixture.name}:${node.rid}`],
        },
      },
    });
    rids.set(node.rid, rid);
  }

  for (const edge of fixture.edges) {
    const from = mappedRid(rids, Number(edge.from));
    const to = mappedRid(rids, Number(edge.to));
    const label = String(edge.label ?? "REFERENCES") as EdgeLabel;
    await store.upsertEdge({
      label,
      from_rid: from,
      to_rid: to,
      properties: {
        source: "competitive-fixture",
        created_at: now,
      },
    });
  }

  await appendMemoryEvent(
    store,
    parseMemoryEvent({
      id: "skill-event:foundation-gate",
      occurred_at: new Date(now).toISOString(),
      kind: "skill.telemetry",
      source: { kind: "hook", name: "memory event skill" },
      actor: { kind: "agent", id: "codex" },
      scope: { level: "project", id: fixture.name },
      subject: { kind: "skill", id: "plugin:memory:eval-references" },
      payload: {
        event_type: "result",
        event_id: "foundation-gate",
        timestamp: new Date(now).toISOString(),
        session_id: "foundation-gate",
        turn_id: "reference-eval",
        name: "memory:eval-references",
        source_kind: "plugin",
        path: "plugins/memory/src/competitive-baseline.ts",
        runner: "codex",
        result: { status: "succeeded", duration_ms: 1 },
      },
      provenance: {
        source_kind: "system",
        writer: "references:eval",
        command: "foundation evidence gate",
        evidence: [`fixture:${fixture.name}`],
      },
    }),
  );

  return rids;
}

async function seedFoundationDocCoverage(
  store: MemoryStore,
  root: string,
  rids: Map<number, number>,
  fixture: CompetitiveEvalFixture,
  now: number,
): Promise<void> {
  const docHash = `competitive-doc:${fixture.name}`;
  const docPath = join(root, "docs", "competitive-memory.md");
  const docRid = await store.upsertDoc({
    path: docPath,
    title: "Competitive Memory Evidence",
    body:
      "Competitive Memory Evidence links README claims, hook coverage, doc coverage, vector diagnostics, and the operational dashboard.",
    frontmatter: { tags: ["competitive", "memory", "dashboard"] },
    hash: docHash,
    updated_at: now,
  });
  const rootRid = await store.upsertNode({
    label: `md:${docPath}`,
    node_type: "concept",
    properties: {
      title: "Competitive Memory Evidence",
      summary: "Documentation chunk for competitive operator-surface coverage.",
      source: docPath,
      confidence: "EXTRACTED",
      hash: docHash,
      created_at: now,
      updated_at: now,
      provenance: {
        source_kind: "system",
        writer: "references:eval",
        command: "operator surface evidence",
        evidence: [`memory_docs:${docRid}`],
      },
    },
  });
  const target = mappedRid(rids, fixture.nodes[0]?.rid ?? 1);
  await store.upsertEdge({
    label: "REFERENCES",
    from_rid: rootRid,
    to_rid: target,
    properties: { source: "competitive-fixture", created_at: now },
  });
}

async function evaluateOperatorSurface(
  store: MemoryStore,
  root: string,
): Promise<FoundationEvidenceGateReport["operatorSurface"]> {
  const [docCoverage, dashboard, capabilityCatalog] = await Promise.all([
    buildDocCoverageReport(store),
    buildMemoryOperationalDashboard(store, root),
    buildMemoryCapabilityCatalog(store, root),
  ]);
  const artifact = buildMemoryOperationalDashboardArtifact(dashboard);
  const hookCoverage = dashboard.sources.hook_coverage;
  const pass =
    docCoverage.total_docs > 0 &&
    docCoverage.grounded_docs === docCoverage.total_docs &&
    docCoverage.docs_with_references > 0 &&
    hookCoverage.summary.wired_events >= 7 &&
    hookCoverage.summary.enabled_events >= 7 &&
    artifact.contract.version === "memory.operational_dashboard.viewer.v1" &&
    artifact.contract.consumes === "memory.operational_dashboard.v1" &&
    artifact.html.includes('id="memory-dashboard-data"') &&
    capabilityCatalog.schema_version === "memory.capability_catalog.v1" &&
    capabilityCatalog.summary.total >= 9 &&
    capabilityCatalog.categories.length >= 9 &&
    capabilityCatalog.summary.red_db_backed >= 8;

  return {
    score: pass ? 1 : 0,
    maxScore: 1,
    docCoverage: {
      totalDocs: docCoverage.total_docs,
      groundedDocs: docCoverage.grounded_docs,
      docsWithReferences: docCoverage.docs_with_references,
      vectorOverall: docCoverage.vector.overall,
    },
    hookCoverage: {
      enabledEvents: hookCoverage.summary.enabled_events,
      wiredEvents: hookCoverage.summary.wired_events,
      totalEvents: hookCoverage.summary.total_events,
      gaps: hookCoverage.gaps.length,
    },
    dashboard: {
      contractVersion: artifact.contract.version,
      consumes: artifact.contract.consumes,
      htmlBytes: Buffer.byteLength(artifact.html, "utf8"),
      state: dashboard.state,
    },
    capabilityCatalog: {
      total: capabilityCatalog.summary.total,
      categories: capabilityCatalog.categories.length,
      redDbBacked: capabilityCatalog.summary.red_db_backed,
      ready: capabilityCatalog.summary.ready,
      notConfigured: capabilityCatalog.summary.not_configured,
    },
  };
}

async function seedAgentRoutingFiles(root: string): Promise<void> {
  const snippetsByPath = new Map<string, string[]>();
  for (const agent of SUPPORTED_ROUTING_AGENTS) {
    const guide = buildMemoryRoutingGuide({ agent });
    for (const target of guide.targetFiles) {
      const snippets = snippetsByPath.get(target) ?? [];
      snippets.push(guide.installSnippet);
      snippetsByPath.set(target, snippets);
    }
  }

  await Promise.all(
    [...snippetsByPath.entries()].map(async ([target, snippets]) => {
      const path = join(root, target);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, snippets.join("\n"), "utf8");
    }),
  );
}

async function evaluateMultiAgentIntegration(
  root: string,
  now: number,
): Promise<FoundationEvidenceGateReport["multiAgentIntegration"]> {
  const status = await buildMemoryAgentIntegrationStatus(root, { now });
  const representativeGuide = buildMemoryRoutingGuide({ agent: "codex" });
  const hookCapableAgents = status.agents.filter((agent) => agent.hook_coverage != null);
  const hookReadyAgents = hookCapableAgents.filter(
    (agent) =>
      (agent.hook_coverage?.effective_events ?? 0) > 0 &&
      (agent.hook_coverage?.actionable_gaps ?? 1) === 0,
  );
  const pass =
    status.summary.agents === SUPPORTED_ROUTING_AGENTS.length &&
    status.summary.ready === SUPPORTED_ROUTING_AGENTS.length &&
    status.summary.missing === 0 &&
    representativeGuide.mcpTools.length >= 10 &&
    representativeGuide.cliFallbacks.length >= 10 &&
    hookCapableAgents.length >= 2 &&
    hookReadyAgents.length === hookCapableAgents.length;

  return {
    score: pass ? 1 : 0,
    maxScore: 1,
    supportedAgents: status.summary.agents,
    readyAgents: status.summary.ready,
    partialAgents: status.summary.partial,
    missingAgents: status.summary.missing,
    mcpTools: representativeGuide.mcpTools.length,
    cliFallbacks: representativeGuide.cliFallbacks.length,
    hookCapableAgents: hookCapableAgents.length,
    hookReadyAgents: hookReadyAgents.length,
    sources: {
      routingGuide: status.sources.routing_guide,
      integrationStatus: status.schema_version,
    },
  };
}

function mappedRid(rids: Map<number, number>, rid: number): number {
  return rids.get(rid) ?? rid;
}

async function probeAsOfRecall(
  uri: string,
  commit: string | undefined,
  fixture: CompetitiveEvalFixture,
  now: number,
): Promise<FoundationEvidenceGateReport["retrieval"]["asOfRecall"]> {
  if (!commit) {
    return {
      status: "unavailable",
      refKind: "commit",
      nodes: 0,
      recalled: 0,
      error: "foundation graph did not produce a commit hash",
    };
  }

  const historical = await HistoricalMemoryStore.open({ uri, ref: commit });
  try {
    const nodes = await historical.listNodes();
    const firstQuery = fixture.recall[0]?.query ?? fixture.name;
    const recalled = await recall(historical, firstQuery, { k: 3, depth: 1, now });
    return {
      status: nodes.length > 0 ? "available" : "unavailable",
      refKind: "commit",
      nodes: nodes.length,
      recalled: recalled.nodes.length,
    };
  } catch (err) {
    return {
      status: "unavailable",
      refKind: "commit",
      nodes: 0,
      recalled: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await historical.close();
  }
}

function foundationAxes(input: {
  hybridRecall: FoundationEvidenceGateReport["retrieval"]["hybridRecall"];
  asOfRecall: FoundationEvidenceGateReport["retrieval"]["asOfRecall"];
  envelope: Awaited<ReturnType<typeof buildReadinessEnvelope>>;
  operatorSurface: FoundationEvidenceGateReport["operatorSurface"];
  multiAgentIntegration: FoundationEvidenceGateReport["multiAgentIntegration"];
}): FoundationGateAxis[] {
  const retrievalPass =
    input.hybridRecall.queryCount > 0 &&
    input.hybridRecall.meanRecallAtK > 0 &&
    input.hybridRecall.vector.projectionTotal > 0 &&
    input.asOfRecall.status === "available";
  const readinessPass =
    input.envelope.contract.version === "memory.readiness.v1" &&
    input.envelope.contract.consumer_targets.includes("references:eval:v2");
  const trustPass =
    input.envelope.vcs.time_travel !== "unavailable" &&
    input.envelope.operations.event_log.total_events > 0 &&
    input.envelope.trust.privacy.read_only;
  const skillEvolutionPass =
    (input.envelope.operations.event_log.kinds["skill.telemetry"] ?? 0) > 0 &&
    input.envelope.communities.assignments > 0;
  const operatorSurfacePass = input.operatorSurface.score === input.operatorSurface.maxScore;
  const multiAgentIntegrationPass =
    input.multiAgentIntegration.score === input.multiAgentIntegration.maxScore;

  return [
    {
      id: "retrieval",
      score: retrievalPass ? 1 : 0,
      maxScore: 1,
      status: retrievalPass ? "pass" : "fail",
      detail: `hybrid recall=${input.hybridRecall.meanRecallAtK}, vector=${input.hybridRecall.vector.projectionOverall}, as_of=${input.asOfRecall.status}`,
    },
    {
      id: "readiness",
      score: readinessPass ? 1 : 0,
      maxScore: 1,
      status: readinessPass ? "pass" : "fail",
      detail: `${input.envelope.contract.version} status=${input.envelope.status}`,
    },
    {
      id: "trust-governance",
      score: trustPass ? 1 : 0,
      maxScore: 1,
      status: trustPass ? "pass" : "fail",
      detail: `vcs=${input.envelope.vcs.time_travel}, events=${input.envelope.operations.event_log.total_events}, privacy=${input.envelope.trust.privacy.findings}`,
    },
    {
      id: "skill-evolution",
      score: skillEvolutionPass ? 1 : 0,
      maxScore: 1,
      status: skillEvolutionPass ? "pass" : "fail",
      detail: `skill.telemetry=${input.envelope.operations.event_log.kinds["skill.telemetry"] ?? 0}, communities=${input.envelope.communities.communities}/${input.envelope.communities.assignments}`,
    },
    {
      id: "operator-surface",
      score: operatorSurfacePass ? 1 : 0,
      maxScore: 1,
      status: operatorSurfacePass ? "pass" : "fail",
      detail: `docs=${input.operatorSurface.docCoverage.groundedDocs}/${input.operatorSurface.docCoverage.totalDocs}, hooks=${input.operatorSurface.hookCoverage.enabledEvents}/${input.operatorSurface.hookCoverage.totalEvents}, dashboard=${input.operatorSurface.dashboard.contractVersion}, capabilities=${input.operatorSurface.capabilityCatalog.total}/${input.operatorSurface.capabilityCatalog.categories}`,
    },
    {
      id: "multi-agent-integration",
      score: multiAgentIntegrationPass ? 1 : 0,
      maxScore: 1,
      status: multiAgentIntegrationPass ? "pass" : "fail",
      detail: `agents=${input.multiAgentIntegration.readyAgents}/${input.multiAgentIntegration.supportedAgents}, mcp_tools=${input.multiAgentIntegration.mcpTools}, hooks=${input.multiAgentIntegration.hookReadyAgents}/${input.multiAgentIntegration.hookCapableAgents}`,
    },
  ];
}

export async function evaluateCompetitiveEval(
  opts: CompetitiveEvalOptions = {},
): Promise<CompetitiveEvalReport> {
  const fixture = opts.fixture ?? competitiveEvalFixture;
  const now = opts.now ?? Date.now();
  const store = new FixtureRecallStore(fixture);
  const recallCases: CompetitiveEvalRecallCase[] = [];

  for (const item of fixture.recall) {
    const start = performance.now();
    const result = await recall(store, item.query, { k: item.k, depth: 1, now });
    const latencyMs = performance.now() - start;
    const returnedRids = result.nodes.slice(0, item.k).map((node) => node.rid);
    const expected = new Set(item.expectedRids);
    const hits = returnedRids.filter((rid) => expected.has(rid));
    const firstExpectedIndex = returnedRids.findIndex((rid) => expected.has(rid));
    recallCases.push({
      id: item.id,
      query: item.query,
      expectedRids: item.expectedRids,
      returnedRids,
      recallAtK: roundMetric(hits.length / item.expectedRids.length),
      precisionAtK: roundMetric(hits.length / item.k),
      reciprocalRank: firstExpectedIndex >= 0 ? roundMetric(1 / (firstExpectedIndex + 1)) : 0,
      latencyMs: roundMetric(latencyMs),
    });
  }

  const rawChars = rawCorpusChars(fixture);
  const contextCases: CompetitiveEvalContextPackCase[] = [];
  for (const item of fixture.contextPacks) {
    const pack = await buildContextPack(store, item.goal, {
      budgetChars: item.budgetChars,
      now,
    });
    const reductionRatio = rawChars > 0 ? (rawChars - pack.usedChars) / rawChars : 0;
    contextCases.push({
      id: item.id,
      goal: item.goal,
      rawCorpusChars: rawChars,
      packChars: pack.usedChars,
      reductionRatio: roundMetric(reductionRatio),
      status: pack.status,
      omittedEntries: pack.omittedEntries,
    });
  }

  const policyCases: CompetitiveEvalPolicyCase[] = fixture.candidates.map((candidate) => {
    const actual = classifyCandidateMemory(candidate.text);
    const pass =
      actual.kind === candidate.expectedKind &&
      actual.recommendedTier === candidate.expectedTier &&
      actual.recommendedScope === candidate.expectedScope &&
      candidate.expectedWarnings.every((warning) => actual.safetyWarnings.includes(warning));
    return {
      id: candidate.id,
      expectedKind: candidate.expectedKind,
      actualKind: actual.kind,
      pass,
    };
  });

  const lintRecords: LintMemoryRecord[] = fixture.policyMemories.map((memory) => ({
    id: memory.id,
    location: `competitive-fixture:${memory.id}`,
    title: memory.title,
    body: memory.body,
    scope: memory.scope,
    tier: memory.tier,
    createdAt: memory.createdAt,
  }));
  const lintFindings = lintMemoryRecords(lintRecords, { now })
    .map((finding) => finding.code)
    .filter((code, index, codes) => codes.indexOf(code) === index)
    .sort();

  const unsupportedLiveCompetitorClaims = fixture.liveBaselines
    .filter((baseline) => !baseline.configured && baseline.assertedClaim)
    .map((baseline) => `${baseline.competitor}:${baseline.metric}`);
  const unmeasuredLiveBaselines = fixture.liveBaselines
    .filter((baseline) => !baseline.configured)
    .map((baseline) => `${baseline.competitor}:${baseline.metric}`);
  const foundationGate = await evaluateFoundationEvidenceGate(fixture, { now });

  return {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    fixture: {
      name: fixture.name,
      source: fixture.source,
      nodes: fixture.nodes.length,
      edges: fixture.edges.length,
    },
    recall: {
      queryCount: recallCases.length,
      meanRecallAtK: roundMetric(mean(recallCases.map((item) => item.recallAtK))),
      meanPrecisionAtK: roundMetric(mean(recallCases.map((item) => item.precisionAtK))),
      meanReciprocalRank: roundMetric(mean(recallCases.map((item) => item.reciprocalRank))),
      latency: {
        p50Ms: roundMetric(p50(recallCases.map((item) => item.latencyMs))),
        maxMs: roundMetric(Math.max(0, ...recallCases.map((item) => item.latencyMs))),
      },
      cases: recallCases,
    },
    contextPacks: {
      packCount: contextCases.length,
      meanReductionRatio: roundMetric(mean(contextCases.map((item) => item.reductionRatio))),
      cases: contextCases,
    },
    policy: {
      totalCandidates: policyCases.length,
      classificationAccuracy: roundMetric(
        policyCases.filter((item) => item.pass).length / Math.max(1, policyCases.length),
      ),
      cases: policyCases,
      lintCaseCount: lintRecords.length,
      lintFindings,
    },
    foundationGate,
    claimGuards: {
      unsupportedLiveCompetitorClaims,
      unmeasuredLiveBaselines,
    },
  };
}

export function renderCompetitiveEvalJson(report: CompetitiveEvalReport): string {
  return `${JSON.stringify(
    {
      generated_at: report.generatedAt,
      fixture: report.fixture,
      recall: report.recall,
      context_packs: report.contextPacks,
      policy: report.policy,
      foundation_gate: report.foundationGate,
      claim_guards: report.claimGuards,
    },
    null,
    2,
  )}\n`;
}

export function renderCompetitiveEvalHuman(report: CompetitiveEvalReport): string {
  const lines = [
    "# Memory reference eval",
    "",
    `Fixture: ${report.fixture.name} (${report.fixture.source}, ${report.fixture.nodes} nodes / ${report.fixture.edges} edges)`,
    "",
    "## Recall quality",
    `queries=${report.recall.queryCount} recall@k=${report.recall.meanRecallAtK} precision@k=${report.recall.meanPrecisionAtK} mrr=${report.recall.meanReciprocalRank} p50=${report.recall.latency.p50Ms}ms max=${report.recall.latency.maxMs}ms`,
    "",
    "## Context-pack size",
    `packs=${report.contextPacks.packCount} mean_reduction=${report.contextPacks.meanReductionRatio}`,
    "",
    "## Policy / extraction",
    `candidates=${report.policy.totalCandidates} classification_accuracy=${report.policy.classificationAccuracy} lint_findings=${report.policy.lintFindings.join(", ") || "none"}`,
    "",
    "## Foundation evidence gate",
    `composite=${report.foundationGate.composite.score}/${report.foundationGate.composite.maxScore} status=${report.foundationGate.composite.status}`,
    `retrieval=${report.foundationGate.retrieval.score}/${report.foundationGate.retrieval.maxScore} vector=${report.foundationGate.retrieval.hybridRecall.vector.projectionOverall} as_of=${report.foundationGate.retrieval.asOfRecall.status}`,
    `readiness=${report.foundationGate.readiness.status} contract=${report.foundationGate.readiness.contractVersion}`,
    `trust-governance=${report.foundationGate.trustGovernance.score}/${report.foundationGate.trustGovernance.maxScore} events=${report.foundationGate.trustGovernance.eventLog.totalEvents} vcs=${report.foundationGate.trustGovernance.vcsTimeTravel}`,
    `skill-evolution=${report.foundationGate.skillEvolution.score}/${report.foundationGate.skillEvolution.maxScore} telemetry=${report.foundationGate.skillEvolution.telemetryEvents} communities=${report.foundationGate.skillEvolution.communities.count}/${report.foundationGate.skillEvolution.communities.assignments}`,
    "Agentmemory live baseline: adapter ready; pass --live-agentmemory to references:eval:v2 for opt-in live CLI measurement.",
    "Neo4j Agent Memory live baseline: adapter ready; pass --live-agent-memory to references:eval:v2 for opt-in live CLI measurement.",
    "",
    "## Claim guards",
  ];

  if (report.claimGuards.unsupportedLiveCompetitorClaims.length === 0) {
    lines.push("No live reference claims were asserted without a configured live baseline.");
  } else {
    lines.push(
      `Unsupported live reference claims: ${report.claimGuards.unsupportedLiveCompetitorClaims.join(", ")}`,
    );
  }
  if (report.claimGuards.unmeasuredLiveBaselines.length > 0) {
    lines.push(`Unmeasured live baselines: ${report.claimGuards.unmeasuredLiveBaselines.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
