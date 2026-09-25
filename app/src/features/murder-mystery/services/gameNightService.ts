import { supabase } from '../../../lib/supabase';
import { MurderMysteryData, GameNightState } from '../types/murder-mystery';
import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV();

export class GameNightService {
  /**
   * Advances the game to the next Act (or reverts to a previous Act).
   * Uses offline-first writes: saves to MMKV first, then attempts to sync with Supabase.
   */
  static async advanceAct(
    sessionId: string,
    scenario: MurderMysteryData,
    newAct: number
  ): Promise<MurderMysteryData> {
    const actTimestamp = { act: newAct, started_at: new Date().toISOString() };
    
    // Ensure game_night object exists
    const currentGameNight = scenario.game_night || {
      act_timestamps: [],
      clues_distributed: [],
      evidence_reveals: [],
      accusations: []
    };

    // Filter out acts greater than or equal to newAct to support undo/reverting to earlier acts
    const updatedGameNight: GameNightState = {
      ...currentGameNight,
      act_timestamps: [
        ...currentGameNight.act_timestamps.filter(a => a.act < newAct),
        actTimestamp
      ]
    };

    const updatedScenario: MurderMysteryData = {
      ...scenario,
      game_night: updatedGameNight
    };

    // Offline-first: save locally
    const storageKey = `mm_scenario_${sessionId}`;
    storage.set(storageKey, JSON.stringify(updatedScenario));

    // Try to sync with Supabase
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ config: updatedScenario as any })
        .eq('id', sessionId);

      if (error) {
        console.warn(`Failed to sync act advancement to Supabase: ${error.message}`);
      } else {
        // Queue notifications for players that the Act has advanced
        const notifications = scenario.characters
          .filter(c => c.assigned_to)
          .map(char => ({
            user_id: char.assigned_to,
            type: 'ACT_ADVANCE',
            title: `Act ${newAct} Begins`,
            body: `The story progresses to Act ${newAct}. Check your notebook.`,
            data: { session_id: sessionId, act: newAct },
            status: 'PENDING'
          }));

        if (notifications.length > 0) {
          await supabase.from('notification_queue').insert(notifications);
        }
      }
    } catch (err) {
      console.warn('Network error while syncing act advancement', err);
    }

    return updatedScenario;
  }
}
