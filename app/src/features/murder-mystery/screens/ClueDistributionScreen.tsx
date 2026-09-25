import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MurderMysteryData } from '../types/murder-mystery';
import { useClues } from '../hooks/useClues';
import { ClueChecklistItem } from '../components/ClueChecklistItem';

interface ClueDistributionScreenProps {
  sessionId: string;
  scenario: MurderMysteryData;
  onBack: () => void;
}

export const ClueDistributionScreen: React.FC<ClueDistributionScreenProps> = ({
  sessionId,
  scenario,
  onBack
}) => {
  const { toggleClueDistribution, getDistributedClues, getPendingClues, isClueDistributed } = useClues(sessionId, scenario);
  
  const distributedClueRecords = getDistributedClues();
  const pending = getPendingClues();
  const distributed = scenario.clues.filter(c => isClueDistributed(c.id));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fcd34d" />
        </TouchableOpacity>
        <Text style={styles.title}>Manage Clues</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: 20 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Clues ({pending.length})</Text>
          {pending.length === 0 && (
            <Text style={styles.emptyText}>All clues distributed!</Text>
          )}
          {pending.map((clue) => (
            <ClueChecklistItem
              key={clue.id}
              clueId={clue.id}
              title={clue.title || clue.name || 'Clue'}
              type={clue.type || 'PHYSICAL'}
              isFound={false}
              onToggleFound={() => toggleClueDistribution(clue.id, true)}
            />
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Distributed ({distributed.length})</Text>
          {distributed.length === 0 && (
            <Text style={styles.emptyText}>No clues distributed yet.</Text>
          )}
          {distributed.map((clue) => {
            const distRecord = distributedClueRecords.find(d => d.clue_id === clue.id);
            return (
              <ClueChecklistItem
                key={clue.id}
                clueId={clue.id}
                title={clue.title || clue.name || 'Clue'}
                type={clue.type || 'PHYSICAL'}
                isFound={true}
                foundBy={distRecord?.found_by}
                onToggleFound={() => toggleClueDistribution(clue.id, false)}
              />
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f3f4f6',
  },
  content: {
    flex: 1,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e5e7eb',
    marginBottom: 16,
  },
  emptyText: {
    color: '#6b7280',
    fontStyle: 'italic',
  }
});
