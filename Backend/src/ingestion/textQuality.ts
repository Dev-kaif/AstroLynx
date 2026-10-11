/**
 * Conservative page-level quality signals for extracted document text.
 *
 * This is a routing aid, not a language detector or a PDF repair tool. In
 * particular, it never rewrites suspicious glyphs into guessed characters.
 * Thresholds remain provisional until checked against labeled MOSDAC pages.
 */

export type TextQualityStatus = "usable" | "review" | "reject";

export type TextQualitySignal =
  | "empty_text"
  | "very_short_text"
  | "replacement_glyphs"
  | "control_character_noise"
  | "private_use_glyphs"
  | "high_symbol_density"
  | "low_word_like_density"
  | "repeated_line_noise"
  | "long_repeated_character_run";

export interface TextQualityAssessment {
  status: TextQualityStatus;
  /** A provisional 0–1 readability heuristic, not a calibrated probability. */
  score: number;
  signals: TextQualitySignal[];
  metrics: {
    characterCount: number;
    nonWhitespaceCharacterCount: number;
    wordLikeTokenCount: number;
    tokenCount: number;
    wordLikeTokenRatio: number;
    symbolRatio: number;
    replacementGlyphRatio: number;
    controlCharacterRatio: number;
    privateUseGlyphRatio: number;
    repeatedNonEmptyLineRatio: number;
    longestRepeatedCharacterRun: number;
  };
  policyVersion: "page-text-quality-v2";
}

const LETTER_OR_NUMBER = /[\p{L}\p{M}\p{N}]/u;
const WORD_LIKE_TOKEN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’._:/+%-]*$/u;
const SYMBOL = /\p{S}/u;
const PRIVATE_USE = /\p{Co}/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const ALLOWED_WHITESPACE_CONTROLS = new Set(["\n", "\r", "\t"]);
const COMMON_LAYOUT_LEADERS = new Set([".", "-", "_", "="]);

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function longestRepeatedCharacterRun(text: string): number {
  let longest = 0;
  let current = 0;
  let previous = "";

  for (const character of text) {
    // PDF contents pages commonly use long dotted leaders to connect a title
    // to its page number. These are layout, not evidence of text corruption.
    if (COMMON_LAYOUT_LEADERS.has(character)) {
      previous = "";
      current = 0;
      continue;
    }
    if (character === previous && !/\s/u.test(character)) {
      current += 1;
    } else {
      previous = character;
      current = 1;
    }
    if (current > longest) longest = current;
  }

  return longest;
}

function repeatedLineRatio(text: string): number {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  if (lines.length < 4) return 0;

  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);

  const repeatedLines = [...counts.values()].reduce(
    (total, count) => total + (count > 1 ? count : 0),
    0
  );
  return ratio(repeatedLines, lines.length);
}

