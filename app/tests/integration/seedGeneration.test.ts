import { describe, it, expect, vi, beforeEach } from "vitest";

import { handleGenerateSeedRequest, validateScenarioResponse } from "../../../supabase/functions/generate-seed/generateSeedHandler";
import { SeedGenerationService } from "../../src/features/murder-mystery/services/seedGenerationService";
import { supabase } from "../../src/lib/supabase";
import { MurderMysteryData } from "../../src/features/murder-mystery/types/murder-mystery";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

// Mock Supabase
vi.mock("../../src/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    from: vi.fn(),
  },
}));

describe("Seed Generation Integration Tests", () => {
  const createValidScenario = (): MurderMysteryData => ({
    setting_seed: {
      source: "generated",
      era: "1920s",
      location: "Mansion",
      milieu: "High Society",
      tension: "Financial Ruin",
      setting_description: "A grand mansion",
      crime_scene: "Library",
      generated_by: "llm",
    },
    characters: [
      {
        id: "c1",
        name: "Victim",
        occupation: "Owner",
        personality: "Mean",
        secret: "None",
        relationship: { target_character_id: "c2", description: "Enemies" },
        is_victim: true,
        is_murderer: false,
        contribution_brief: { food: "", dress: "", prop: "" },
        preparation_prompts: [],
        assigned_to: null,
      },
      {
        id: "c2",
        name: "Murderer",
        occupation: "Butler",
        personality: "Cold",
        secret: "Stole money",
        relationship: { target_character_id: "c1", description: "Employee" },
        is_victim: false,
        is_murderer: true,
        contribution_brief: { food: "", dress: "", prop: "" },
        preparation_prompts: [],
        assigned_to: null,
      },
      {
        id: "c3",
        name: "Guest 1",
        occupation: "Socialite",
        personality: "Vain",
        secret: "Broke",
        relationship: { target_character_id: "c1", description: "Friend" },
        is_victim: false,
        is_murderer: false,
        contribution_brief: { food: "", dress: "", prop: "" },
        preparation_prompts: [],
        assigned_to: null,
      },
      {
        id: "c4",
        name: "Guest 2",
        occupation: "Doctor",
        personality: "Quiet",
        secret: "Addict",
        relationship: { target_character_id: "c3", description: "Brother" },
        is_victim: false,
        is_murderer: false,
        contribution_brief: { food: "", dress: "", prop: "" },
        preparation_prompts: [],
        assigned_to: null,
      },
    ],
    crime: {
      victim_id: "c1",
      murderer_id: "c2",
      weapon: "Poison",
      motive: "Revenge",
      red_herrings: [{ character_id: "c3", description: "Was seen near library" }],
      timeline: [
        { order: 1, description: "Dinner", act: 1 },
        { order: 2, description: "Murder", act: 2 },
      ],
    },
    clues: [
      {
        id: "clue-1",
        title: "Poison Vial",
        type: "PHYSICAL",
        description: "Empty vial",
        found_by: "Doctor",
        tier: 1,
      },
    ],
    game_night: { act_timestamps: [], clues_distributed: [], evidence_reveals: [], accusations: [] },
    awards: [],
    sealed_envelopes: [],
  });

  let mockSupabaseDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "seed_generation_log") {
          return {
            select: vi.fn().mockImplementation((_selectStr, options) => {
              if (options?.count === "exact" && options?.head === true) {
                return {
                  eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
                };
              }
              return {
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              };
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "sessions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { config: { theme: "dark" } }, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {};
      }),
    };
  });

  describe("Core Scenario Generation & Validation", () => {
    it("mocks Claude API response with valid scenario JSON and generates seed successfully", async () => {
      const validScenario = createValidScenario();

      const mockAnthropic = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: JSON.stringify(validScenario) }],
          }),
        },
      };

      const req = new Request("https://localhost/generate-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: "1920s",
          location: "Mansion",
          session_id: "session-123",
          player_count: 4,
        }),
      });

      const res = await handleGenerateSeedRequest(req, {
        supabase: mockSupabaseDb,
        anthropic: mockAnthropic,
      });

      expect(res.status).toBe(200);
      const resData = await res.json();
      expect(resData.scenario).toEqual(validScenario);
      expect(mockAnthropic.messages.create).toHaveBeenCalledTimes(1);
    });

    it("validates scenario schema and flags errors for invalid fields", () => {
      const validScenario = createValidScenario();

      expect(validateScenarioResponse(validScenario)).toHaveLength(0);

      // Missing characters array
      expect(validateScenarioResponse({ ...validScenario, characters: null })).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "characters" })])
      );

      // Less than 4 characters
      const fewCharsScenario = { ...validScenario, characters: validScenario.characters.slice(0, 2) };
      expect(validateScenarioResponse(fewCharsScenario)).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("At least 4 characters") })])
      );

      // Invalid relationship target ID
      const invalidRelScenario = createValidScenario();
      invalidRelScenario.characters[0].relationship.target_character_id = "non-existent-id";
      expect(validateScenarioResponse(invalidRelScenario)).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining("target_character_id") })])
      );

      // Out of order timeline acts
      const unorderedTimelineScenario = createValidScenario();
      unorderedTimelineScenario.crime.timeline = [
        { order: 1, description: "Act 2 event", act: 2 },
        { order: 2, description: "Act 1 event", act: 1 },
      ];
      expect(validateScenarioResponse(unorderedTimelineScenario)).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("non-decreasing") })])
      );
    });

    it("persists validated scenario to session.config", async () => {
      const validScenario = createValidScenario();
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      const mockSingle = vi.fn().mockResolvedValue({
        data: { config: { existingKey: "existingValue" } },
        error: null,
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === "sessions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ single: mockSingle }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      });

      await SeedGenerationService.saveScenarioToSession("session-123", validScenario);

      expect(supabase.from).toHaveBeenCalledWith("sessions");
      expect(mockUpdate).toHaveBeenCalledWith({
        config: {
          existingKey: "existingValue",
          murder_mystery_data: validScenario,
        },
      });
      expect(mockEq).toHaveBeenCalledWith("id", "session-123");
    });
  });

  describe("Rate Limiting & Logging", () => {
    it("enforces max 10 generations per session rate limit", async () => {
      const mockRateLimitDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "seed_generation_log") {
            return {
              select: vi.fn().mockImplementation((_selectStr, options) => {
                if (options?.count === "exact" && options?.head === true) {
                  return {
                    eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
                  };
                }
                return {
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                };
              }),
            };
          }
          return {};
        }),
      };

      const req = new Request("https://localhost/generate-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: "1920s",
          location: "Mansion",
          session_id: "session-123",
        }),
      });

      const res = await handleGenerateSeedRequest(req, { supabase: mockRateLimitDb });
      expect(res.status).toBe(429);
      const resData = await res.json();
      expect(resData.error).toContain("Rate limit exceeded");
    });

    it("enforces 5-second cooldown rate limit between generation attempts", async () => {
      const recentLogTime = new Date(Date.now() - 2000).toISOString(); // 2 seconds ago

      const mockCooldownDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "seed_generation_log") {
            return {
              select: vi.fn().mockImplementation((_selectStr, options) => {
                if (options?.count === "exact" && options?.head === true) {
                  return {
                    eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
                  };
                }
                return {
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [{ created_at: recentLogTime }],
                        error: null,
                      }),
                    }),
                  }),
                };
              }),
            };
          }
          return {};
        }),
      };

      const req = new Request("https://localhost/generate-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: "1920s",
          location: "Mansion",
          session_id: "session-123",
        }),
      });

      const res = await handleGenerateSeedRequest(req, { supabase: mockCooldownDb });
      expect(res.status).toBe(429);
      const resData = await res.json();
      expect(resData.error).toContain("Cooldown active");
    });

    it("creates seed_generation_log entry on successful scenario generation", async () => {
      const validScenario = createValidScenario();
      const insertMock = vi.fn().mockResolvedValue({ error: null });

      const mockLoggingDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "seed_generation_log") {
            return {
              select: vi.fn().mockImplementation((_selectStr, options) => {
                if (options?.count === "exact" && options?.head === true) {
                  return { eq: vi.fn().mockResolvedValue({ count: 0, error: null }) };
                }
                return {
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                };
              }),
              insert: insertMock,
            };
          }
          return {};
        }),
      };

      const mockAnthropic = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: JSON.stringify(validScenario) }],
          }),
        },
      };

      const req = new Request("https://localhost/generate-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: "1920s",
          location: "Mansion",
          session_id: "session-123",
          player_count: 4,
        }),
      });

      await handleGenerateSeedRequest(req, {
        supabase: mockLoggingDb,
        anthropic: mockAnthropic,
      });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "session-123",
          prompt_params: expect.objectContaining({ era: "1920s", location: "Mansion", player_count: 4 }),
          response_status: "success",
          status: "success",
          retry_count: 0,
        })
      );
    });
  });

  describe("Retry Behavior & Error Handling", () => {
    it("retries up to 3 times on validation failure and succeeds if a subsequent attempt is valid", async () => {
      const validScenario = createValidScenario();
      const invalidScenario = { ...validScenario, characters: [] }; // Fails validation

      const createMock = vi
        .fn()
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify(invalidScenario) }],
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify(validScenario) }],
        });

      const mockAnthropic = { messages: { create: createMock } };

      const req = new Request("https://localhost/generate-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: "1920s",
          location: "Mansion",
          session_id: "session-123",
        }),
      });

      const res = await handleGenerateSeedRequest(req, {
        supabase: mockSupabaseDb,
        anthropic: mockAnthropic,
      });

      expect(res.status).toBe(200);
      const resData = await res.json();
      expect(resData.scenario).toEqual(validScenario);
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it("handles API timeouts gracefully and returns 500 error after retries are exhausted", async () => {
      const createMock = vi.fn().mockImplementation(() => {
        const err: any = new Error("Request aborted");
        err.name = "AbortError";
        throw err;
      });

      const mockAnthropic = { messages: { create: createMock } };

      const req = new Request("https://localhost/generate-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: "1920s",
          location: "Mansion",
          session_id: "session-123",
        }),
      });

      const res = await handleGenerateSeedRequest(req, {
        supabase: mockSupabaseDb,
        anthropic: mockAnthropic,
        timeoutMs: 10,
      });

      expect(res.status).toBe(500);
      const resData = await res.json();
      expect(resData.error).toContain("Failed to generate valid scenario");
      expect(resData.details).toContain("API request timed out");
      expect(createMock).toHaveBeenCalledTimes(3);
    });
  });
});
