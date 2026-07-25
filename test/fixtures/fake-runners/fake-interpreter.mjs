// A fake managing agent, for tests that run a whole campaign end to end.
//
// It stands in for `claude -p --json-schema ...`: it reads the job prompt on
// stdin and answers on stdout in the shape the real CLI answers in — a JSON
// array of events whose terminal `result` carries `structured_output`.
//
// It does not imitate a *contract* the way the retired fake envelopes did.
// Everything it reports is still checked by the production reconciliation:
// its verdict quote is verified against the retained transcript, its claimed
// artifact paths are stat'd, its status is overridden by a non-zero exit. If
// this fake starts lying, those checks fail — which is exactly the property
// the strict-envelope fakes never had.

const MIN_QUOTE_CHARS = 24;

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
  });
}

/** The transcript block the prompt delimits, if any. */
function transcriptFrom(prompt) {
  const start = prompt.indexOf("[BEGIN UNTRUSTED TRANSCRIPT]");
  const end = prompt.indexOf("[END UNTRUSTED TRANSCRIPT]");
  if (start < 0 || end < 0) return "";
  return prompt.slice(start + "[BEGIN UNTRUSTED TRANSCRIPT]".length, end);
}

/**
 * Only what the runner itself said — the same channels production reads.
 *
 * Collecting every string, including tool results and the brief, is the exact
 * hole the independent reviews found in production. A fake that keeps it would
 * quietly pass work the real path refuses.
 */
function transcriptStrings(transcript) {
  const found = [];
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      found.push(trimmed);
      continue;
    }
    for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!event || typeof event !== "object") continue;
      if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block?.type === "text" && typeof block.text === "string") found.push(block.text);
        }
      }
      if (event.type === "result" && typeof event.result === "string") found.push(event.result);
      if (event.type === "item.completed" && event.item?.type === "agent_message"
        && typeof event.item.text === "string") {
        found.push(event.item.text);
      }
    }
  }
  return found.toSorted((a, b) => a.length - b.length);
}

/**
 * A transport status the transcript actually reports, so campaign-level tests
 * can exercise more than "success". Production asks a model for this; the fake
 * reads the obvious signals rather than hardcoding one.
 */
function statedStatus(transcript) {
  if (/usage limit|rate limit|quota/i.test(transcript)) return "usage_limit";
  if (/permission[_ ]den/i.test(transcript)) return "permission_denied";
  if (/\bcancell?ed\b|\binterrupted\b/i.test(transcript)) return "cancelled";
  return "success";
}

/**
 * The recommendation the runner actually stated, or none.
 *
 * Revise is checked first: a reviewer that asks for changes usually mentions
 * acceptance in the same breath ("I don't think this should be accepted"), and
 * reading that as approval is the exact failure this layer exists to prevent.
 */
function statedRecommendation(transcript) {
  const strings = transcriptStrings(transcript);
  for (const value of strings.toReversed()) {
    if (/\brevise\b/i.test(value)) return { verdict: "revise", quote: value };
  }
  for (const value of strings.toReversed()) {
    // An explicit recommendation, not the mere presence of the word: a reviewer
    // writing "I don't think this should be accepted" says the opposite, and a
    // fake that reads it as approval would hide the exact misread this layer
    // exists to prevent. Raised by the independent cursor review, 2026-07-25.
    if (/\b(don't|do not|cannot|can't|should not|shouldn't|not)\b[^.!?]{0,60}\baccept/i.test(value)) continue;
    if (/\baccept\b[^.!?]{0,40}\b(as it stands|this|the change|it)\b/i.test(value)) {
      return { verdict: "accept", quote: value };
    }
  }
  return undefined;
}

async function main() {
  const prompt = await readStdin();
  const isReviewer = /^- role: reviewer$/m.test(prompt);
  const transcript = transcriptFrom(prompt);
  const stated = statedRecommendation(transcript);
  const canQuote = (stated?.quote ?? "").replaceAll(/\s/g, "").length >= MIN_QUOTE_CHARS;

  const status = statedStatus(transcript);
  const structured = {
    status,
    // A reviewer that stated nothing quotable is indeterminate, never accept:
    // absence is not approval here either.
    verdict: isReviewer ? (canQuote ? stated.verdict : "indeterminate") : null,
    verdictEvidence: isReviewer && canQuote ? stated.quote.slice(0, 400) : "",
    findings: [],
    artifactPaths: [],
    sessionHandle: null,
    failure: status === "success"
      ? null
      : { code: status, message: `The transcript reports ${status}.` },
    summary: isReviewer ? "Fake interpretation of a review job." : "Fake interpretation of an implementer job.",
  };

  process.stdout.write(JSON.stringify([
    { type: "system", subtype: "init", session_id: "fake-interpreter", tools: ["StructuredOutput"] },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "fake-interpreter",
      total_cost_usd: 0,
      result: JSON.stringify(structured),
      structured_output: structured,
    },
  ]));
}

await main();
