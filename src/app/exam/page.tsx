"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Question {
  id: string;
  text: string;
  options: { key: string; text: string }[];
}

type ExamPhase = "loading" | "mc" | "mc_submitted" | "lab" | "submitted";

export default function ExamPage() {
  const [phase, setPhase] = useState<ExamPhase>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [mcResult, setMcResult] = useState<{ correct: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startExam() {
    try {
      // Create attempt
      const attemptRes = await fetch("/api/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!attemptRes.ok) {
        setError("Please log in first");
        return;
      }
      const { attempt } = await attemptRes.json();
      setAttemptId(attempt.id);

      // Fetch questions
      const qRes = await fetch("/api/exam?action=questions");
      const { questions: q } = await qRes.json();
      setQuestions(q);
      setPhase("mc");
    } catch {
      setError("Failed to start exam");
    }
  }

  useEffect(() => {
    startExam();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitMc() {
    if (!attemptId) return;
    const answerList = Object.entries(answers).map(([questionId, selectedAnswer]) => ({
      questionId,
      selectedAnswer,
    }));

    const res = await fetch("/api/exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_mc", attemptId, answers: answerList }),
    });
    const data = await res.json();
    setMcResult(data.result);
    setPhase("mc_submitted");
  }

  async function submitLab() {
    if (!attemptId) return;
    await fetch("/api/exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_lab", attemptId }),
    });
    setPhase("submitted");
  }

  if (error) {
    return (
      <main className="flex-1 flex items-center justify-center" data-testid="exam-error">
        <Card className="max-w-md w-full mx-4">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className="text-primary underline">Return to home</Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (phase === "loading") {
    return (
      <main className="flex-1 flex items-center justify-center" data-testid="exam-loading">
        <p className="text-muted-foreground">Loading exam...</p>
      </main>
    );
  }

  if (phase === "mc") {
    const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;
    return (
      <main className="flex-1 max-w-3xl mx-auto px-4 py-12" data-testid="exam-mc">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Multiple Choice</h1>
          <p className="text-muted-foreground mt-1">
            Answer all {questions.length} questions, then submit to proceed to the performance lab.
          </p>
        </div>

        <div className="space-y-6">
          {questions.map((q, i) => (
            <Card key={q.id} data-testid={`question-${q.id}`}>
              <CardHeader>
                <CardTitle className="text-base">
                  {i + 1}. {q.text}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {q.options.map((opt) => (
                    <label
                      key={opt.key}
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        answers[q.id] === opt.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={opt.key}
                        checked={answers[q.id] === opt.key}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.key }))}
                        className="accent-primary"
                      />
                      <span className="font-medium mr-2">{opt.key}.</span>
                      <span>{opt.text}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <Button onClick={submitMc} disabled={!allAnswered}>
            Submit Answers ({Object.keys(answers).length}/{questions.length})
          </Button>
        </div>
      </main>
    );
  }

  if (phase === "mc_submitted") {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-4 py-12" data-testid="exam-mc-result">
        <Card>
          <CardHeader>
            <CardTitle>Multiple Choice Complete</CardTitle>
            <CardDescription>
              You scored {mcResult?.correct}/{mcResult?.total}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Proceed to the Performance Lab to complete your assessment.
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => setPhase("lab")}>
              Continue to Performance Lab
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  if (phase === "lab") {
    return (
      <main className="flex-1 max-w-3xl mx-auto px-4 py-12" data-testid="exam-lab">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Performance Lab</h1>
          <p className="text-muted-foreground mt-1">
            Fix the broken portfolio website using Claude Code in your provisioned environment.
          </p>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task 1: Fix CSS Layout</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The hero section and navigation bar have layout issues. Fix the flexbox properties
                and z-index so the page renders correctly.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task 2: Fix JavaScript Error</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The contact form throws a runtime error when submitted. Find and fix the
                JavaScript issue so the form works.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task 3: Fix Broken Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Images and the favicon are not loading. Fix the asset paths so all
                media displays correctly.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task 4: Improve Page Quality</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Improve the page quality and ensure it follows web best practices.
                There are multiple valid approaches — use your judgment.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">Your Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Your Codespace is being prepared. Use <code className="bg-muted px-1 rounded">claude-exam</code> instead
              of <code className="bg-muted px-1 rounded">claude</code> to ensure your interactions are logged.
            </p>
            <Badge variant="outline">Environment: Provisioning...</Badge>
          </CardContent>
          <CardFooter className="flex justify-between">
            <p className="text-xs text-muted-foreground">
              Click &quot;Submit Lab&quot; when you have completed all tasks.
            </p>
            <Button onClick={submitLab}>Submit Lab</Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  // submitted
  return (
    <main className="flex-1 flex items-center justify-center" data-testid="exam-submitted">
      <Card className="max-w-md w-full mx-4">
        <CardHeader>
          <CardTitle>Assessment Submitted</CardTitle>
          <CardDescription>
            Your work has been submitted for evaluation. Results will be available in your candidate portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Link href="/candidate" className="text-primary underline text-sm">
            View Results
          </Link>
          <Link href="/" className="text-muted-foreground underline text-sm">
            Return Home
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
