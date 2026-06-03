/**
 * Whitelist config + input filtering.
 *
 * The Calendar Agent reads from three MCP sources (WhatsApp groups, Gmail).
 * To save tokens and reduce noise, raw inputs are filtered HERE — before the
 * agent reasons over them. Only inputs that match the configured whitelist
 * (named WhatsApp groups, allowed Gmail senders / labels) are passed through.
 *
 * This module is pure data + pure functions: no I/O, no SDK, fully unit
 * testable. {@link loadConfig} (config.ts) wires the parsed whitelist in; the
 * host (host.ts) uses {@link filterInputs} to gate what reaches the model.
 */

/** Normalised, case-insensitive comparison helper. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * WhatsApp whitelist: groups are listed BY NAME (jmenovitě). Only messages
 * from a group whose name matches one of these (case-insensitive, trimmed)
 * are allowed through.
 */
export interface WhatsAppWhitelist {
  /** Group names to allow, listed explicitly. */
  groups: string[];
}

/**
 * Gmail whitelist: a message passes if its sender matches one of `senders`
 * (substring match on the From address, case-insensitive) OR it carries one
 * of the `labels`. An empty Gmail whitelist allows nothing.
 */
export interface GmailWhitelist {
  /** Allowed sender addresses / domains (substring match on From). */
  senders: string[];
  /** Allowed Gmail labels (exact, case-insensitive). */
  labels: string[];
}

export interface WhitelistConfig {
  whatsapp: WhatsAppWhitelist;
  gmail: GmailWhitelist;
}

/** Empty whitelist — the safe default: nothing passes until configured. */
export const EMPTY_WHITELIST: WhitelistConfig = {
  whatsapp: { groups: [] },
  gmail: { senders: [], labels: [] },
};

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Parse an arbitrary object into a {@link WhitelistConfig}, dropping anything
 * malformed. Always returns a fully-formed config (missing parts -> empty).
 */
export function buildWhitelist(raw: unknown): WhitelistConfig {
  if (typeof raw !== "object" || raw === null) {
    return {
      whatsapp: { groups: [] },
      gmail: { senders: [], labels: [] },
    };
  }
  const o = raw as Record<string, unknown>;
  const wa = (o.whatsapp ?? {}) as Record<string, unknown>;
  const gm = (o.gmail ?? {}) as Record<string, unknown>;
  return {
    whatsapp: { groups: toStringArray(wa.groups) },
    gmail: {
      senders: toStringArray(gm.senders),
      labels: toStringArray(gm.labels),
    },
  };
}

/** A WhatsApp message as surfaced by whatsapp-mcp (minimal shape we filter on). */
export interface WhatsAppInput {
  source: "whatsapp";
  /** Group/chat name the message came from. */
  group: string;
  /** Free-form message text (passed through unchanged when allowed). */
  text: string;
  [key: string]: unknown;
}

/** A Gmail message as surfaced by the Gmail MCP (minimal shape we filter on). */
export interface GmailInput {
  source: "gmail";
  /** From header (e.g. "Jane Doe <jane@example.com>"). */
  from: string;
  /** Labels attached to the message. */
  labels?: string[];
  subject?: string;
  [key: string]: unknown;
}

export type AgentInput = WhatsAppInput | GmailInput;

/** True if a WhatsApp message comes from a whitelisted group. */
export function isWhatsAppAllowed(
  input: WhatsAppInput,
  wl: WhitelistConfig
): boolean {
  const allowed = wl.whatsapp.groups.map(norm);
  return allowed.includes(norm(input.group));
}

/**
 * True if a Gmail message is allowed: sender substring-matches an allowed
 * sender, OR the message carries an allowed label.
 */
export function isGmailAllowed(
  input: GmailInput,
  wl: WhitelistConfig
): boolean {
  const from = norm(input.from);
  const senderMatch = wl.gmail.senders.some((s) => from.includes(norm(s)));
  if (senderMatch) return true;

  const msgLabels = (input.labels ?? []).map(norm);
  const allowedLabels = wl.gmail.labels.map(norm);
  return msgLabels.some((l) => allowedLabels.includes(l));
}

/** True if any input is allowed by the whitelist. */
export function isAllowed(input: AgentInput, wl: WhitelistConfig): boolean {
  if (input.source === "whatsapp") return isWhatsAppAllowed(input, wl);
  if (input.source === "gmail") return isGmailAllowed(input, wl);
  return false;
}

/**
 * Filter a batch of raw inputs down to only the whitelisted ones. This is the
 * gate that runs DŘÍV than the agent reasons — keeping the model's context
 * free of non-whitelisted noise.
 */
export function filterInputs(
  inputs: AgentInput[],
  wl: WhitelistConfig
): AgentInput[] {
  return inputs.filter((i) => isAllowed(i, wl));
}
