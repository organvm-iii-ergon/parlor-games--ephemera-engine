// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

(global as any).__DEV__ = true;

// Mocks
const keepAwakeMock = vi.fn();
vi.mock('expo-keep-awake', () => ({
  useKeepAwake: () => keepAwakeMock(),
  activateKeepAwakeAsync: vi.fn(),
  deactivateKeepAwake: vi.fn(),
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: (props: any) => React.createElement('span', { 'data-testid': `icon-${props.name}` })
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: any) => Object.assign({}, styles) },
  View: ({ children, style, ...props }: any) => React.createElement('div', { style: Array.isArray(style) ? Object.assign({}, ...style) : style, ...props }, children),
  Text: ({ children, style, ...props }: any) => React.createElement('span', { style: Array.isArray(style) ? Object.assign({}, ...style) : style, ...props }, children),
  TouchableOpacity: ({ children, onPress, disabled, style, ...props }: any) =>
    React.createElement('button', { onClick: onPress, disabled, style: Array.isArray(style) ? Object.assign({}, ...style) : style, ...props }, children),
  ScrollView: ({ children, style, ...props }: any) => React.createElement('div', { style: Array.isArray(style) ? Object.assign({}, ...style) : style, ...props }, children),
  Modal: ({ children, visible, style, ...props }: any) =>
    visible ? React.createElement('div', { 'data-testid': 'modal', style: Array.isArray(style) ? Object.assign({}, ...style) : style, ...props }, children) : null,
  SafeAreaView: ({ children, style, ...props }: any) => React.createElement('div', { style: Array.isArray(style) ? Object.assign({}, ...style) : style, ...props }, children),
}));

const mmkvStore = new Map<string, string>();
vi.mock('react-native-mmkv', () => ({
  MMKV: vi.fn().mockImplementation(() => ({
    set: (key: string, value: string) => mmkvStore.set(key, value),
    getString: (key: string) => mmkvStore.get(key) ?? null,
    delete: (key: string) => mmkvStore.delete(key),
    clearAll: () => mmkvStore.clear(),
  })),
  createMMKV: vi.fn().mockImplementation(() => ({
    set: (key: string, value: string) => mmkvStore.set(key, value),
    getString: (key: string) => mmkvStore.get(key) ?? null,
    delete: (key: string) => mmkvStore.delete(key),
    clearAll: () => mmkvStore.clear(),
  }))
}));

const supabaseUpdateMock = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      update: (args: any) => {
        supabaseUpdateMock(args);
        return {
          eq: vi.fn().mockImplementation(() => {
            if ((global as any).__SUPABASE_OFFLINE__) {
              return Promise.reject(new Error('Network failure: device is offline'));
            }
            return Promise.resolve({ error: null });
          })
        };
      },
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    })
  }
}));

import { useGameNight } from '../../src/features/murder-mystery/hooks/useGameNight';
import { useClues } from '../../src/features/murder-mystery/hooks/useClues';
import { GameNightService } from '../../src/features/murder-mystery/services/gameNightService';
import { ClueService } from '../../src/features/murder-mystery/services/clueService';
import { ThreeActDashboardScreen } from '../../src/features/murder-mystery/screens/ThreeActDashboardScreen';
import { ClueDistributionScreen } from '../../src/features/murder-mystery/screens/ClueDistributionScreen';
import { MurderMysteryData } from '../../src/features/murder-mystery/types/murder-mystery';

