import * as fs from "fs";
import * as path from "path";

/**
 * Path to the system prompt markdown file. The CONTENT of this file is owned
 * by TASK-30; here we only load whatever is present. Override with
 * $CALENDAR_AGENT_PROMPT for testing / alternate prompts.
 */
export function promptPath(): string {
  const explicit = process.env.CALENDAR_AGENT_PROMPT;
  if (explicit && explicit.length > 0) return explicit;
  // prompt.md lives at the package root, one level up from dist/ (or src/).
  return path.join(__dirname, "..", "prompt.md");
}

/**
 * Read the system prompt. Throws if the file is missing — a missing prompt is
 * a scaffold error we want to surface loudly, not a silent empty prompt.
 */
export function loadSystemPrompt(filePath: string = promptPath()): string {
  return fs.readFileSync(filePath, "utf-8");
}
