import type { NextFunction, Request, Response } from "express";
import { AGENT_STATUSES } from "../lib/constants";
import { makeCsrfToken } from "../lib/csrf";
import { env } from "../lib/env";
import { formatDateTime, relativeTime } from "../lib/relativeTime";

const viewHelpers = { relativeTime, formatDateTime };

// Changes on every process start (= every deploy), so browsers re-fetch /styles.css and
// /app.js instead of serving a stale cached copy for up to an hour.
const ASSET_VERSION = Date.now().toString(36);

/** Expose common template globals, the current user, CSRF token, and one-shot flash. */
export function attachViewLocals(req: Request, res: Response, next: NextFunction): void {
  res.locals.helpers = viewHelpers;
  res.locals.statuses = AGENT_STATUSES;
  res.locals.baseUrl = env.PUBLIC_BASE_URL;
  res.locals.sourceUrl = env.SOURCE_URL;
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.umami = env.umami.enabled
    ? {
        scriptUrl: env.umami.scriptUrl,
        websiteId: env.umami.websiteId,
        // the tracker POSTs to `${hostUrl}/api/send`; keep it next to the script (/stats/...)
        hostUrl: env.umami.scriptUrl.replace(/\/[^/]*$/, ""),
      }
    : null;
  res.locals.currentPath = req.path;
  res.locals.currentUser = req.user ?? null;
  res.locals.og = res.locals.og ?? null;

  try {
    res.locals.csrfToken = makeCsrfToken(req, res);
  } catch {
    res.locals.csrfToken = "";
  }

  if (req.session) {
    res.locals.flash = req.session.flash ?? null;
    res.locals.flashKey = req.session.flashKey ?? null;
    delete req.session.flash;
    delete req.session.flashKey;
  } else {
    res.locals.flash = null;
    res.locals.flashKey = null;
  }
  next();
}

/** Gate a web route behind a logged-in session. */
export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }
  const next_ = encodeURIComponent(req.originalUrl || "/");
  res.redirect(`/login?next=${next_}`);
}