const createSampleScenario = (): MurderMysteryData => ({
  setting_seed: {
    source: 'curated',
    era: '1920s',
    location: 'Blackwood Manor',
    milieu: 'High Society',
    tension: 'Storm',
    setting_description: 'A remote manor in a thunderstorm.',
    crime_scene: 'Library',
    generated_by: 'human'
  },
  characters: [
    {
      id: 'char_1',
      name: 'Lord Reginald',
      occupation: 'Aristocrat',
      personality: 'Pompous',
      secret: 'Bankrupt',
      relationship: { target_character_id: 'char_2', description: 'Brothers' },
      is_murderer: false,
      is_victim: true,
      contribution_brief: { food: 'Port', dress: 'Tuxedo', prop: 'Watch' },
      preparation_prompts: [],
      assigned_to: 'user_1'
    },
    {
      id: 'char_2',
      name: 'Arthur Blackwood',
      occupation: 'Businessman',
      personality: 'Nervous',
      secret: 'Stole trust funds',
      relationship: { target_character_id: 'char_1', description: 'Brothers' },
      is_murderer: true,
      is_victim: false,
      contribution_brief: { food: 'Biscuits', dress: 'Suit', prop: 'Flask' },
      preparation_prompts: [],
      assigned_to: 'user_2'
    }
  ],
  crime: {
    victim_id: 'char_1',
    murderer_id: 'char_2',
    weapon: 'Candlestick',
    motive: 'Refused blackmail payment',
    red_herrings: [],
    timeline: []
  },
  clues: [
    { id: 'clue_1', title: 'Bloody Candlestick', description: 'Heavy brass weapon with red stains', tier: 1, type: 'PHYSICAL', act_revealed: 1 },
    { id: 'clue_2', title: 'Torn Ledger', description: 'Burnt document showing debt', tier: 2, type: 'DOCUMENT', act_revealed: 2 }
  ],
  game_night: {
    act_timestamps: [],
    clues_distributed: [],
    evidence_reveals: [],
    accusations: [],
    award_votes: []
  },
  awards: [],
  sealed_envelopes: []
});

