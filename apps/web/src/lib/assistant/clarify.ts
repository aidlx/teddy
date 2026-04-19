export interface ClarificationOption {
  label: string;
}

export interface ClarificationAsk {
  question: string;
  options: ClarificationOption[];
}

export type ClarificationResolution =
  | {
      kind: 'option';
      label: string;
      index: number;
      raw: string;
      matchedBy: 'exact' | 'index' | 'code' | 'token' | 'substring';
    }
  | {
      kind: 'none';
      label: string;
      raw: string;
      matchedBy: 'none';
    }
  | {
      kind: 'unknown';
      raw: string;
    };

const ASK_FENCE = /```ask\s*\n?([\s\S]+?)\n?```/;
const INDEX_PATTERNS = [
  /\b1\b/,
  /\b1st\b/,
  /\bfirst\b/,
  /\bone\b/,
  /\b2\b/,
  /\b2nd\b/,
  /\bsecond\b/,
  /\btwo\b/,
  /\b3\b/,
  /\b3rd\b/,
  /\bthird\b/,
  /\bthree\b/,
  /\b4\b/,
  /\b4th\b/,
  /\bfourth\b/,
  /\bfour\b/,
  /\b5\b/,
  /\b5th\b/,
  /\bfifth\b/,
  /\bfive\b/,
] as const;
const NONE_PATTERNS = [
  /\bnone\b/,
  /\bneither\b/,
  /\bnope\b/,
  /\bno\b/,
  /\bother\b/,
  /\bsomething else\b/,
  /\bnone of these\b/,
] as const;
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'one',
  'option',
  'please',
  'pick',
  'choose',
  'use',
  'class',
  'course',
  'one',
  'this',
  'that',
]);

function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compact(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function codeFragments(label: string): string[] {
  const matches = label.match(/\d+(?:\.\d+)+|\d+/g) ?? [];
  return Array.from(new Set(matches.flatMap((match) => [match, match.replace(/\D+/g, '')])));
}

function selectionIndex(raw: string, optionCount: number): number | null {
  const patternsPerOption = Math.min(optionCount, 5);
  for (let i = 0; i < patternsPerOption; i++) {
    const a = INDEX_PATTERNS[i * 4];
    const b = INDEX_PATTERNS[i * 4 + 1];
    const c = INDEX_PATTERNS[i * 4 + 2];
    const d = INDEX_PATTERNS[i * 4 + 3];
    if (a?.test(raw) || b?.test(raw) || c?.test(raw) || d?.test(raw)) return i;
  }
  return null;
}

function significantTokens(input: string): string[] {
  return normalize(input)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

export function parseClarificationAsk(content: string | null | undefined): ClarificationAsk | null {
  if (!content) return null;
  const match = content.match(ASK_FENCE);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as {
      question?: unknown;
      options?: unknown;
    };
    if (typeof parsed.question !== 'string' || !Array.isArray(parsed.options)) return null;
    const options = parsed.options
      .map((option) =>
        option &&
        typeof option === 'object' &&
        'label' in option &&
        typeof (option as { label: unknown }).label === 'string'
          ? { label: (option as { label: string }).label }
          : null,
      )
      .filter((option): option is ClarificationOption => option !== null);
    if (options.length === 0) return null;
    return { question: parsed.question, options };
  } catch {
    return null;
  }
}

export function buildClarificationMessage(ask: ClarificationAsk): string {
  return `\`\`\`ask\n${JSON.stringify(ask)}\n\`\`\``;
}

export function findPendingClarification<T extends { role: string; content: string | null }>(
  rows: T[],
): ClarificationAsk | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row) continue;
    if (row.role === 'user') return null;
    if (row.role === 'assistant') {
      const ask = parseClarificationAsk(row.content);
      if (ask) return ask;
    }
  }
  return null;
}

export function resolveClarificationReply(
  rawInput: string,
  ask: ClarificationAsk,
): ClarificationResolution {
  const raw = rawInput.trim();
  if (!raw) return { kind: 'unknown', raw };

  const normalizedRaw = normalize(raw);
  const compactRaw = compact(raw);
  const exactIndex = ask.options.findIndex((option) => normalize(option.label) === normalizedRaw);
  if (exactIndex !== -1) {
    return {
      kind: 'option',
      label: ask.options[exactIndex]!.label,
      index: exactIndex,
      raw,
      matchedBy: 'exact',
    };
  }

  for (const pattern of NONE_PATTERNS) {
    if (!pattern.test(normalizedRaw)) continue;
    const noneIndex = ask.options.findIndex((option) => normalize(option.label).includes('none of these'));
    return {
      kind: 'none',
      label: noneIndex === -1 ? 'None of these' : ask.options[noneIndex]!.label,
      raw,
      matchedBy: 'none',
    };
  }

  const byIndex = selectionIndex(normalizedRaw, ask.options.length);
  if (byIndex !== null && ask.options[byIndex]) {
    return {
      kind: 'option',
      label: ask.options[byIndex]!.label,
      index: byIndex,
      raw,
      matchedBy: 'index',
    };
  }

  const codeMatches = ask.options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => codeFragments(option.label).some((fragment) => compactRaw.includes(compact(fragment))));
  if (codeMatches.length === 1) {
    return {
      kind: 'option',
      label: codeMatches[0]!.option.label,
      index: codeMatches[0]!.index,
      raw,
      matchedBy: 'code',
    };
  }

  const rawTokens = significantTokens(raw);
  if (rawTokens.length > 0) {
    const tokenMatches = ask.options
      .map((option, index) => ({
        option,
        index,
        labelNorm: normalize(option.label),
      }))
      .filter(({ labelNorm }) => rawTokens.every((token) => labelNorm.includes(token)));
    if (tokenMatches.length === 1) {
      return {
        kind: 'option',
        label: tokenMatches[0]!.option.label,
        index: tokenMatches[0]!.index,
        raw,
        matchedBy: 'token',
      };
    }
  }

  const substringMatches = ask.options
    .map((option, index) => ({ option, index, labelNorm: normalize(option.label) }))
    .filter(({ labelNorm }) => normalizedRaw.length >= 2 && labelNorm.includes(normalizedRaw));
  if (substringMatches.length === 1) {
    return {
      kind: 'option',
      label: substringMatches[0]!.option.label,
      index: substringMatches[0]!.index,
      raw,
      matchedBy: 'substring',
    };
  }

  return { kind: 'unknown', raw };
}

export function canonicalClarificationReply(
  rawInput: string,
  ask: ClarificationAsk | null,
): string {
  if (!ask) return rawInput;
  const resolved = resolveClarificationReply(rawInput, ask);
  return resolved.kind === 'unknown' ? rawInput : resolved.label;
}
