import { contentFingerprint, eventFingerprint } from "../evidence.js";
import { sourceQualityHint } from "../signalScoring.js";
import type { RawEvidenceInput } from "./types.js";

/**
 * Deduplicates raw evidence items sharing the same event or text, preserving the highest credibility source.
 */
export function deduplicateEvidence(items: RawEvidenceInput[]): RawEvidenceInput[] {
  if (items.length <= 1) return items;

  const seenEvents = new Map<string, RawEvidenceInput>();
  const seenContent = new Map<string, RawEvidenceInput>();
  const uniqueItems: RawEvidenceInput[] = [];

  for (const item of items) {
    const efp = eventFingerprint(item.sourceTitle ?? undefined, item.eventDate ? String(item.eventDate) : undefined);
    const cfp = contentFingerprint(item.rawExcerpt);

    const score = sourceQualityHint(item.canonicalUrl ?? "", null);

    // Check duplicate event fingerprint
    if (efp) {
      const existing = seenEvents.get(efp);
      if (existing) {
        const existingScore = sourceQualityHint(existing.canonicalUrl ?? "", null);
        if (score > existingScore) {
          // Replace with higher credibility source
          const idx = uniqueItems.indexOf(existing);
          if (idx !== -1) uniqueItems[idx] = item;
          seenEvents.set(efp, item);
        }
        continue;
      }
      seenEvents.set(efp, item);
    }

    // Check duplicate content fingerprint
    if (cfp) {
      const existing = seenContent.get(cfp);
      if (existing) {
        const existingScore = sourceQualityHint(existing.canonicalUrl ?? "", null);
        if (score > existingScore) {
          const idx = uniqueItems.indexOf(existing);
          if (idx !== -1) uniqueItems[idx] = item;
          seenContent.set(cfp, item);
        }
        continue;
      }
      seenContent.set(cfp, item);
    }

    uniqueItems.push(item);
  }

  return uniqueItems;
}
