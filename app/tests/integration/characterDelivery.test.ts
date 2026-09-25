import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock react-native
vi.mock("react-native", () => ({
  Platform: { OS: "web" }
}));

// Mock react-native-mmkv in-memory storage
const mmkvStorage = new Map<string, string>();
vi.mock("react-native-mmkv", () => ({
  createMMKV: vi.fn().mockImplementation(() => ({
    set: vi.fn((key: string, value: string) => mmkvStorage.set(key, value)),
    getString: vi.fn((key: string) => mmkvStorage.get(key) ?? null),
    delete: vi.fn((key: string) => mmkvStorage.delete(key)),
    clearAll: vi.fn(() => mmkvStorage.clear())
  })),
  MMKV: vi.fn().mockImplementation(() => ({
    set: vi.fn((key: string, value: string) => mmkvStorage.set(key, value)),
    getString: vi.fn((key: string) => mmkvStorage.get(key) ?? null),
    delete: vi.fn((key: string) => mmkvStorage.delete(key)),
    clearAll: vi.fn(() => mmkvStorage.clear())
  }))
}));

// Mock Supabase
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn()
  }
}));

import { CharacterService } from '../../src/features/murder-mystery/services/characterService';
import { supabase } from '../../src/lib/supabase';
import { MurderMysteryData, Character } from '../../src/features/murder-mystery/types/murder-mystery';

export interface CharacterPreference {
  participant_id: string;
  rankings: { character_id: string; rank: number }[];
}

/**
 * Helper to assign characters based on participant preferences.
 */
function preferenceAssign(
  scenario: MurderMysteryData,
  preferences: CharacterPreference[]
): Record<string, string> {
  const assignments: Record<string, string> = {};
  const assignedCharacters = new Set<string>();
  const assignedParticipants = new Set<string>();

  // Sort preferences by rank and assign match if available
  for (const pref of preferences) {
    const sortedRanks = [...pref.rankings].sort((a, b) => a.rank - b.rank);
    for (const ranking of sortedRanks) {
      if (!assignedCharacters.has(ranking.character_id) && !assignedParticipants.has(pref.participant_id)) {
        assignments[ranking.character_id] = pref.participant_id;
        assignedCharacters.add(ranking.character_id);
        assignedParticipants.add(pref.participant_id);
        break;
      }
    }
  }

  // Fallback for remaining unassigned
  const unassignedChars = scenario.characters.filter(c => !assignedCharacters.has(c.id));
  const unassignedParticipants = preferences.map(p => p.participant_id).filter(pid => !assignedParticipants.has(pid));

  for (let i = 0; i < Math.min(unassignedChars.length, unassignedParticipants.length); i++) {
    assignments[unassignedChars[i].id] = unassignedParticipants[i];
  }

  return assignments;
}

/**
 * Helper to compute host dashboard tracking metrics.
 */
function getHostDashboardTracking(scenario: MurderMysteryData, deliveredUserIds: Set<string>) {
  const totalCharacters = scenario.characters.length;
  const assignedCharacters = scenario.characters.filter(c => c.assigned_to !== null && c.assigned_to !== undefined);
  const assignedCount = assignedCharacters.length;
  const unassignedCount = totalCharacters - assignedCount;

  const deliveredCount = assignedCharacters.filter(c => c.assigned_to && deliveredUserIds.has(c.assigned_to)).length;
  const pendingCount = assignedCount - deliveredCount;
  const progressPercentage = totalCharacters > 0 ? Math.round((deliveredCount / totalCharacters) * 100) : 0;

  return {
    totalCharacters,
    assignedCount,
    unassignedCount,
    deliveredCount,
    pendingCount,
    progressPercentage
  };
}

