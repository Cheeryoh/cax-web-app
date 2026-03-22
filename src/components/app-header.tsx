"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

export function AppHeader() {
  const { user, clearAuth } = useAuth()

  function handleLogout() {
    fetch("/api/auth", { method: "DELETE" })
      .finally(() => {
        clearAuth()
        window.location.href = "/"
      })
  }

  return (
    <header
      data-testid="app-header"
      className="bg-background border-b border-border h-14 flex items-center px-4 sm:px-6"
    >
      <div className="flex items-center justify-between w-full">
        <Link
          href="/"
          data-testid="app-title"
          className="font-heading text-xl font-semibold text-foreground hover:text-primary transition-colors"
        >
          CAX
        </Link>

        {user && (
          <div className="flex items-center gap-3">
            <span
              data-testid="header-display-name"
              className="hidden sm:inline text-sm text-muted-foreground"
            >
              {user.displayName}
            </span>
            <Badge
              data-testid="header-role-badge"
              variant="outline"
            >
              {user.role}
            </Badge>
            <Button
              data-testid="header-logout-btn"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
            >
              Log out
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
