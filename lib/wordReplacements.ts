import type { WordReplacement } from '@/lib/storage';

/** Apply project-wide literal or regular-expression replacements in order. */
export function applyWordReplacements(input: string, rules: WordReplacement[] = []): string {
  let output = input;
  for (const rule of rules) {
    if (!rule.replacement && rule.replacement !== '') continue;
    const variants = (rule.variants ?? []).map((value) => value.trim()).filter(Boolean);
    for (const variant of variants) {
      try {
        const pattern = rule.useRegex ? new RegExp(variant, 'g') : new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        output = output.replace(pattern, rule.replacement);
      } catch {
        // Ignore invalid regex patterns without breaking Reader rendering.
      }
    }
  }
  return output;
}