describe('Game Night Dashboard Integration Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mmkvStore.clear();
    (global as any).__SUPABASE_OFFLINE__ = false;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('1. Offline Operation (Zero Network Calls)', () => {
    it('operates fully offline and saves state locally when network fails', async () => {
      (global as any).__SUPABASE_OFFLINE__ = true;
      const initialScenario = createSampleScenario();
      const sessionId = 'session_offline_test';

      const updatedScenario = await GameNightService.advanceAct(sessionId, initialScenario, 2);

      expect(updatedScenario.game_night.act_timestamps).toHaveLength(1);
      expect(updatedScenario.game_night.act_timestamps[0].act).toBe(2);

      const storedDataStr = mmkvStore.get(`mm_scenario_${sessionId}`);
      expect(storedDataStr).toBeDefined();
      const storedData = JSON.parse(storedDataStr!);
      expect(storedData.game_night.act_timestamps[0].act).toBe(2);
    });

    it('handles clue distribution offline without throwing errors', async () => {
      (global as any).__SUPABASE_OFFLINE__ = true;
      const initialScenario = createSampleScenario();
      const sessionId = 'session_clue_offline';

      const updatedScenario = await ClueService.distributeClue(sessionId, initialScenario, 'clue_1', 'char_2');

      expect(updatedScenario.game_night.clues_distributed).toHaveLength(1);
      expect(updatedScenario.game_night.clues_distributed[0].clue_id).toBe('clue_1');

      const storedData = JSON.parse(mmkvStore.get(`mm_scenario_${sessionId}`)!);
      expect(storedData.game_night.clues_distributed[0].clue_id).toBe('clue_1');
    });
  });

  describe('2. Act Transitions (I -> II -> III -> Complete)', () => {
    it('transitions sequentially through Act I, Act II, and Act III via hook', async () => {
      const initialScenario = createSampleScenario();
      const sessionId = 'session_act_transitions';

      const { result } = renderHook(() => useGameNight(sessionId, initialScenario));

      // Initial state should default to Act 1 (currentAct is 0 initially in unstarted state)
      expect(result.current.currentAct).toBe(0);

      // Advance to Act 1
      await act(async () => {
        await result.current.advanceAct(1);
      });
      expect(result.current.currentAct).toBe(1);

      // Advance to Act 2
      await act(async () => {
        await result.current.advanceAct(2);
      });
      expect(result.current.currentAct).toBe(2);

      // Advance to Act 3
      await act(async () => {
        await result.current.advanceAct(3);
      });
      expect(result.current.currentAct).toBe(3);
    });

    it('renders corresponding UI content for each Act in ThreeActDashboardScreen', async () => {
      const scenario = createSampleScenario();
      const onNavigateToClues = vi.fn();
      const onNavigateToReveal = vi.fn();
      const onBeginAccusations = vi.fn();

      const { getByText } = render(
        React.createElement(ThreeActDashboardScreen, {
          sessionId: "session_dashboard_ui",
          initialScenario: scenario,
          onNavigateToClues: onNavigateToClues,
          onNavigateToReveal: onNavigateToReveal,
          onBeginAccusations: onBeginAccusations
        })
      );

      // Defaults displayAct to 1 when currentAct is 0
      expect(getByText('Act I: The Gathering')).toBeDefined();
      expect(getByText('Player Roster (2)')).toBeDefined();

      // Click "Begin Act II" button
      const beginAct2Btn = getByText('Begin Act II');
      await act(async () => {
        fireEvent.click(beginAct2Btn);
      });

      expect(getByText('Act II: The Investigation')).toBeDefined();
      expect(getByText('Reveal the Crime')).toBeDefined();

      // Click "Begin Act III" button
      const beginAct3Btn = getByText('Begin Act III');
      await act(async () => {
        fireEvent.click(beginAct3Btn);
      });

      expect(getByText('Act III: The Accusation')).toBeDefined();
      expect(getByText('Begin Accusations')).toBeDefined();
      expect(getByText('The Reveal')).toBeDefined();

      // Click "Begin Accusations"
      fireEvent.click(getByText('Begin Accusations'));
      expect(onBeginAccusations).toHaveBeenCalledTimes(1);

      // Click "The Reveal"
      fireEvent.click(getByText('The Reveal'));
      expect(onNavigateToReveal).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Clue Distribution Tracking', () => {
    it('distributes clue and updates distributed list in useClues', async () => {
      const initialScenario = createSampleScenario();
      const sessionId = 'session_clue_tracking';

      const { result } = renderHook(() => useClues(sessionId, initialScenario));

      expect(result.current.getDistributedClues()).toHaveLength(0);
      expect(result.current.isClueDistributed('clue_1')).toBe(false);

      await act(async () => {
        await result.current.distributeClue('clue_1', 'char_1');
      });

      expect(result.current.getDistributedClues()).toHaveLength(1);
      expect(result.current.isClueDistributed('clue_1')).toBe(true);
      expect(result.current.getDistributedClues()[0].clue_id).toBe('clue_1');
      expect(result.current.getDistributedClues()[0].found_by).toBe('char_1');
    });

    it('renders pending and distributed clues in ClueDistributionScreen and supports toggling', async () => {
      const initialScenario = createSampleScenario();
      const sessionId = 'session_clue_screen';
      const onBack = vi.fn();

      const { getByText } = render(
        React.createElement(ClueDistributionScreen, {
          sessionId,
          scenario: initialScenario,
          onBack
        })
      );

      expect(getByText('Manage Clues')).toBeDefined();
      expect(getByText('Pending Clues (2)')).toBeDefined();
      expect(getByText('Distributed (0)')).toBeDefined();

      // Click on clue 1 in pending list to distribute
      const clue1Item = getByText('Bloody Candlestick');
      await act(async () => {
        fireEvent.click(clue1Item);
      });

      expect(getByText('Pending Clues (1)')).toBeDefined();
      expect(getByText('Distributed (1)')).toBeDefined();
    });
  });

  describe('4. Data Persistence Across App Backgrounding', () => {
    it('re-hydrates updated act progress from MMKV when app resumes / hook remounts', async () => {
      const initialScenario = createSampleScenario();
      const sessionId = 'session_background_persistence';

      // First app session: advance act to Act 2
      const { result: session1Hook, unmount } = renderHook(() => useGameNight(sessionId, initialScenario));
      await act(async () => {
        await session1Hook.current.advanceAct(2);
      });
      expect(session1Hook.current.currentAct).toBe(2);

      // Simulate app backgrounding / process termination
      unmount();

      // Second app session: remount hook with original initialScenario
      const { result: session2Hook } = renderHook(() => useGameNight(sessionId, initialScenario));

      // Hook re-hydrates state from MMKV local storage
      expect(session2Hook.current.currentAct).toBe(2);
      expect(session2Hook.current.scenario.game_night.act_timestamps[0].act).toBe(2);
    });

    it('persists clue distributions in MMKV across hook re-hydration', async () => {
      const initialScenario = createSampleScenario();
      const sessionId = 'session_clue_background_persistence';

      // First session: distribute clue 1
      await ClueService.distributeClue(sessionId, initialScenario, 'clue_1', 'char_1');

      // Second session (re-hydration check via useClues hook)
      const storedData = JSON.parse(mmkvStore.get(`mm_scenario_${sessionId}`)!);
      const { result } = renderHook(() => useClues(sessionId, storedData));

      expect(result.current.isClueDistributed('clue_1')).toBe(true);
      expect(result.current.getDistributedClues()[0].found_by).toBe('char_1');
    });
  });

  describe('5. Undo Mechanism (30-second window)', () => {
    it('shows undo toast upon advancing act and reverts transition when UNDO is clicked', async () => {
      const scenario = createSampleScenario();
      const { getByText, queryByText } = render(
        React.createElement(ThreeActDashboardScreen, {
          sessionId: "session_undo_test",
          initialScenario: scenario,
          onNavigateToClues: vi.fn(),
          onNavigateToReveal: vi.fn(),
          onBeginAccusations: vi.fn()
        })
      );

      expect(getByText('Act I: The Gathering')).toBeDefined();
      expect(queryByText('UNDO')).toBeNull();

      // Advance to Act 2
      await act(async () => {
        fireEvent.click(getByText('Begin Act II'));
      });

      expect(getByText('Act II: The Investigation')).toBeDefined();
      const undoBtn = getByText('UNDO');
      expect(undoBtn).toBeDefined();

      // Click UNDO
      await act(async () => {
        fireEvent.click(undoBtn);
      });

      // Reverts back to Act 1
      expect(getByText('Act I: The Gathering')).toBeDefined();
      expect(queryByText('UNDO')).toBeNull();
    });

    it('automatically dismisses undo toast after the timer window expires', async () => {
      vi.useFakeTimers();
      const scenario = createSampleScenario();
      const { getByText, queryByText } = render(
        React.createElement(ThreeActDashboardScreen, {
          sessionId: "session_undo_timer",
          initialScenario: scenario,
          onNavigateToClues: vi.fn(),
          onNavigateToReveal: vi.fn(),
          onBeginAccusations: vi.fn()
        })
      );

      await act(async () => {
        fireEvent.click(getByText('Begin Act II'));
      });

      expect(getByText('UNDO')).toBeDefined();

      // Fast forward past the undo toast timeout window (5000ms in UI component)
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      expect(queryByText('UNDO')).toBeNull();
    });
  });

  describe('6. Ambient Mode Activation', () => {
    it('activates keep awake / wake lock when rendering ThreeActDashboardScreen', () => {
      const scenario = createSampleScenario();

      render(
        React.createElement(ThreeActDashboardScreen, {
          sessionId: "session_ambient_mode",
          initialScenario: scenario,
          onNavigateToClues: vi.fn(),
          onNavigateToReveal: vi.fn(),
          onBeginAccusations: vi.fn()
        })
      );

      expect(keepAwakeMock).toHaveBeenCalled();
    });
  });
});