/** Assess a single extracted page before it is normalized, chunked, or embedded. */
export function assessExtractedText(input: string): TextQualityAssessment {
  const text = input.normalize("NFKC").replace(/\r\n?/gu, "\n");
  const characters = [...text];
  const nonWhitespace = characters.filter((character) => !/\s/u.test(character));
  const tokens = text.match(/\S+/gu) ?? [];
  const wordLikeTokenCount = tokens.filter((token) =>
    WORD_LIKE_TOKEN.test(token)
  ).length;

  const replacementGlyphCount = characters.filter(
    (character) => character === "\uFFFD" || character === "\u25A1"
  ).length;
  const controlCharacterCount = characters.filter(
    (character) =>
      CONTROL.test(character) && !ALLOWED_WHITESPACE_CONTROLS.has(character)
  ).length;
  const privateUseGlyphCount = characters.filter((character) =>
    PRIVATE_USE.test(character)
  ).length;
  const symbolCount = nonWhitespace.filter((character) =>
    SYMBOL.test(character)
  ).length;
  const letterOrNumberCount = nonWhitespace.filter((character) =>
    LETTER_OR_NUMBER.test(character)
  ).length;

  const replacementGlyphRatio = ratio(
    replacementGlyphCount,
    nonWhitespace.length
  );
  const controlCharacterRatio = ratio(controlCharacterCount, characters.length);
  const privateUseGlyphRatio = ratio(privateUseGlyphCount, nonWhitespace.length);
  const symbolRatio = ratio(symbolCount, nonWhitespace.length);
  const wordLikeTokenRatio = ratio(wordLikeTokenCount, tokens.length);
  const repeatedNonEmptyLineRatio = repeatedLineRatio(text);
  const longestRun = longestRepeatedCharacterRun(text);

  const signals: TextQualitySignal[] = [];
  if (nonWhitespace.length === 0) signals.push("empty_text");
  else if (nonWhitespace.length < 80) signals.push("very_short_text");
  if (replacementGlyphRatio > 0.005) signals.push("replacement_glyphs");
  if (controlCharacterRatio > 0.002) signals.push("control_character_noise");
  if (privateUseGlyphRatio > 0.005) signals.push("private_use_glyphs");
  if (symbolRatio > 0.35 && letterOrNumberCount < nonWhitespace.length * 0.45) {
    signals.push("high_symbol_density");
  }
  if (tokens.length >= 12 && wordLikeTokenRatio < 0.35) {
    signals.push("low_word_like_density");
  }
  if (repeatedNonEmptyLineRatio > 0.55) {
    signals.push("repeated_line_noise");
  }
  if (longestRun >= 10) signals.push("long_repeated_character_run");

  // Scores expose the contributing evidence; they are intentionally not
  // presented as calibrated probabilities. High-noise signals dominate.
  let score = 1;
  score -= Math.min(0.7, replacementGlyphRatio * 8);
  score -= Math.min(0.5, controlCharacterRatio * 12);
  score -= Math.min(0.6, privateUseGlyphRatio * 8);
  if (symbolRatio > 0.35 && letterOrNumberCount < nonWhitespace.length * 0.45) {
    score -= Math.min(0.45, (symbolRatio - 0.35) * 1.2);
  }
  if (tokens.length >= 12 && wordLikeTokenRatio < 0.35) {
    score -= Math.min(0.25, (0.35 - wordLikeTokenRatio) * 0.7);
  }
  if (repeatedNonEmptyLineRatio > 0.55) {
    score -= Math.min(0.2, (repeatedNonEmptyLineRatio - 0.55) * 0.5);
  }
  if (longestRun >= 10) score -= 0.15;
  score = nonWhitespace.length === 0 ? 0 : Math.max(0, Math.min(1, score));

  const severeNoise =
    replacementGlyphRatio > 0.03 ||
    controlCharacterRatio > 0.02 ||
    (privateUseGlyphRatio > 0.15 && wordLikeTokenRatio < 0.2);
  if (severeNoise) score = Math.min(score, 0.2);

  let status: TextQualityStatus;
  if (nonWhitespace.length === 0 || severeNoise || score < 0.4) {
    status = "reject";
  } else if (score < 0.72 || nonWhitespace.length < 160 || signals.length > 0) {
    status = "review";
  } else {
    status = "usable";
  }

  return {
    status,
    score: Math.round(score * 1000) / 1000,
    signals,
    metrics: {
      characterCount: characters.length,
      nonWhitespaceCharacterCount: nonWhitespace.length,
      wordLikeTokenCount,
      tokenCount: tokens.length,
      wordLikeTokenRatio: Math.round(wordLikeTokenRatio * 1000) / 1000,
      symbolRatio: Math.round(symbolRatio * 1000) / 1000,
      replacementGlyphRatio: Math.round(replacementGlyphRatio * 1000) / 1000,
      controlCharacterRatio: Math.round(controlCharacterRatio * 1000) / 1000,
      privateUseGlyphRatio: Math.round(privateUseGlyphRatio * 1000) / 1000,
      repeatedNonEmptyLineRatio:
        Math.round(repeatedNonEmptyLineRatio * 1000) / 1000,
      longestRepeatedCharacterRun: longestRun,
    },
    policyVersion: "page-text-quality-v2",
  };
}
