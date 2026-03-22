"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface AdminReview {
  dimension: string;
  original_score: number;
  adjusted_score: number;
  weight: number;
  comment: string | null;
}

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
      status: string;
      started_at: string;
      completed_at: string | null;
      human_reviewed: number;
      final_result: string | null;
    };
    mcScore: { correct: number; total: number };
    labResults: { task_id: string; passed: number }[];
    fluencyScore: {
      delegation: number | null;
      description: number | null;
      discernment: number | null;
      diligence: number | null;
      raw_analysis: string | null;
    } | null;
    adminReviews: AdminReview[];
    passed: boolean;
  } | null;
}

type DimensionKey = "delegation" | "description" | "discernment" | "diligence";

const DIMENSIONS: DimensionKey[] = [
  "delegation",
  "description",
  "discernment",
  "diligence",
];

interface DimensionFormState {
  adjustedScore: number;
  weight: number;
  comment: string;
}

function parseLlmJustification(
  dimension: DimensionKey,
  rawAnalysis: string | null
): string {
  if (!rawAnalysis) return "No LLM analysis available";
  try {
    const parsed = JSON.parse(rawAnalysis) as Record<string, unknown>;
    const dimData = parsed[dimension];
    if (dimData && typeof dimData === "object") {
      const d = dimData as Record<string, unknown>;
      if (typeof d.justification === "string") return d.justification;
      if (typeof d.reasoning === "string") return d.reasoning;
      if (typeof d.comment === "string") return d.comment;
      return JSON.stringify(dimData);
    }
    if (typeof parsed.justification === "string") return parsed.justification;
    return rawAnalysis;
  } catch {
    return rawAnalysis;
  }
}

