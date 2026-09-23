import { Clue } from '../types/murder-mystery';

export interface DistributionOptions {
  playerCount?: number;
  pacing?: 'slow' | 'standard' | 'fast';
}

export interface TimingDetails {
  act: string;
  phase: 'Act I' | 'Act II early' | 'Act II late';
  description: string;
}

const DEFAULT_TIER = 2;

/**
 * Pure utility function to sort clues by tier ascending (Tier 1 = early/critical, Tier 3 = late/supplementary).
 * Tie-breaks deterministically by clue ID or title. Does not mutate the input array.
 */
export function sortByTier(clues: Clue[]): Clue[] {
  return [...clues].sort((a, b) => {
    const tierA = a.tier ?? DEFAULT_TIER;
    const tierB = b.tier ?? DEFAULT_TIER;

    if (tierA !== tierB) {
      return tierA - tierB;
    }

    // Secondary deterministic sort by ID or title
    return (a.id || a.title || '').localeCompare(b.id || b.title || '');
  });
}

/**
 * Returns suggested distribution timing string for a given clue or tier number.
 * Tier 1 -> Act I (Early/Critical)
 * Tier 2 -> Act II early (Suspect Pool Narrowing)
 * Tier 3 -> Act II late (Decisive / Supplementary)
 */
export function suggestTiming(clueOrTier: Clue | number | undefined): string {
  const tier = typeof clueOrTier === 'object' && clueOrTier !== null
    ? clueOrTier.tier
    : clueOrTier;

  switch (tier) {
    case 1:
      return 'Act I';
    case 2:
      return 'Act II early';
    case 3:
      return 'Act II late';
    default:
      return 'Act II early';
  }
}

/**
 * Returns detailed timing metadata for a given clue or tier number.
 */
export function getTimingDetails(clueOrTier: Clue | number | undefined): TimingDetails {
  const tier = typeof clueOrTier === 'object' && clueOrTier !== null
    ? clueOrTier.tier
    : clueOrTier;

  switch (tier) {
    case 1:
      return {
        act: 'Act I',
        phase: 'Act I',
        description: 'Early / Critical clues establishing relationships and initial suspicion'
      };
    case 2:
      return {
        act: 'Act II',
        phase: 'Act II early',
        description: 'Mid-game clues narrowing suspect pool and revealing motives'
      };
    case 3:
      return {
        act: 'Act II',
        phase: 'Act II late',
        description: 'Late / Supplementary decisive evidence for final accusations'
      };
    default:
      return {
        act: 'Act II',
        phase: 'Act II early',
        description: 'General evidence distribution'
      };
  }
}

/**
 * Recommends distribution order for clues based on tier, player count, and pacing.
 * - Standard: Tier 1 -> Tier 2 -> Tier 3
 * - Fast (or small player count <= 5): Prioritizes Tier 1 (critical) and Tier 3 (decisive evidence) over Tier 2 (red herrings)
 * - Slow: Standard tier progression with even staggering
 * Does not mutate input array.
 */
export function recommendDistributionOrder(
  clues: Clue[],
  options: DistributionOptions = {}
): Clue[] {
  const { playerCount, pacing = 'standard' } = options;

  const isAccelerated = pacing === 'fast' || (playerCount !== undefined && playerCount <= 5);

  if (isAccelerated) {
    return [...clues].sort((a, b) => {
      const tierA = a.tier ?? DEFAULT_TIER;
      const tierB = b.tier ?? DEFAULT_TIER;

      // Accelerated priority order: Tier 1 -> Tier 3 -> Tier 2
      const priorityMap: Record<number, number> = { 1: 1, 3: 2, 2: 3 };
      const priorityA = priorityMap[tierA] ?? 3;
      const priorityB = priorityMap[tierB] ?? 3;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      return (a.id || a.title || '').localeCompare(b.id || b.title || '');
    });
  }

  return sortByTier(clues);
}

/**
 * Finds the next recommended clue to distribute among clues not yet in distributedClueIds.
 * Returns null if all clues are distributed or clues list is empty.
 */
export function nextClueToDistribute(
  clues: Clue[],
  distributedClueIds: string[],
  options: DistributionOptions = {}
): Clue | null {
  const distributedSet = new Set(distributedClueIds);
  const pendingClues = clues.filter(clue => !distributedSet.has(clue.id));

  if (pendingClues.length === 0) {
    return null;
  }

  const recommendedOrder = recommendDistributionOrder(pendingClues, options);
  return recommendedOrder[0] || null;
}

/**
 * Helper to filter clues by a specific tier (1, 2, or 3).
 */
export function getCluesByTier(clues: Clue[], tier: 1 | 2 | 3): Clue[] {
  return clues.filter(c => (c.tier ?? DEFAULT_TIER) === tier);
}

/**
 * Helper to calculate clue distribution progress stats.
 */
export function getDistributionProgress(
  clues: Clue[],
  distributedClueIds: string[]
): { total: number; distributed: number; pending: number; percentComplete: number } {
  const total = clues.length;
  const distributedSet = new Set(distributedClueIds);
  const distributed = clues.filter(c => distributedSet.has(c.id)).length;
  const pending = total - distributed;
  const percentComplete = total > 0 ? Math.round((distributed / total) * 100) : 0;

  return { total, distributed, pending, percentComplete };
}
