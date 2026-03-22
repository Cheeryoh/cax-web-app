"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CandidateResult {
  candidate: {
    id: number;
    username: string;
    display_name: string;
    created_at: string;
  };
  totalAttempts: number;
  latestAttempt: {
    attempt: {
      id: number;
      exam_id: string | null;
      status: string;
      started_at: string;
      completed_at: string | null;
      human_reviewed: number;
      final_result: string | null;
    };
    mcScore: { correct: number; total: number };
    labResults: { task_id: string; passed: number; details_json?: string }[];
    fluencyScore: {
      delegation: number | null;
      description: number | null;
      discernment: number | null;
      diligence: number | null;
      raw_analysis: string | null;
    } | null;
    adminReviews: unknown[];
    passed: boolean;
  } | null;
}

interface TaskEvaluation {
  id: number;
  attempt_id: number;
  task_id: string;
  dimension: string;
  llm_score: number | null;
  llm_justification: string | null;
  status: string;
  final_score: number | null;
  created_at: string;
  updated_at: string;
}

interface DialogueEntry {
  id: number;
  task_evaluation_id: number;
  round: number;
  actor: "llm" | "admin";
  score: number;
  reasoning: string;
  score_changed: boolean | null;
  created_at: string;
}

interface ToolEvent {
  id: number;
  tool_name: string | null;
  tool_input: string | null;
  timestamp: string;
}