export default function AdminDashboard() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const admin = user?.role === "admin" ? user : null;
  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reviewForm, setReviewForm] = useState<
    Record<string, DimensionFormState>
  >({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [evalLoading, setEvalLoading] = useState<Record<number, boolean>>({});

  async function loadCandidates() {
    const res = await fetch("/api/admin");
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.candidates ?? []);
    }
  }

  useEffect(() => {
    if (!loading && admin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCandidates().catch(() => {});
    }
  }, [loading, admin]);

  function initReviewForm(c: CandidateResult) {
    const latest = c.latestAttempt;
    const fluency = latest?.fluencyScore;
    const existingReviews = latest?.adminReviews ?? [];

    const initial: Record<string, DimensionFormState> = {};
    for (const dim of DIMENSIONS) {
      const existing = existingReviews.find((r) => r.dimension === dim);
      const llmScore = fluency?.[dim] ?? 0;
      initial[dim] = {
        adjustedScore: existing?.adjusted_score ?? llmScore,
        weight: existing?.weight ?? 1.0,
        comment: existing?.comment ?? "",
      };
    }
    setReviewForm(initial);
  }

  function handleRowClick(c: CandidateResult) {
    const candidateId = c.candidate.id;
    if (expandedId === candidateId) {
      setExpandedId(null);
    } else {
      setExpandedId(candidateId);
      initReviewForm(c);
    }
  }

  function updateFormField(
    dimension: DimensionKey,
    field: keyof DimensionFormState,
    value: string | number
  ) {
    setReviewForm((prev) => ({
      ...prev,
      [dimension]: {
        ...prev[dimension],
        [field]: value,
      },
    }));
  }

  type FluencyScoreShape = {
    delegation: number | null;
    description: number | null;
    discernment: number | null;
    diligence: number | null;
    raw_analysis: string | null;
  } | null;

  async function submitReview(attemptId: number, fluency: FluencyScoreShape) {
    setReviewLoading(true);
    for (const dim of DIMENSIONS) {
      const form = reviewForm[dim];
      if (form) {
        const originalScore = fluency?.[dim] ?? 0;
        await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit_review",
            attemptId,
            dimension: dim,
            originalScore,
            adjustedScore: form.adjustedScore,
            weight: form.weight,
            comment: form.comment || null,
          }),
        });
      }
    }
    setReviewLoading(false);
    await loadCandidates();
  }

  async function markResult(attemptId: number, result: "pass" | "fail") {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete_review",
        attemptId,
        finalResult: result,
      }),
    });
    await loadCandidates();
  }

  async function triggerEvaluation(attemptId: number) {
    setEvalLoading((prev) => ({ ...prev, [attemptId]: true }));
    try {
      await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      });
      // Wait briefly for the async evaluation to complete, then refresh
      setTimeout(
        () =>
          loadCandidates().finally(() =>
            setEvalLoading((prev) => ({ ...prev, [attemptId]: false }))
          ),
        2000
      );
    } catch {
      setEvalLoading((prev) => ({ ...prev, [attemptId]: false }));
    }
  }

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
    <main className="flex-1 max-w-6xl mx-auto px-4 py-12" data-testid="admin-dashboard">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Candidate assessment results overview
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
                  <TableHead>Attempts</TableHead>
                  <TableHead>Latest Status</TableHead>
                  <TableHead>MC Score</TableHead>
                  <TableHead>Lab Tasks</TableHead>
                  <TableHead>4D Review</TableHead>
                  <TableHead>Review Status</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => {
                  const latest = c.latestAttempt;
                  const fluency = latest?.fluencyScore;
                  const fluencyAvg =
                    fluency
                      ? (
                          ((fluency.delegation ?? 0) +
                            (fluency.description ?? 0) +
                            (fluency.discernment ?? 0) +
                            (fluency.diligence ?? 0)) /
                          4
                        ).toFixed(1)
                      : "—";
                  const isExpanded = expandedId === c.candidate.id;
                  const humanReviewed = latest?.attempt.human_reviewed === 1;
                  const hasAdminReviews =
                    (latest?.adminReviews ?? []).length > 0;

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
                        <TableCell>{c.totalAttempts}</TableCell>
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
                        <TableCell>{fluencyAvg}</TableCell>
                        <TableCell>
                          {humanReviewed ? (
                            <Badge variant="default">Reviewed</Badge>
                          ) : hasAdminReviews ? (
                            <Badge variant="secondary">In Progress</Badge>
                          ) : (
                            <Badge variant="outline">Pending</Badge>
                          )}
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
                                  "PENDING REVIEW"}
                              </Badge>
                            ) : (
                              <Badge variant="outline">PENDING REVIEW</Badge>
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>

                      {isExpanded && latest && (
                        <TableRow key={`expanded-${c.candidate.id}`}>
                          <TableCell colSpan={8} className="p-0">
                            <div
                              data-testid={`review-panel-${c.candidate.id}`}
                              className="bg-muted/30 border-t p-6"
                            >
                              <h3 className="font-semibold text-sm mb-4">
                                4D Rubric Review — {c.candidate.display_name}
                              </h3>

                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                {DIMENSIONS.map((dim) => {
                                  const llmScore = fluency?.[dim];
                                  const justification =
                                    parseLlmJustification(
                                      dim,
                                      fluency?.raw_analysis ?? null
                                    );
                                  const formState = reviewForm[dim] ?? {
                                    adjustedScore: llmScore ?? 0,
                                    weight: 1.0,
                                    comment: "",
                                  };

                                  return (
                                    <div
                                      key={dim}
                                      data-testid={`dimension-${dim}`}
                                      className="bg-background rounded-lg border p-4 flex flex-col gap-3"
                                    >
                                      <p className="font-bold font-serif capitalize text-sm">
                                        {dim}
                                      </p>

                                      <div>
                                        <p className="text-xs text-muted-foreground mb-0.5">
                                          LLM Score
                                        </p>
                                        <p className="text-sm font-medium">
                                          {llmScore !== null &&
                                          llmScore !== undefined
                                            ? llmScore
                                            : "—"}
                                        </p>
                                      </div>

                                      <div>
                                        <p className="text-xs text-muted-foreground mb-0.5">
                                          LLM Justification
                                        </p>
                                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                                          {justification}
                                        </p>
                                      </div>

                                      <div className="flex flex-col gap-1">
                                        <Label
                                          htmlFor={`score-input-${dim}`}
                                          className="text-xs"
                                        >
                                          Adjusted Score (0–5)
                                        </Label>
                                        <Input
                                          id={`score-input-${dim}`}
                                          data-testid={`score-input-${dim}`}
                                          type="number"
                                          min={0}
                                          max={5}
                                          step={0.5}
                                          value={formState.adjustedScore}
                                          onChange={(e) =>
                                            updateFormField(
                                              dim,
                                              "adjustedScore",
                                              parseFloat(e.target.value) || 0
                                            )
                                          }
                                        />
                                      </div>

                                      <div className="flex flex-col gap-1">
                                        <Label
                                          htmlFor={`weight-input-${dim}`}
                                          className="text-xs"
                                        >
                                          Weight (0–1)
                                        </Label>
                                        <Input
                                          id={`weight-input-${dim}`}
                                          type="number"
                                          min={0}
                                          max={1}
                                          step={0.1}
                                          value={formState.weight}
                                          onChange={(e) =>
                                            updateFormField(
                                              dim,
                                              "weight",
                                              parseFloat(e.target.value) || 0
                                            )
                                          }
                                        />
                                      </div>

                                      <div className="flex flex-col gap-1">
                                        <Label
                                          htmlFor={`comment-${dim}`}
                                          className="text-xs"
                                        >
                                          Comment
                                        </Label>
                                        <Textarea
                                          id={`comment-${dim}`}
                                          data-testid={`comment-${dim}`}
                                          placeholder="Optional review notes…"
                                          value={formState.comment}
                                          onChange={(e) =>
                                            updateFormField(
                                              dim,
                                              "comment",
                                              e.target.value
                                            )
                                          }
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                <Button
                                  variant="destructive"
                                  data-testid="mark-fail-btn"
                                  onClick={() =>
                                    markResult(latest.attempt.id, "fail")
                                  }
                                >
                                  Mark as Fail
                                </Button>
                                <Button
                                  variant="outline"
                                  data-testid="mark-pass-btn"
                                  onClick={() =>
                                    markResult(latest.attempt.id, "pass")
                                  }
                                >
                                  Mark as Pass
                                </Button>
                                <Button
                                  data-testid="submit-review-btn"
                                  disabled={reviewLoading}
                                  onClick={() =>
                                    submitReview(
                                      latest.attempt.id,
                                      latest.fluencyScore
                                    )
                                  }
                                >
                                  {reviewLoading
                                    ? "Saving…"
                                    : "Submit Review"}
                                </Button>
                                {(latest.attempt.status === "submitted" ||
                                  latest.attempt.status === "evaluated") && (
                                  <Button
                                    variant="secondary"
                                    data-testid="run-evaluation-btn"
                                    disabled={
                                      evalLoading[latest.attempt.id] ?? false
                                    }
                                    onClick={() =>
                                      triggerEvaluation(latest.attempt.id)
                                    }
                                  >
                                    {evalLoading[latest.attempt.id]
                                      ? "Evaluating..."
                                      : latest.attempt.status === "evaluated"
                                        ? "Re-Evaluate"
                                        : "Run Evaluation"}
                                  </Button>
                                )}
                              </div>
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
