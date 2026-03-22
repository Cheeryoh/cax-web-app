"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        window.location.href = data.redirectUrl;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Invalid credentials. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="flex-1 flex items-center justify-center px-4 py-12"
      data-testid="login-page"
    >
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <CardHeader>
            {/* Use native h1 so the page satisfies the page-has-heading-one a11y rule.
                CardTitle renders as a <div>; the login card title IS the page heading. */}
            <h1 className="font-heading text-base leading-snug font-medium">Sign In</h1>
            <CardDescription>
              Enter your credentials to access the assessment platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  defaultValue="demo@example.com"
                  placeholder="username or email"
                  data-testid="username-input"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  defaultValue="Cand!date2026"
                  data-testid="password-input"
                  required
                />
              </div>
              {error && (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-testid="login-error"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="inline-flex w-full h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50"
                disabled={submitting}
                data-testid="login-submit-btn"
              >
                {submitting ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </CardContent>
        </Card>

        <Card data-testid="demo-accounts">
          <CardHeader>
            <CardTitle>Demo Accounts</CardTitle>
            <CardDescription>
              Use these credentials to explore the platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium text-foreground">Candidate</p>
                <p className="text-muted-foreground">
                  Username: <span className="font-mono">demo@example.com</span>
                </p>
                <p className="text-muted-foreground">
                  Password: <span className="font-mono">Cand!date2026</span>
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Admin</p>
                <p className="text-muted-foreground">
                  Username: <span className="font-mono">admin</span>
                </p>
                <p className="text-muted-foreground">
                  Password: <span className="font-mono">Adm!n$ecure2026</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
