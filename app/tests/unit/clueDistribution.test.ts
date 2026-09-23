import { describe, it, expect } from 'vitest';
import { Clue } from '../../src/features/murder-mystery/types/murder-mystery';
import {
  sortByTier,
  suggestTiming,
  getTimingDetails,
  recommendDistributionOrder,
  nextClueToDistribute,
  getCluesByTier,
  getDistributionProgress,
} from '../../src/features/murder-mystery/utils/clueDistribution';

const sampleClues: Clue[] = [
  { id: 'C3', title: 'Will', type: 'DOCUMENT', description: 'Modified will', found_by: 'Lawyer', tier: 3 },
  { id: 'C1', title: 'Poison Vial', type: 'PHYSICAL', description: 'Empty glass vial', found_by: 'Doctor', tier: 1 },
  { id: 'C2', title: 'Threatening Note', type: 'PERSONAL', description: 'Anonymous note', found_by: 'Socialite', tier: 2 },
];

describe('clueDistribution utility (app/tests/unit)', () => {
  it('sortByTier returns new array sorted by tier', () => {
    const sorted = sortByTier(sampleClues);
    expect(sorted.map(c => c.id)).toEqual(['C1', 'C2', 'C3']);
    expect(sampleClues.map(c => c.id)).toEqual(['C3', 'C1', 'C2']);
  });

  it('suggestTiming provides act recommendations per tier', () => {
    expect(suggestTiming(sampleClues[1])).toBe('Act I');
    expect(suggestTiming(sampleClues[2])).toBe('Act II early');
    expect(suggestTiming(sampleClues[0])).toBe('Act II late');
  });

  it('recommendDistributionOrder considers pacing', () => {
    const standard = recommendDistributionOrder(sampleClues, { pacing: 'standard' });
    expect(standard.map(c => c.id)).toEqual(['C1', 'C2', 'C3']);

    const fast = recommendDistributionOrder(sampleClues, { pacing: 'fast' });
    expect(fast.map(c => c.id)).toEqual(['C1', 'C3', 'C2']);
  });

  it('nextClueToDistribute finds next available clue', () => {
    expect(nextClueToDistribute(sampleClues, [])?.id).toBe('C1');
    expect(nextClueToDistribute(sampleClues, ['C1'])?.id).toBe('C2');
    expect(nextClueToDistribute(sampleClues, ['C1', 'C2', 'C3'])).toBeNull();
  });

  it('getDistributionProgress calculates percentage', () => {
    const progress = getDistributionProgress(sampleClues, ['C1']);
    expect(progress).toEqual({
      total: 3,
      distributed: 1,
      pending: 2,
      percentComplete: 33,
    });
  });
});
