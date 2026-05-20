import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import type { ReviewMeta } from "../stateFile";

const REVIEWS_DIR = path.join(
  process.env["HOME"] ?? "/root",
  ".claude",
  "session-reviews"
);

function ensureDir(): void {
  try {
    fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function pendingFilePath(sessionId: string): string {
  return path.join(REVIEWS_DIR, `${sessionId}.pending.json`);
}

export function createReviewsRouter(
  pendingReviews: Map<string, ReviewMeta>,
  onChanged: () => void
): Router {
  const router = Router();

  // GET /reviews — return all pending reviews
  router.get("/", (_req: Request, res: Response) => {
    res.json({ reviews: Array.from(pendingReviews.values()) });
  });

  // POST /reviews — upsert a review (called by session-review timer)
  router.post("/", (req: Request, res: Response) => {
    const data = req.body as Record<string, unknown>;
    const sessionId = String(data["session_id"] ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "missing session_id" });
      return;
    }

    const meta: ReviewMeta = {
      session_id: sessionId,
      review_path: String(data["review_path"] ?? ""),
      cwd: String(data["cwd"] ?? ""),
      summary_line: String(data["summary_line"] ?? ""),
    };

    pendingReviews.set(sessionId, meta);

    // Persist to .pending.json so server can reload on restart
    ensureDir();
    try {
      fs.writeFileSync(pendingFilePath(sessionId), JSON.stringify(meta, null, 2));
    } catch {
      // non-fatal
    }

    onChanged();
    res.json({ ok: true });
  });

  // DELETE /reviews/:sessionId — remove a review
  router.delete("/:sessionId", (req: Request, res: Response) => {
    const sessionId = req.params["sessionId"];
    if (!sessionId) {
      res.status(400).json({ error: "missing session_id" });
      return;
    }

    if (!pendingReviews.has(sessionId)) {
      res.status(404).json({ error: "review not found" });
      return;
    }

    pendingReviews.delete(sessionId);

    // Remove .pending.json file
    try {
      fs.unlinkSync(pendingFilePath(sessionId));
    } catch {
      // file may not exist
    }

    onChanged();
    res.json({ ok: true });
  });

  return router;
}
