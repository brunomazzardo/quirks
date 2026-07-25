#!/usr/bin/env node
/** Standalone security verification — inlined production logic, no build required. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTHORED_MESSAGE_SEPARATOR = "\n\u0000\n";
const MIN_QUOTE_SIGNIFICANT_CHARS = 12;
const PRESENTATION_CHARACTERS = /[*_`~]/g;
const TYPOGRAPHIC_REPLACEMENTS = [
  [/[‘’‛]/g, "'"],
  [/[""]/g, '"'],
  [/[–—―]/g, "-"],
  [/…/g, "..."],
];
const STATEMENT_TERMINATORS = new Set([".", "!", "?", ":", ";"]);

function collectStrings(value, into) {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) collectStrings(entry, into);
  }
}

function claudeAssistantText(event, into) {
  const message = event["message"];
  if (typeof message !== "object" || message === null) return;
  const content = message["content"];
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    if (block["type"] === "text" && typeof block["text"] === "string") into.push(block["text"]);
  }
}

function codexAgentMessage(event, into) {
  const item = event["item"];
  if (typeof item !== "object" || item === null) return;
  if (item["type"] === "agent_message" && typeof item["text"] === "string") into.push(item["text"]);
}

function transcriptQuoteHaystack(transcript) {
  const authored = [];
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      authored.push(line);
      continue;
    }
    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const event of events) {
      if (typeof event !== "object" || event === null) continue;
      if (event["type"] === "assistant") claudeAssistantText(event, authored);
      if (event["type"] === "result" && typeof event["result"] === "string") authored.push(event["result"]);
      if (event["type"] === "item.completed") codexAgentMessage(event, authored);
    }
  }
  return authored.join(AUTHORED_MESSAGE_SEPARATOR);
}

function transcriptAllText(transcript) {
  const parts = [];
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      collectStrings(JSON.parse(trimmed), parts);
    } catch {
      parts.push(line);
    }
  }
  return parts.join("\n");
}

function foldPresentation(value) {
  let normalized = value.normalize("NFKC");
  for (const [pattern, replacement] of TYPOGRAPHIC_REPLACEMENTS) {
    normalized = normalized.replaceAll(pattern, replacement);
  }
  return normalized.replaceAll(PRESENTATION_CHARACTERS, "").toLowerCase();
}

function normalizeQuoteText(value) {
  return foldPresentation(value).replaceAll(/\s+/g, " ").trim();
}

function isWordCharacter(character) {
  return /[\p{L}\p{N}]/u.test(character);
}

function normalizeHaystack(value) {
  const folded = foldPresentation(value);
  const starts = new Set([0]);
  let text = "";
  let pendingBoundary = true;
  let sawWhitespace = false;
  let lastMeaningful = "";
  let tokenHasWord = false;
  let tokenLength = 0;

  for (const character of folded) {
    if (/\s/.test(character)) {
      sawWhitespace = true;
      if (STATEMENT_TERMINATORS.has(lastMeaningful)) pendingBoundary = true;
      if (character === "\n" || character === "\r") pendingBoundary = true;
      if (tokenLength > 0 && !tokenHasWord) pendingBoundary = true;
      tokenHasWord = false;
      tokenLength = 0;
      continue;
    }
    if (text.length > 0 && sawWhitespace) text += " ";
    if (pendingBoundary) starts.add(text.length);
    text += character;
    tokenLength += 1;
    if (isWordCharacter(character)) tokenHasWord = true;
    pendingBoundary = pendingBoundary && !isWordCharacter(character);
    lastMeaningful = character;
    sawWhitespace = false;
  }

  return { text, starts };
}

function quoteSupportedByTranscript(quote, transcript) {
  const needle = normalizeQuoteText(quote);
  if (needle.replaceAll(/\s/g, "").length < MIN_QUOTE_SIGNIFICANT_CHARS) return false;
  const haystack = normalizeHaystack(transcriptQuoteHaystack(transcript));
  for (let index = haystack.text.indexOf(needle); index !== -1; index = haystack.text.indexOf(needle, index + 1)) {
    if (haystack.starts.has(index)) return true;
  }
  return false;
}

function reviewerAcceptedAttempt(reviewer) {
  if (reviewer.status !== "success") return false;
  if (reviewer.verdict !== "accept") return false;
  return (reviewer.verdictEvidence ?? "").trim().length > 0;
}

function excerpt(text, max = 500) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `… [${text.length - max} more chars]`;
}

const ACCEPT_FRAGMENT = "this should be accepted as it stands.";

async function main() {
  const fixtureDir = path.join(WORKTREE, "test/fixtures/real-transcripts");
  const claudeRevise = await readFile(path.join(fixtureDir, "claude-reviewer-revise.jsonl"), "utf8");
  const cursorRevise = await readFile(path.join(fixtureDir, "cursor-reviewer-revise.jsonl"), "utf8");

  const results = { meta: { source: "standalone-inlined", worktree: WORKTREE }, attacks: {} };

  for (const [label, transcriptText] of Object.entries({
    A: "I don't think — this should be accepted as it stands.",
    B: "I don't think: this should be accepted as it stands.",
    C: "I don't think - this should be accepted as it stands.",
    E: "I don't think (this should be accepted as it stands.)",
  })) {
    const haystack = transcriptQuoteHaystack(transcriptText);
    results.attacks[label] = {
      transcript: transcriptText,
      quote: ACCEPT_FRAGMENT,
      supported: quoteSupportedByTranscript(ACCEPT_FRAGMENT, transcriptText),
      haystackExcerpt: excerpt(haystack),
    };
  }

  const claudeHaystack = transcriptQuoteHaystack(claudeRevise);
  const claudeAllText = transcriptAllText(claudeRevise);

  const attackDCandidates = [
    ACCEPT_FRAGMENT,
    "accepted as it stands.",
    "Defects 1 and 2 are not stylistic quibbles",
    "the function returns the wrong answer for every input",
    "**Revise.**",
    "Revise.",
    "I don't think this should be accepted as it stands.",
    "Accept as it stands.",
    "accept the code as it stands, or revise it.",
    "Report every defect you find, with file and line references.",
    "Finish your final message with an explicit recommendation in your own words: accept the code as",
    "**Revise.** I don't think this should be accepted as it stands.",
  ];

  const attackDResults = Object.fromEntries(
    attackDCandidates.map((q) => [q, quoteSupportedByTranscript(q, claudeRevise)]),
  );

  const acceptSubstringsThatPass = [];
  const hayLower = claudeHaystack.toLowerCase();
  for (let pos = 0; (pos = hayLower.indexOf("accept", pos)) !== -1; pos++) {
    for (const start of [Math.max(0, pos - 30), Math.max(0, pos - 15), pos]) {
      for (const len of [40, 60, 90, 120, 200]) {
        const candidate = claudeHaystack.slice(start, start + len).trim();
        if (candidate.replace(/\s/g, "").length >= 12 && quoteSupportedByTranscript(candidate, claudeRevise)) {
          acceptSubstringsThatPass.push(excerpt(candidate, 200));
        }
      }
    }
    if (acceptSubstringsThatPass.length >= 15) break;
  }

  results.attacks.D = {
    candidateQuotes: attackDResults,
    acceptSubstringsThatPass: [...new Set(acceptSubstringsThatPass)],
    haystackExcerpt: excerpt(claudeHaystack),
    allTextExcerpt: excerpt(claudeAllText),
    briefInAllText: claudeAllText.includes("accept the code as it stands"),
    briefInHaystack: claudeHaystack.toLowerCase().includes("accept the code as"),
  };

  const assistantOnly = claudeRevise
    .split(/\r?\n/)
    .filter((line) => {
      try {
        return JSON.parse(line.trim())?.type === "assistant";
      } catch {
        return false;
      }
    })
    .join("\n");

  const resultOnly = claudeRevise
    .split(/\r?\n/)
    .filter((line) => {
      try {
        const p = JSON.parse(line.trim());
        return p?.type === "result" && typeof p?.result === "string";
      } catch {
        return false;
      }
    })
    .join("\n");

  const haystackFull = transcriptQuoteHaystack(claudeRevise);
  const haystackAssistantOnly = transcriptQuoteHaystack(assistantOnly);
  const haystackResultOnly = transcriptQuoteHaystack(resultOnly);
  const reviseQuote = "**Revise.** I don't think this should be accepted as it stands.";
  const resultChannelQuote = "I don't think this should be accepted as it stands.";

  results.attacks.F = {
    haystackFullLength: haystackFull.length,
    haystackAssistantOnlyLength: haystackAssistantOnly.length,
    haystackResultOnlyLength: haystackResultOnly.length,
    fullEqualsAssistantOnly: haystackFull === haystackAssistantOnly,
    resultDuplicatedInFull: haystackFull.includes(haystackResultOnly),
    reviseQuoteOnFull: quoteSupportedByTranscript(reviseQuote, claudeRevise),
    reviseQuoteOnAssistantOnly: quoteSupportedByTranscript(reviseQuote, assistantOnly),
    reviseQuoteOnResultOnly: quoteSupportedByTranscript(reviseQuote, resultOnly),
    resultChannelQuoteOnFull: quoteSupportedByTranscript(resultChannelQuote, claudeRevise),
    resultChannelQuoteOnResultOnly: quoteSupportedByTranscript(resultChannelQuote, resultOnly),
    messagesContainingRevise: haystackFull.split("\0").filter((m) => /revise/i.test(m)).length,
    haystackFullExcerpt: excerpt(haystackFull),
    haystackAssistantOnlyExcerpt: excerpt(haystackAssistantOnly),
    haystackResultOnlyExcerpt: excerpt(haystackResultOnly),
  };

  const cursorHaystack = transcriptQuoteHaystack(cursorRevise);
  const cursorAllText = transcriptAllText(cursorRevise);

  results.attacks.G = {
    haystackExcerpt: excerpt(cursorHaystack),
    allTextExcerpt: excerpt(cursorAllText),
    briefOrUserPromptInHaystack: /brief|tool_result|user prompt/i.test(cursorHaystack),
    allTextLongerThanHaystack: cursorAllText.length > cursorHaystack.length,
    candidateQuotes: Object.fromEntries(
      [
        ACCEPT_FRAGMENT,
        "accepted as it stands.",
        "Accept as it stands.",
        "accept the code as it stands",
        "**Revise** `sum.js`: change the loop to `index < n`",
        "Revise `sum.js`: change the loop to index < n",
        "should be revised",
        "**Revise**",
      ].map((q) => [q, quoteSupportedByTranscript(q, cursorRevise)]),
    ),
    haystackLength: cursorHaystack.length,
    allTextLength: cursorAllText.length,
  };

  results.reviewerAcceptedAttempt = {
    fabricatedEvidence: reviewerAcceptedAttempt({
      status: "success",
      verdict: "accept",
      verdictEvidence: "fabricated evidence not verified",
    }),
    note: "reviewerAcceptedAttempt only checks non-empty evidence, not transcript support",
  };

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
