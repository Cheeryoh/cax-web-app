"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

interface AttemptSummary {
  attempt: {
    id: number;
    started_at: string;
    completed_at: string | null;
    status: string;
  };
  mcScore: { correct: number; total: number };
  labResults: { task_id: string; passed: number }[];
  fluencyScore: {
    delegation: number | null;
    description: number | null;
    discernment: number | null;
    diligence: number | null;
  } | null;
  passed: boolean;
}

export default function CandidatePortal() {
  const router = useRouter();
  const { loading, user: candidate } = useAuth();
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);

  async function loadAttempts() {
    const res = await fetch("/api/exam?action=attempts");
    if (res.ok) {
      const data = await res.json();
      setAttempts(data.attempts ?? []);
    }
  }

  useEffect(() => {
    if (!loading && candidate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAttempts().catch(() => {});
    }
  }, [loading, candidate]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </main>
    );
  }

  if (!candidate) {
    router.push("/");
    return null;
  }

  return (
    <main className="flex-1 max-w-4xl mx-auto px-4 py-12" data-testid="candidate-portal">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Welcome, {candidate.displayName}</h1>
        <p className="text-muted-foreground mt-1">
          Your assessment history and results
        </p>
      </div>

      {attempts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No attempts yet.</p>
            <a href="/exam" className="text-primary underline text-sm mt-2 inline-block">
              Start your first assessment
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {attempts.map((summary) => (
            <Card key={summary.attempt.id} data-testid={`attempt-${summary.attempt.id}`}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-3">
                  Attempt #{summary.attempt.id}
                  <Badge variant={summary.passed ? "default" : "destructive"}>
                    {summary.passed ? "PASSED" : summary.attempt.status === "evaluated" ? "FAILED" : summary.attempt.status.toUpperCase()}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Started: {new Date(summary.attempt.started_at).toLocaleString()}
                  {summary.attempt.completed_at && (
                    <> | Completed: {new Date(summary.attempt.completed_at).toLocaleString()}</>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">MC Score</p>
                    <p className="text-lg font-semibold">
                      {summary.mcScore.correct}/{summary.mcScore.total}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Lab Tasks</p>
                    <p className="text-lg font-semibold">
                      {summary.labResults.filter((r) => r.passed).length}/{summary.labResults.length || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">4D Fluency</p>
                    {summary.fluencyScore ? (
                      <div className="text-sm space-y-0.5">
                        <p>Delegation: {summary.fluencyScore.delegation ?? "—"}</p>
                        <p>Description: {summary.fluencyScore.description ?? "—"}</p>
                        <p>Discernment: {summary.fluencyScore.discernment ?? "—"}</p>
                        <p>Diligence: {summary.fluencyScore.diligence ?? "—"}</p>
                      </div>
                    ) : (
                      <p className="text-lg font-semibold">Pending</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-6">
        <a href="/exam" className="text-primary underline text-sm">
          Start a new attempt
        </a>
      </div>
    </main>
  );
}
