import { APIRequestContext } from "@playwright/test";

/**
 * Login via API (not browser UI) for faster test setup.
 * Uses the page.request / browserContext.request fixture so that the
 * session cookie is automatically shared with the browser context.
 */
export async function loginViaApi(
  request: APIRequestContext,
  creds: { username: string; password: string }
) {
  const res = await request.post("/api/auth", {
    data: creds,
  });
  return res;
}
