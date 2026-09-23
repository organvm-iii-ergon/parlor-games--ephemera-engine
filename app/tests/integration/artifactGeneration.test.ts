import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { murderMysteryArtifactService } from '../../src/features/murder-mystery/services/murderMysteryArtifactService';
import { MurderMysteryData } from '../../src/features/murder-mystery/types/murder-mystery';
import { renderHTML, renderPDF } from '../../../artifacts/src/render';

const mockScenario: MurderMysteryData = {
  setting_seed: {
    source: 'curated',
    era: '1920s',
    location: 'Manor',
    milieu: 'High Society',
    tension: 'Greed',
    setting_description: 'A dark and stormy night.',
    crime_scene: 'Library',
    generated_by: 'human'
  },
  characters: [
    {
      id: 'c1',
      name: 'Lord Arthur',
      occupation: 'Aristocrat',
      personality: 'Snobby',
      secret: 'Broke',
      relationship: { target_character_id: 'c2', description: 'Rivals' },
      is_murderer: true,
      is_victim: false,
      contribution_brief: { food: 'Caviar', dress: 'Tuxedo', prop: 'Cane' },
      preparation_prompts: [],
      assigned_to: 'p1'
    },
    {
      id: 'c2',
      name: 'Lady Eleanor',
      occupation: 'Heiress',
      personality: 'Charming',
      secret: 'Affair',
      relationship: { target_character_id: 'c1', description: 'Lovers' },
      is_murderer: false,
      is_victim: true,
      contribution_brief: { food: 'Champagne', dress: 'Gown', prop: 'Fan' },
      preparation_prompts: [],
      assigned_to: 'p2'
    }
  ],
  crime: {
    victim_id: 'c2',
    murderer_id: 'c1',
    weapon: 'Poison',
    motive: 'Inheritance',
    red_herrings: [],
    timeline: []
  },
  clues: [],
  game_night: {
    act_timestamps: [],
    clues_distributed: [],
    evidence_reveals: [],
    accusations: [],
    award_votes: []
  },
  awards: [],
  sealed_envelopes: [
    {
      character_id: 'c1',
      player_id: 'p1',
      text: 'Arthur was caught at the border.',
      delivered: false
    }
  ]
};

const fixturePath = path.resolve(__dirname, '../../../artifacts/fixtures/murder-mystery.json');
const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

function unescapeHTML(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('Artifact Generation Integration', () => {
  it('should assemble Dossier artifact payload correctly from domain model', () => {
    const payload = murderMysteryArtifactService.assembleDossierData(mockScenario);
    
    expect(payload.artifact_type).toBe('mm_dossier');
    expect(payload.characters.length).toBe(2);
    expect(payload.crime.weapon).toBe('Poison');
  });

  it('should assemble Menu of the Damned artifact payload correctly', () => {
    const payload = murderMysteryArtifactService.assembleMenuData(mockScenario);
    
    expect(payload.artifact_type).toBe('mm_menu');
    expect(payload.recipes?.length).toBe(2);
    expect(payload.recipes?.[0].recipe).toBe('Caviar');
  });

  it('should assemble Sealed Envelope artifact payload correctly', () => {
    const payload = murderMysteryArtifactService.assembleSealedEnvelopeData(mockScenario, 'c1');
    
    expect(payload).not.toBeNull();
    expect(payload?.artifact_type).toBe('mm_sealed_envelope');
    expect(payload?.envelope.text).toBe('Arthur was caught at the border.');
  });

  it('should match fixture shape expected by template', () => {
    expect(fixtureData).toHaveProperty('session');
    expect(fixtureData).toHaveProperty('setting');
    expect(fixtureData).toHaveProperty('characters');
    expect(fixtureData).toHaveProperty('clues');
    expect(fixtureData).toHaveProperty('accusations');
    expect(fixtureData).toHaveProperty('reveal');

    expect(fixtureData.session).toHaveProperty('title');
    expect(fixtureData.session).toHaveProperty('caseNumber');
    expect(fixtureData.setting).toHaveProperty('location');
    expect(fixtureData.setting).toHaveProperty('description');
    expect(Array.isArray(fixtureData.characters)).toBe(true);
    expect(Array.isArray(fixtureData.clues)).toBe(true);
    expect(Array.isArray(fixtureData.accusations)).toBe(true);
    expect(fixtureData.reveal).toHaveProperty('culprit');
    expect(fixtureData.reveal).toHaveProperty('explanation');
  });

  it('should render Dossier HTML with all required sections, character data, clues, accusations, and reveal', () => {
    const rawHtml = renderHTML('the-dossier', fixtureData);
    const html = unescapeHTML(rawHtml);

    // 1. All required sections present
    expect(html).toContain('The Dossier');
    expect(html).toContain('Cast of Characters');
    expect(html).toContain('Crime Scene Summary');
    expect(html).toContain('Evidence Log');
    expect(html).toContain('Accusations');
    expect(html).toContain('The Reveal');
    expect(html).toContain('Appendix: Clue Cards');

    // 2. Character data is correct and complete
    for (const char of fixtureData.characters) {
      expect(html).toContain(char.name);
      expect(html).toContain(char.playedBy);
      expect(html).toContain(char.bio);
    }

    // 3. All clues included with distribution/discovery details
    for (const clue of fixtureData.clues) {
      expect(html).toContain(clue.description);
      expect(html).toContain(clue.type);
      if (clue.foundBy) {
        expect(html).toContain(clue.foundBy);
      }
    }

    // 4. All accusations included
    for (const acc of fixtureData.accusations) {
      expect(html).toContain(acc.accuser);
      expect(html).toContain(acc.target);
      if (acc.reasoning) {
        expect(html).toContain(acc.reasoning);
      }
    }

    // 5. Reveal section matches actual solution
    expect(html).toContain(fixtureData.reveal.culprit);
    expect(html).toContain(fixtureData.reveal.explanation);
    if (fixtureData.votes) {
      for (const vote of fixtureData.votes) {
        expect(html).toContain(vote.character);
        expect(html).toContain(vote.count.toString());
      }
    }
  });

  it('should generate Dossier PDF successfully with valid data', async () => {
    const testOutputDir = path.resolve(__dirname, '../../test-output');
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }
    const outputPath = path.join(testOutputDir, 'test-dossier.pdf');
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const result = await renderPDF({
      templateName: 'the-dossier',
      data: fixtureData,
      outputPath
    });

    expect(result).toBeDefined();
    expect(result.path).toBe(outputPath);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);

    // Clean up test output
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }, 30000);
});
