import { describe, it, expect } from 'vitest';
import { Clue } from '../types/murder-mystery';
import {
  sortByTier,
  suggestTiming,
  getTimingDetails,
  recommendDistributionOrder,
  nextClueToDistribute,
  getCluesByTier,
  getDistributionProgress,
} from '../utils/clueDistribution';

const mockClues: Clue[] = [
  {
    id: 'C3',
    title: 'Bloodied Letter',
    type: 'DOCUMENT',
    description: 'A letter with blood stains',
    found_by: 'Butler',
    tier: 3,
  },
  {
    id: 'C1',
    title: 'Victim Diary',
    type: 'DOCUMENT',
    description: 'Diary entry mentioning debt',
    found_by: 'Socialite',
    tier: 1,
  },
  {
    id: 'C2',
    title: 'Shattered Glass',
    type: 'PHYSICAL',
    description: 'Glass found near the scene',
    found_by: 'Doctor',
    tier: 2,
  },
  {
    id: 'C4',
    title: 'Unmarked Key',
    type: 'PHYSICAL',
    description: 'A key fitting no lock in sight',
    found_by: 'Heir',
    // Missing tier - defaults to 2
  },
];

describe('clueDistribution utility', () => {
  describe('sortByTier', () => {
    it('sorts clues in ascending tier order (1 -> 2 -> 3)', () => {
      const sorted = sortByTier(mockClues);
      expect(sorted.map(c => c.id)).toEqual(['C1', 'C2', 'C4', 'C3']);
      expect(sorted[0].tier).toBe(1);
      expect(sorted[sorted.length - 1].tier).toBe(3);
    });

    it('does not mutate the original array', () => {
      const originalIds = mockClues.map(c => c.id);
      sortByTier(mockClues);
      expect(mockClues.map(c => c.id)).toEqual(originalIds);
    });

    it('handles tie-breaking deterministically for clues in the same tier', () => {
      const sameTierClues: Clue[] = [
        { id: 'B', title: 'Clue B', type: 'PHYSICAL', description: 'Desc B', found_by: 'X', tier: 1 },
        { id: 'A', title: 'Clue A', type: 'PHYSICAL', description: 'Desc A', found_by: 'Y', tier: 1 },
      ];
      const originalIds = sameTierClues.map(c => c.id);
      const sorted = sortByTier(sameTierClues);
      expect(sorted.map(c => c.id)).toEqual(['A', 'B']);
      expect(sameTierClues.map(c => c.id)).toEqual(originalIds);
    });

    it('handles empty and single-clue inputs without mutating the clue object', () => {
      const single: Clue = {
        id: 'ONLY',
        title: 'Only clue',
        type: 'DOCUMENT',
        description: 'One clue',
        found_by: 'Host',
        tier: 2,
      };
      const snapshot = { ...single };

      expect(sortByTier([])).toEqual([]);
      expect(sortByTier([single])).toEqual([single]);
      expect(single).toEqual(snapshot);
    });
  });

  describe('suggestTiming', () => {
    it('returns correct timing string for each tier number', () => {
      expect(suggestTiming(1)).toBe('Act I');
      expect(suggestTiming(2)).toBe('Act II early');
      expect(suggestTiming(3)).toBe('Act II late');
      expect(suggestTiming(undefined)).toBe('Act II early');
    });

    it('returns correct timing string when passed a Clue object', () => {
      expect(suggestTiming(mockClues[1])).toBe('Act I'); // C1 tier 1
      expect(suggestTiming(mockClues[2])).toBe('Act II early'); // C2 tier 2
      expect(suggestTiming(mockClues[0])).toBe('Act II late'); // C3 tier 3
      expect(suggestTiming(mockClues[3])).toBe('Act II early'); // C4 missing tier
    });
  });

  describe('getTimingDetails', () => {
    it('returns detailed metadata for tier 1', () => {
      const details = getTimingDetails(1);
      expect(details.act).toBe('Act I');
      expect(details.phase).toBe('Act I');
      expect(details.description).toContain('Early / Critical');
    });

    it('returns detailed metadata for tier 2', () => {
      const details = getTimingDetails(2);
      expect(details.act).toBe('Act II');
      expect(details.phase).toBe('Act II early');
      expect(details.description).toContain('narrowing suspect pool');
    });

    it('returns detailed metadata for tier 3', () => {
      const details = getTimingDetails(3);
      expect(details.act).toBe('Act II');
      expect(details.phase).toBe('Act II late');
      expect(details.description).toContain('decisive evidence');
    });
  });

  describe('recommendDistributionOrder', () => {
    it('recommends standard order (Tier 1 -> 2 -> 3) by default', () => {
      const recommended = recommendDistributionOrder(mockClues);
      expect(recommended.map(c => c.id)).toEqual(['C1', 'C2', 'C4', 'C3']);
    });

    it('prioritizes decisive tier 3 over tier 2 when pacing is fast', () => {
      const recommended = recommendDistributionOrder(mockClues, { pacing: 'fast' });
      // Tier priority: 1 -> 3 -> 2
      expect(recommended.map(c => c.id)).toEqual(['C1', 'C3', 'C2', 'C4']);
    });

    it('accelerates distribution for small player count (<= 5)', () => {
      const recommended = recommendDistributionOrder(mockClues, { playerCount: 4 });
      expect(recommended.map(c => c.id)).toEqual(['C1', 'C3', 'C2', 'C4']);
    });

    it('handles all-same-tier clues deterministically without mutating inputs', () => {
      const sameTierClues: Clue[] = [
        { id: 'Z', title: 'Zed', type: 'PHYSICAL', description: 'Z', found_by: 'A', tier: 2 },
        { id: 'M', title: 'Em', type: 'PHYSICAL', description: 'M', found_by: 'B', tier: 2 },
        { id: 'A', title: 'Ay', type: 'PHYSICAL', description: 'A', found_by: 'C', tier: 2 },
      ];
      const snapshot = sameTierClues.map(clue => ({ ...clue }));

      expect(recommendDistributionOrder(sameTierClues).map(c => c.id)).toEqual(['A', 'M', 'Z']);
      expect(recommendDistributionOrder(sameTierClues, { pacing: 'fast' }).map(c => c.id)).toEqual(['A', 'M', 'Z']);
      expect(sameTierClues).toEqual(snapshot);
    });

    it('handles empty and single-clue inputs safely', () => {
      const single = mockClues[1];
      expect(recommendDistributionOrder([])).toEqual([]);
      expect(recommendDistributionOrder([single])).toEqual([single]);
      expect(nextClueToDistribute([single], [])).toBe(single);
    });
  });

  describe('nextClueToDistribute', () => {
    it('returns top recommended clue when no clues have been distributed', () => {
      const next = nextClueToDistribute(mockClues, []);
      expect(next?.id).toBe('C1');
    });

    it('returns next recommended clue skipping already distributed ones', () => {
      const next = nextClueToDistribute(mockClues, ['C1']);
      expect(next?.id).toBe('C2');
    });

    it('returns null when all clues are distributed', () => {
      const next = nextClueToDistribute(mockClues, ['C1', 'C2', 'C3', 'C4']);
      expect(next).toBeNull();
    });

    it('returns null when clue list is empty', () => {
      const next = nextClueToDistribute([], []);
      expect(next).toBeNull();
    });
  });

  describe('getCluesByTier', () => {
    it('filters clues by specific tier', () => {
      const tier1Clues = getCluesByTier(mockClues, 1);
      expect(tier1Clues.length).toBe(1);
      expect(tier1Clues[0].id).toBe('C1');

      const tier2Clues = getCluesByTier(mockClues, 2);
      expect(tier2Clues.length).toBe(2); // C2 and C4 (missing tier defaults to 2)
    });
  });

  describe('getDistributionProgress', () => {
    it('calculates progress accurately', () => {
      const progress = getDistributionProgress(mockClues, ['C1', 'C2']);
      expect(progress.total).toBe(4);
      expect(progress.distributed).toBe(2);
      expect(progress.pending).toBe(2);
      expect(progress.percentComplete).toBe(50);
    });

    it('handles empty clue array safely', () => {
      const progress = getDistributionProgress([], []);
      expect(progress.total).toBe(0);
      expect(progress.percentComplete).toBe(0);
    });
  });
});