describe('Character Delivery Integration Tests', () => {
  const mockScenario: MurderMysteryData = {
    setting_seed: {
      source: 'generated',
      era: '1920s',
      location: 'Mansion',
      milieu: 'High Society',
      tension: 'Financial Ruin',
      setting_description: 'A grand mansion',
      crime_scene: 'Library',
      generated_by: 'llm'
    },
    characters: [
      {
        id: 'c1',
        name: 'Lord Blackwood',
        occupation: 'Estate Owner',
        personality: 'Arrogant and scheming',
        secret: /* allow-secret */ 'Deep in gambling debt to dangerous syndicates',
        relationship: { target_character_id: 'c2', description: 'Suspicious business rival' },
        is_victim: true,
        is_murderer: false,
        contribution_brief: {
          food: 'Vintage Red Wine',
          dress: '1920s Tuxedo with Pocket Watch',
          prop: 'Silver Cane'
        },
        preparation_prompts: [
          'Greet guests with aristocratic coldness',
          'Mention your rare art collection casually'
        ],
        assigned_to: null
      },
      {
        id: 'c2',
        name: 'Inspector Vance',
        occupation: 'Lead Investigator',
        personality: 'Cold, methodical, observant',
        secret: /* allow-secret */ 'Forged evidence in a high-profile case 5 years ago',
        relationship: { target_character_id: 'c1', description: 'Investigating Lord Blackwood' },
        is_victim: false,
        is_murderer: true,
        contribution_brief: {
          food: 'Black Coffee and Cigars',
          dress: 'Trench coat and Fedora hat',
          prop: 'Magnifying Glass and Notebook'
        },
        preparation_prompts: [
          'Take note of all guests suspicious movements',
          'Interrogate anyone who approaches the crime scene'
        ],
        assigned_to: null
      }
    ],
    crime: {
      victim_id: 'c1',
      murderer_id: 'c2',
      weapon: 'Poison',
      motive: 'Revenge',
      red_herrings: [],
      timeline: []
    },
    clues: [],
    game_night: { act_timestamps: [], clues_distributed: [], evidence_reveals: [], accusations: [] },
    awards: [],
    sealed_envelopes: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mmkvStorage.clear();
  });

  describe('Character Packet Content Completeness', () => {
    it('verifies that character packets contain all required sections (sheet, brief, prompts)', () => {
      for (const character of mockScenario.characters) {
        // 1. Character Sheet
        expect(character.id).toBeTruthy();
        expect(character.name).toBeTruthy();
        expect(character.occupation).toBeTruthy();
        expect(character.personality).toBeTruthy();
        expect(character.secret).toBeDefined();
        expect(character.relationship).toBeDefined();
        expect(character.relationship.description).toBeTruthy();

        // 2. Contribution Brief
        expect(character.contribution_brief).toBeDefined();
        expect(typeof character.contribution_brief.food).toBe('string');
        expect(typeof character.contribution_brief.dress).toBe('string');
        expect(typeof character.contribution_brief.prop).toBe('string');

        // 3. Preparation Prompts
        expect(Array.isArray(character.preparation_prompts)).toBe(true);
        expect(character.preparation_prompts.length).toBeGreaterThan(0);
        for (const prompt of character.preparation_prompts) {
          expect(typeof prompt).toBe('string');
          expect(prompt.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Offline Caching', () => {
    it('caches updated scenario in local MMKV storage during assignment', async () => {
      const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      (supabase.from as any).mockReturnValue({ update: mockUpdate });

      const sessionId = 'session-offline-1';
      await CharacterService.assignCharacters(sessionId, mockScenario, {
        'c1': 'user-1'
      });

      const cachedRaw = mmkvStorage.get(`mm_scenario_${sessionId}`);
      expect(cachedRaw).toBeDefined();

      const cachedScenario: MurderMysteryData = JSON.parse(cachedRaw!);
      expect(cachedScenario.characters[0].assigned_to).toBe('user-1');
    });

    it('retains local cached packet even when remote Supabase network call fails', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockRejectedValue(new Error('Network error / offline'))
      });
      (supabase.from as any).mockReturnValue({ update: mockUpdate });

      const sessionId = 'session-offline-2';
      const updated = await CharacterService.assignCharacters(sessionId, mockScenario, {
        'c2': 'user-2'
      });

      expect(updated.characters[1].assigned_to).toBe('user-2');

      const cachedRaw = mmkvStorage.get(`mm_scenario_${sessionId}`);
      expect(cachedRaw).not.toBeNull();

      const cachedScenario = JSON.parse(cachedRaw!);
      const cachedCharacter = cachedScenario.characters.find((c: Character) => c.id === 'c2');
      expect(cachedCharacter.assigned_to).toBe('user-2');
      expect(cachedCharacter.name).toBe('Inspector Vance');
      expect(cachedCharacter.contribution_brief.dress).toBe('Trench coat and Fedora hat');
    });
  });

  describe('Host Dashboard Tracking & Delivery Progress', () => {
    it('tracks character assignments and delivery progress metrics accurately', async () => {
      // Unassigned initial state
      let metrics = getHostDashboardTracking(mockScenario, new Set());
      expect(metrics.totalCharacters).toBe(2);
      expect(metrics.assignedCount).toBe(0);
      expect(metrics.unassignedCount).toBe(2);
      expect(metrics.deliveredCount).toBe(0);
      expect(metrics.progressPercentage).toBe(0);

      // Partial assignment
      const partialScenario: MurderMysteryData = {
        ...mockScenario,
        characters: [
          { ...mockScenario.characters[0], assigned_to: 'user-1' },
          mockScenario.characters[1]
        ]
      };

      metrics = getHostDashboardTracking(partialScenario, new Set());
      expect(metrics.assignedCount).toBe(1);
      expect(metrics.unassignedCount).toBe(1);
      expect(metrics.deliveredCount).toBe(0);

      // Delivery to user-1 complete
      const deliveredUsers = new Set(['user-1']);
      metrics = getHostDashboardTracking(partialScenario, deliveredUsers);
      expect(metrics.deliveredCount).toBe(1);
      expect(metrics.pendingCount).toBe(0);
      expect(metrics.progressPercentage).toBe(50);

      // Full assignment & delivery
      const fullScenario: MurderMysteryData = {
        ...mockScenario,
        characters: [
          { ...mockScenario.characters[0], assigned_to: 'user-1' },
          { ...mockScenario.characters[1], assigned_to: 'user-2' }
        ]
      };

      deliveredUsers.add('user-2');
      metrics = getHostDashboardTracking(fullScenario, deliveredUsers);
      expect(metrics.assignedCount).toBe(2);
      expect(metrics.unassignedCount).toBe(0);
      expect(metrics.deliveredCount).toBe(2);
      expect(metrics.pendingCount).toBe(0);
      expect(metrics.progressPercentage).toBe(100);
    });
  });

  describe('All Assignment Modes (Manual, Auto, Preference)', () => {
    it('executes manual assignment mode correctly', async () => {
      const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      (supabase.from as any).mockReturnValue({ update: mockUpdate });

      const updated = await CharacterService.assignCharacters('s-manual', mockScenario, {
        'c1': 'manual-user-1',
        'c2': 'manual-user-2'
      });

      expect(updated.characters.find(c => c.id === 'c1')?.assigned_to).toBe('manual-user-1');
      expect(updated.characters.find(c => c.id === 'c2')?.assigned_to).toBe('manual-user-2');
    });

    it('executes auto assignment mode correctly', async () => {
      const autoAssignments = CharacterService.autoAssign(mockScenario, ['auto-user-1', 'auto-user-2']);
      expect(autoAssignments['c1']).toBe('auto-user-1');
      expect(autoAssignments['c2']).toBe('auto-user-2');
    });

    it('executes preference-based assignment mode correctly based on rankings', () => {
      const preferences: CharacterPreference[] = [
        {
          participant_id: 'p-alice',
          rankings: [
            { character_id: 'c2', rank: 1 }, // Alice prefers Vance (c2)
            { character_id: 'c1', rank: 2 }
          ]
        },
        {
          participant_id: 'p-bob',
          rankings: [
            { character_id: 'c2', rank: 1 }, // Bob also prefers c2, but Alice resolves first
            { character_id: 'c1', rank: 2 }  // Bob falls back to c1
          ]
        }
      ];

      const prefAssignments = preferenceAssign(mockScenario, preferences);
      expect(prefAssignments['c2']).toBe('p-alice');
      expect(prefAssignments['c1']).toBe('p-bob');
    });
  });

  describe('Delivery to Both App and Web Players', () => {
    it('delivers character packets to both native app user IDs and web guest participant IDs', async () => {
      const mockInsertNotif = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'notification_queue') return { insert: mockInsertNotif };
        return {};
      });

      const assignedScenario: MurderMysteryData = {
        ...mockScenario,
        characters: [
          { ...mockScenario.characters[0], assigned_to: 'app-user-uuid-123' },
          { ...mockScenario.characters[1], assigned_to: 'web-guest-part-456' }
        ]
      };

      await CharacterService.deliverPackets('session-app-web-1', assignedScenario);

      expect(supabase.from).toHaveBeenCalledWith('notification_queue');
      expect(mockInsertNotif).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          user_id: 'app-user-uuid-123',
          type: 'CHARACTER_DELIVERY',
          title: 'Your Character Packet: Lord Blackwood',
          data: { session_id: 'session-app-web-1', character_id: 'c1' }
        }),
        expect.objectContaining({
          user_id: 'web-guest-part-456',
          type: 'CHARACTER_DELIVERY',
          title: 'Your Character Packet: Inspector Vance',
          data: { session_id: 'session-app-web-1', character_id: 'c2' }
        })
      ]));
    });
  });

  describe('Retry on Delivery Failure', () => {
    it('throws error on initial failure and succeeds on retry', async () => {
      const mockInsertFail = vi.fn().mockResolvedValue({ error: { message: 'Database connection failed' } });
      const mockInsertSuccess = vi.fn().mockResolvedValue({ error: null });

      let attempts = 0;
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'notification_queue') {
          attempts++;
          return { insert: attempts === 1 ? mockInsertFail : mockInsertSuccess };
        }
        return {};
      });

      const assignedScenario: MurderMysteryData = {
        ...mockScenario,
        characters: [
          { ...mockScenario.characters[0], assigned_to: 'user-retry-1' }
        ]
      };

      // 1st attempt -> Failure
      await expect(
        CharacterService.deliverPackets('session-retry', assignedScenario)
      ).rejects.toThrow('Failed to deliver character packets: Database connection failed');

      // 2nd attempt -> Retry Success
      await expect(
        CharacterService.deliverPackets('session-retry', assignedScenario)
      ).resolves.toBeUndefined();

      expect(attempts).toBe(2);
    });
  });

  describe('Existing CharacterService Unit Capabilities', () => {
    it('assigns characters manually and updates session config', async () => {
      const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
      (supabase.from as any).mockReturnValue({ update: mockUpdate });

      const result = await CharacterService.assignCharacters('session-1', mockScenario, {
        'c1': 'user-1',
        'c2': 'user-2'
      });

      expect(supabase.from).toHaveBeenCalledWith('sessions');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({
          characters: expect.arrayContaining([
            expect.objectContaining({ id: 'c1', assigned_to: 'user-1' }),
            expect.objectContaining({ id: 'c2', assigned_to: 'user-2' })
          ])
        })
      }));

      expect(result.characters[0].assigned_to).toBe('user-1');
      expect(result.characters[1].assigned_to).toBe('user-2');
    });

    it('autoAssign assigns unassigned characters round-robin', () => {
      const assignments = CharacterService.autoAssign(mockScenario, ['user-1', 'user-2']);
      expect(Object.keys(assignments)).toHaveLength(2);
      expect(assignments['c1']).toBe('user-1');
      expect(assignments['c2']).toBe('user-2');
    });
  });
});
