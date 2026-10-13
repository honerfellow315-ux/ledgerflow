import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

/** Database errors carry the SQL text and its parameters (names, amounts, NI
 * numbers). They must stay in the server log and never reach the browser. */
function isDatabaseError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  if ("query" in error || "params" in error || "severity" in error) return true;
  const message = error instanceof Error ? error.message : "";
  return /Failed query|syntax error at or near|violates (foreign key|unique|check|not-null)|relation ".*" does not exist|column ".*" does not exist/i.test(
    message,
  );
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (isDatabaseError(error)) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