interface FinalizeResult {
  canFinalize: boolean;
  result?: "pass" | "fail";
  scores?: Record<string, number>;
  pendingItems: Array<{ taskId: string; dimension: string; status: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type DimensionKey = "delegation" | "description" | "discernment" | "diligence";
const DIMENSIONS: DimensionKey[] = ["delegation", "description", "discernment", "diligence"];

const TASK_IDS = ["task1_jquery", "task2_analytics", "task3_branding"] as const;
const TASK_NAMES: Record<string, string> = {
  task1_jquery: "jQuery Vulnerability Fix",
  task2_analytics: "Dead Analytics Removal",
  task3_branding: "Brand Color Consistency",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  llm_scored: "LLM Scored",
  admin_reviewed: "Under Review",
  confirmed: "Confirmed",
  resolved: "Resolved",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminDashboard() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const admin = user?.role === "admin" ? user : null;

  // Candidate list
  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Per-task evaluation data (loaded on expand)
  const [taskEvals, setTaskEvals] = useState<TaskEvaluation[]>([]);
  const [dialogue, setDialogue] = useState<DialogueEntry[]>([]);
  const [taskEvents, setTaskEvents] = useState<Record<string, ToolEvent[]>>({});
  const [activeTask, setActiveTask] = useState<string>("task1_jquery");
  const [showEvents, setShowEvents] = useState(false);

  // Admin context inputs (keyed by task_evaluation.id)
  const [contextInputs, setContextInputs] = useState<Record<number, string>>({});

  // Loading states
  const [evalLoading, setEvalLoading] = useState<Record<number, boolean>>({});
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);

  // ---------------------------------------------------------------------------
  // Data Loading
  // ---------------------------------------------------------------------------

  const loadCandidates = useCallback(async () => {
    const res = await fetch("/api/admin");
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.candidates ?? []);
    }
  }, []);

  useEffect(() => {
    if (!loading && admin) {
      loadCandidates().catch(() => {});
    }
  }, [loading, admin, loadCandidates]);

  async function loadTaskEvaluations(attemptId: number) {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_task_evaluations", attemptId }),
    });
    if (res.ok) {
      const data = await res.json();
      setTaskEvals(data.evaluations ?? []);
      setDialogue(data.dialogue ?? []);
    }
  }

  async function loadTaskEvents(attemptId: number, taskId: string) {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_task_events", attemptId, taskId }),
    });
    if (res.ok) {
      const data = await res.json();
      setTaskEvents((prev) => ({ ...prev, [taskId]: data.events ?? [] }));
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function triggerEvaluation(attemptId: number) {
    setEvalLoading((prev) => ({ ...prev, [attemptId]: true }));
    try {
      await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      });
      await loadCandidates();
      await loadTaskEvaluations(attemptId);
    } catch {
      // ignore
    } finally {
      setEvalLoading((prev) => ({ ...prev, [attemptId]: false }));
    }
  }

  async function confirmScore(evalId: number, attemptId: number) {
    setActionLoading((prev) => ({ ...prev, [evalId]: true }));
    try {
      await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_task_review",
          taskEvaluationId: evalId,
          reviewAction: "confirm",
          comment: "Confirmed LLM assessment",
        }),
      });
      await loadTaskEvaluations(attemptId);
      await loadCandidates();
    } finally {
      setActionLoading((prev) => ({ ...prev, [evalId]: false }));
    }
  }

  async function provideContext(evalId: number, attemptId: number) {
    const comment = contextInputs[evalId];
    if (!comment?.trim()) return;
    setActionLoading((prev) => ({ ...prev, [evalId]: true }));
    try {
      await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_task_review",
          taskEvaluationId: evalId,
          reviewAction: "provide_context",
          comment: comment.trim(),
        }),
      });
      setContextInputs((prev) => ({ ...prev, [evalId]: "" }));
      await loadTaskEvaluations(attemptId);
      await loadCandidates();
    } finally {
      setActionLoading((prev) => ({ ...prev, [evalId]: false }));
    }
  }

  async function finalizeAttempt(attemptId: number) {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_finalization", attemptId }),
    });
    if (res.ok) {
      const data = (await res.json()) as FinalizeResult;
      setFinalizeResult(data);
      if (data.canFinalize) {
        await loadCandidates();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Expand handler
  // ---------------------------------------------------------------------------

  function handleRowClick(c: CandidateResult) {
    const candidateId = c.candidate.id;
    if (expandedId === candidateId) {
      setExpandedId(null);
      setTaskEvals([]);
      setDialogue([]);
      setTaskEvents({});
      setFinalizeResult(null);
    } else {
      setExpandedId(candidateId);
      setActiveTask("task1_jquery");
      setFinalizeResult(null);
      if (c.latestAttempt) {
        loadTaskEvaluations(c.latestAttempt.attempt.id).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getEvalsForTask(taskId: string): TaskEvaluation[] {
    return taskEvals.filter((e) => e.task_id === taskId);
  }

  function getDialogueForEval(evalId: number): DialogueEntry[] {
    return dialogue
      .filter((d) => d.task_evaluation_id === evalId)
      .sort((a, b) => a.round - b.round);
  }

  function convergenceProgress(): { resolved: number; total: number } {
    const resolved = taskEvals.filter(
      (e) => e.status === "confirmed" || e.status === "resolved"
    ).length;
    return { resolved, total: taskEvals.length || 12 };
  }

  function truncateJson(jsonStr: string | null, maxLen: number = 120): string {
    if (!jsonStr) return "—";
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      // Show command for Bash, file_path for Read, pattern for Grep/Glob
      const summary =
        parsed.command ?? parsed.file_path ?? parsed.pattern ?? parsed.content;
      if (typeof summary === "string") {
        return summary.length > maxLen
          ? summary.substring(0, maxLen) + "..."
          : summary;
      }
      const str = JSON.stringify(parsed);
      return str.length > maxLen ? str.substring(0, maxLen) + "..." : str;
    } catch {
      return jsonStr.length > maxLen
        ? jsonStr.substring(0, maxLen) + "..."
        : jsonStr;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </main>
    );
  }

  if (!admin) {
    router.push("/");
    return null;
  }

  return (
    <main
      className="flex-1 max-w-7xl mx-auto px-4 py-12"
      data-testid="admin-dashboard"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Candidate assessment results — defensible evaluation system
        </p>
      </div>

      {candidates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No candidates yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Exam ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>MC</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead>4D Progress</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => {
                  const latest = c.latestAttempt;
                  const isExpanded = expandedId === c.candidate.id;
                  const humanReviewed =
                    latest?.attempt.human_reviewed === 1;
                  const progress = isExpanded
                    ? convergenceProgress()
                    : null;

                  return (
                    <>
                      <TableRow
                        key={c.candidate.id}
                        data-testid={`candidate-row-${c.candidate.id}`}
                        className="cursor-pointer"
                        onClick={() => handleRowClick(c)}
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {c.candidate.display_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {c.candidate.username}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {latest?.attempt.exam_id ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {latest?.attempt.status ?? "None"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {latest
                            ? `${latest.mcScore.correct}/${latest.mcScore.total}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {latest
                            ? `${latest.labResults.filter((r) => r.passed).length}/${latest.labResults.length}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {isExpanded && progress
                            ? `${progress.resolved}/${progress.total}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {latest ? (
                            humanReviewed ? (
                              <Badge
                                variant={
                                  latest.attempt.final_result === "pass"
                                    ? "default"
                                    : "destructive"
                                }
                              >
                                {latest.attempt.final_result?.toUpperCase() ??
                                  "PENDING"}
                              </Badge>
                            ) : (
                              <Badge variant="outline">PENDING</Badge>
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Expanded Review Panel */}
                      {isExpanded && latest && (
                        <TableRow key={`expanded-${c.candidate.id}`}>
                          <TableCell colSpan={7} className="p-0">
                            <div
                              data-testid={`review-panel-${c.candidate.id}`}
                              className="bg-muted/30 border-t p-6 w-full overflow-hidden"
                            >
                              {/* Header */}
                              <div className="flex items-center justify-between mb-6">
                                <div>
                                  <h3 className="font-semibold text-lg">
                                    {c.candidate.display_name}
                                  </h3>
                                  <p className="text-sm text-muted-foreground">
                                    {latest.attempt.exam_id} | MC:{" "}
                                    {latest.mcScore.correct}/
                                    {latest.mcScore.total} | Lab:{" "}
                                    {
                                      latest.labResults.filter(
                                        (r) => r.passed
                                      ).length
                                    }
                                    /{latest.labResults.length} |{" "}
                                    {convergenceProgress().resolved}/
                                    {convergenceProgress().total} dimensions
                                    resolved
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  {(latest.attempt.status === "submitted" ||
                                    latest.attempt.status ===
                                      "evaluated") && (
                                    <button
                                      type="button"
                                      className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted"
                                      data-testid="run-evaluation-btn"
                                      disabled={
                                        evalLoading[latest.attempt.id] ??
                                        false
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        triggerEvaluation(
                                          latest.attempt.id
                                        );
                                      }}
                                    >
                                      {evalLoading[latest.attempt.id]
                                        ? "Evaluating..."
                                        : taskEvals.length > 0
                                          ? "Re-Evaluate"
                                          : "Run Evaluation"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                    disabled={
                                      convergenceProgress().resolved <
                                      convergenceProgress().total
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      finalizeAttempt(latest.attempt.id);
                                    }}
                                  >
                                    Finalize
                                  </button>
                                </div>
                              </div>

                              {/* Finalization result */}
                              {finalizeResult && (
                                <div
                                  className={`mb-4 p-3 rounded-md text-sm ${finalizeResult.canFinalize ? (finalizeResult.result === "pass" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200") : "bg-yellow-50 text-yellow-800 border border-yellow-200"}`}
                                >
                                  {finalizeResult.canFinalize ? (
                                    <p>
                                      Result:{" "}
                                      <strong>
                                        {finalizeResult.result?.toUpperCase()}
                                      </strong>
                                      {finalizeResult.scores && (
                                        <span className="ml-2">
                                          (
                                          {Object.entries(
                                            finalizeResult.scores
                                          )
                                            .map(
                                              ([k, v]) =>
                                                `${k}: ${(v as number).toFixed(1)}`
                                            )
                                            .join(", ")}
                                          )
                                        </span>
                                      )}
                                    </p>
                                  ) : (
                                    <p>
                                      Cannot finalize —{" "}
                                      {finalizeResult.pendingItems.length}{" "}
                                      dimensions still pending
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Task Tabs */}
                              <div className="flex gap-1 mb-4 border-b">
                                {TASK_IDS.map((taskId) => {
                                  const labResult =
                                    latest.labResults.find(
                                      (r) => r.task_id === taskId
                                    );
                                  const taskEvalsForTask =
                                    getEvalsForTask(taskId);
                                  const allResolved =
                                    taskEvalsForTask.length > 0 &&
                                    taskEvalsForTask.every(
                                      (e) =>
                                        e.status === "confirmed" ||
                                        e.status === "resolved"
                                    );
                                  return (
                                    <button
                                      key={taskId}
                                      type="button"
                                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTask === taskId ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveTask(taskId);
                                        setShowEvents(false);
                                        if (
                                          !taskEvents[taskId] &&
                                          latest
                                        ) {
                                          loadTaskEvents(
                                            latest.attempt.id,
                                            taskId
                                          ).catch(() => {});
                                        }
                                      }}
                                    >
                                      {TASK_NAMES[taskId]}
                                      <span className="ml-1.5">
                                        {labResult?.passed ? (
                                          <Badge
                                            variant="default"
                                            className="text-[10px] px-1 py-0"
                                          >
                                            PASS
                                          </Badge>
                                        ) : (
                                          <Badge
                                            variant="destructive"
                                            className="text-[10px] px-1 py-0"
                                          >
                                            FAIL
                                          </Badge>
                                        )}
                                      </span>
                                      {allResolved && (
                                        <span className="ml-1 text-green-600">
                                          &#10003;
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Active Task Content */}
                              {(() => {
                                const evalsForTask =
                                  getEvalsForTask(activeTask);
                                const events =
                                  taskEvents[activeTask] ?? [];

                                return (
                                  <div>
                                    {/* Tool Usage (collapsible) */}
                                    <button
                                      type="button"
                                      className="text-xs text-blue-600 hover:underline mb-3"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowEvents(!showEvents);
                                        if (
                                          !taskEvents[activeTask] &&
                                          latest
                                        ) {
                                          loadTaskEvents(
                                            latest.attempt.id,
                                            activeTask
                                          ).catch(() => {});
                                        }
                                      }}
                                    >
                                      {showEvents
                                        ? "Hide tool usage"
                                        : `Show tool usage (${events.length} events)`}
                                    </button>

                                    {showEvents && events.length > 0 && (
                                      <div className="mb-4 max-h-48 overflow-y-auto border rounded-md bg-background p-3">
                                        {events.map((evt) => (
                                          <div
                                            key={evt.id}
                                            className="text-xs font-mono py-1 border-b last:border-0"
                                          >
                                            <span className="text-muted-foreground">
                                              {new Date(
                                                evt.timestamp
                                              ).toLocaleTimeString()}
                                            </span>{" "}
                                            <span className="font-semibold">
                                              {evt.tool_name ?? "unknown"}
                                            </span>{" "}
                                            <span className="text-muted-foreground">
                                              {truncateJson(
                                                evt.tool_input
                                              )}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* 4D Dimension Cards */}
                                    {evalsForTask.length === 0 ? (
                                      <p className="text-sm text-muted-foreground py-4">
                                        No evaluations yet. Click
                                        &quot;Run Evaluation&quot; to
                                        generate 4D scores.
                                      </p>
                                    ) : (
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {DIMENSIONS.map((dim) => {
                                          const evalItem =
                                            evalsForTask.find(
                                              (e) => e.dimension === dim
                                            );
                                          if (!evalItem) return null;

                                          const evalDialogue =
                                            getDialogueForEval(
                                              evalItem.id
                                            );
                                          const isActionLoading =
                                            actionLoading[evalItem.id] ??
                                            false;
                                          const contextValue =
                                            contextInputs[evalItem.id] ??
                                            "";
                                          const isResolved =
                                            evalItem.status ===
                                              "confirmed" ||
                                            evalItem.status ===
                                              "resolved";

                                          return (
                                            <div
                                              key={dim}
                                              data-testid={`dimension-${activeTask}-${dim}`}
                                              className="bg-background rounded-lg border p-4 flex flex-col gap-3 min-w-0"
                                            >
                                              {/* Header */}
                                              <div className="flex items-center justify-between">
                                                <p className="font-bold font-serif capitalize text-sm">
                                                  {dim}
                                                </p>
                                                <Badge
                                                  variant={
                                                    isResolved
                                                      ? "default"
                                                      : "outline"
                                                  }
                                                  className="text-[10px]"
                                                >
                                                  {STATUS_LABELS[
                                                    evalItem.status
                                                  ] ?? evalItem.status}
                                                </Badge>
                                              </div>

                                              {/* LLM Score */}
                                              <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-bold">
                                                  {evalItem.final_score !=
                                                  null
                                                    ? evalItem.final_score.toFixed(
                                                        1
                                                      )
                                                    : evalItem.llm_score !=
                                                        null
                                                      ? evalItem.llm_score.toFixed(
                                                          1
                                                        )
                                                      : "—"}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                  / 5.0
                                                  {evalItem.final_score !=
                                                    null &&
                                                    evalItem.llm_score !=
                                                      null &&
                                                    evalItem.final_score !==
                                                      evalItem.llm_score && (
                                                      <span className="ml-1">
                                                        (was{" "}
                                                        {evalItem.llm_score.toFixed(
                                                          1
                                                        )}
                                                        )
                                                      </span>
                                                    )}
                                                </span>
                                              </div>

                                              {/* LLM Justification */}
                                              <p className="text-xs text-muted-foreground leading-relaxed break-words overflow-hidden">
                                                {evalItem.llm_justification ??
                                                  "No justification available"}
                                              </p>

                                              {/* Dialogue Thread */}
                                              {evalDialogue.length >
                                                1 && (
                                                <div className="border-t pt-2 mt-1">
                                                  <p className="text-xs font-semibold mb-1">
                                                    Dialogue
                                                  </p>
                                                  <div className="space-y-2 max-h-32 overflow-y-auto">
                                                    {evalDialogue
                                                      .slice(1)
                                                      .map((d) => (
                                                        <div
                                                          key={d.id}
                                                          className={`text-xs p-2 rounded ${d.actor === "admin" ? "bg-blue-50 border-l-2 border-blue-400" : "bg-gray-50 border-l-2 border-gray-400"}`}
                                                        >
                                                          <span className="font-semibold capitalize">
                                                            {d.actor}
                                                          </span>{" "}
                                                          <span className="text-muted-foreground">
                                                            (round{" "}
                                                            {d.round},
                                                            score:{" "}
                                                            {d.score.toFixed(
                                                              1
                                                            )}
                                                            )
                                                          </span>
                                                          <p className="mt-0.5 break-words">
                                                            {d.reasoning}
                                                          </p>
                                                        </div>
                                                      ))}
                                                  </div>
                                                </div>
                                              )}

                                              {/* Actions */}
                                              {!isResolved && (
                                                <div className="border-t pt-3 mt-1 flex flex-col gap-2">
                                                  {/* Confirm button */}
                                                  <button
                                                    type="button"
                                                    className="text-xs px-3 py-1.5 rounded-md border hover:bg-muted disabled:opacity-50"
                                                    disabled={
                                                      isActionLoading
                                                    }
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      confirmScore(
                                                        evalItem.id,
                                                        latest.attempt
                                                          .id
                                                      );
                                                    }}
                                                  >
                                                    {isActionLoading
                                                      ? "Processing..."
                                                      : "Confirm Score"}
                                                  </button>

                                                  {/* Provide context */}
                                                  <Textarea
                                                    placeholder="Provide context for re-evaluation..."
                                                    className="text-xs min-h-[60px]"
                                                    value={contextValue}
                                                    onClick={(e) =>
                                                      e.stopPropagation()
                                                    }
                                                    onChange={(e) =>
                                                      setContextInputs(
                                                        (prev) => ({
                                                          ...prev,
                                                          [evalItem.id]:
                                                            e.target
                                                              .value,
                                                        })
                                                      )
                                                    }
                                                  />
                                                  <button
                                                    type="button"
                                                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                                    disabled={
                                                      isActionLoading ||
                                                      !contextValue.trim()
                                                    }
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      provideContext(
                                                        evalItem.id,
                                                        latest.attempt
                                                          .id
                                                      );
                                                    }}
                                                  >
                                                    {isActionLoading
                                                      ? "Re-evaluating..."
                                                      : "Provide Context & Re-evaluate"}
                                                  </button>
                                                </div>
                                              )}

                                              {/* Resolved indicator */}
                                              {isResolved && (
                                                <p className="text-xs text-green-600 font-medium">
                                                  &#10003;{" "}
                                                  {evalItem.status ===
                                                  "confirmed"
                                                    ? "Score confirmed"
                                                    : "Resolved after re-evaluation"}
                                                </p>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
