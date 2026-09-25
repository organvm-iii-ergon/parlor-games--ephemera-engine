import { useState } from 'react';
import { MurderMysteryData } from '../types/murder-mystery';
import { ClueService } from '../services/clueService';

export const useClues = (sessionId: string, initialScenario: MurderMysteryData) => {
  const [scenario, setScenario] = useState<MurderMysteryData>(initialScenario);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const distributeClue = async (clueId: string, foundByCharacterId?: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const updatedScenario = await ClueService.distributeClue(sessionId, scenario, clueId, foundByCharacterId);
      setScenario(updatedScenario);
    } catch (err: any) {
      setError(err.message || 'Failed to distribute clue');
    } finally {
      setIsProcessing(false);
    }
  };

  const getDistributedClues = () => {
    return scenario.game_night?.clues_distributed || [];
  };

  const isClueDistributed = (clueId: string) => {
    return getDistributedClues().some(c => c.clue_id === clueId);
  };

  const getPendingClues = () => {
    return scenario.clues.filter(c => !isClueDistributed(c.id));
  };

  const toggleClueDistribution = async (clueId: string, distribute: boolean) => {
    if (distribute) {
      await distributeClue(clueId);
    } else {
      setIsProcessing(true);
      setError(null);
      try {
        const updatedClues = (scenario.game_night?.clues_distributed || []).filter(c => c.clue_id !== clueId);
        const updatedScenario: MurderMysteryData = {
          ...scenario,
          game_night: {
            ...scenario.game_night,
            clues_distributed: updatedClues
          }
        };
        setScenario(updatedScenario);
      } catch (err: any) {
        setError(err.message || 'Failed to toggle clue distribution');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return {
    scenario,
    isProcessing,
    error,
    distributeClue,
    getDistributedClues,
    getPendingClues,
    isClueDistributed,
    toggleClueDistribution
  };
};
