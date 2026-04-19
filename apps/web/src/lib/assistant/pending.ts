import { z } from 'zod';

export const PendingActionOptionSchema = z.object({
  label: z.string().min(1).max(300),
  patch: z.record(z.string(), z.unknown()),
});

export const PendingActionSchema = z.object({
  tool_name: z.string().min(1).max(100),
  tool_args: z.record(z.string(), z.unknown()),
  question: z.string().min(1).max(300),
  options: z.array(PendingActionOptionSchema).min(1).max(8),
});

export type PendingActionOption = z.infer<typeof PendingActionOptionSchema>;
export type PendingAction = z.infer<typeof PendingActionSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneObject<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepMergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, patchValue] of Object.entries(patch)) {
    const currentValue = target[key];
    if (isPlainObject(currentValue) && isPlainObject(patchValue)) {
      target[key] = deepMergeInto({ ...currentValue }, patchValue);
      continue;
    }
    target[key] = patchValue;
  }
  return target;
}

export function applyPendingOption(
  toolArgs: Record<string, unknown>,
  option: PendingActionOption,
): Record<string, unknown> {
  return deepMergeInto(cloneObject(toolArgs), option.patch);
}

