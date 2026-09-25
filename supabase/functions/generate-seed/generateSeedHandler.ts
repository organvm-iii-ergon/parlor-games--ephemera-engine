import { createClient } from "@supabase/supabase-js";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  path: string;
}

export function validateScenarioResponse(data: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!data || typeof data !== "object") {
    return [{ level: "error", message: "Response is not a valid object", path: "root" }];
  }

  // Setting seed
  if (!data.setting_seed || typeof data.setting_seed !== "object") {
    issues.push({ level: "error", message: "Missing setting_seed object", path: "setting_seed" });
  }

  // Characters
  if (!Array.isArray(data.characters)) {
    issues.push({ level: "error", message: "Missing characters array", path: "characters" });
    return issues;
  }

  if (data.characters.length < 4) {
    issues.push({ level: "error", message: "At least 4 characters are required", path: "characters" });
  }

  const characterIds = new Set(data.characters.map((c: any) => c?.id));

  const murderers = data.characters.filter((c: any) => c?.is_murderer === true);
  if (murderers.length !== 1) {
    issues.push({ level: "error", message: "Exactly one character must be the murderer", path: "characters" });
  }

  const victims = data.characters.filter((c: any) => c?.is_victim === true);
  if (victims.length !== 1) {
    issues.push({ level: "error", message: "Exactly one character must be the victim", path: "characters" });
  }

  if (murderers.length === 1 && victims.length === 1 && murderers[0].id === victims[0].id) {
    issues.push({ level: "error", message: "The murderer and the victim cannot be the same person", path: "characters" });
  }

  data.characters.forEach((char: any, idx: number) => {
    if (char?.relationship?.target_character_id) {
      if (!characterIds.has(char.relationship.target_character_id)) {
        issues.push({
          level: "error",
          message: `Character ${char.id} has invalid relationship target ${char.relationship.target_character_id}`,
          path: `characters[${idx}].relationship.target_character_id`,
        });
      }
    }
  });

  // Crime
  if (!data.crime || typeof data.crime !== "object") {
    issues.push({ level: "error", message: "Missing crime object", path: "crime" });
  } else {
    if (!characterIds.has(data.crime.murderer_id)) {
      issues.push({ level: "error", message: "Crime murderer_id must reference a valid character", path: "crime.murderer_id" });
    } else if (murderers.length === 1 && data.crime.murderer_id !== murderers[0].id) {
      issues.push({ level: "error", message: "Crime murderer_id does not match character is_murderer flag", path: "crime.murderer_id" });
    }

    if (!characterIds.has(data.crime.victim_id)) {
      issues.push({ level: "error", message: "Crime victim_id must reference a valid character", path: "crime.victim_id" });
    } else if (victims.length === 1 && data.crime.victim_id !== victims[0].id) {
      issues.push({ level: "error", message: "Crime victim_id does not match character is_victim flag", path: "crime.victim_id" });
    }

    if (Array.isArray(data.crime.red_herrings)) {
      data.crime.red_herrings.forEach((rh: any, idx: number) => {
        if (!characterIds.has(rh?.character_id)) {
          issues.push({
            level: "error",
            message: `Red herring references invalid character ${rh?.character_id}`,
            path: `crime.red_herrings[${idx}].character_id`,
          });
        }
      });
    }

    if (Array.isArray(data.crime.timeline)) {
      const sortedTimeline = [...data.crime.timeline].sort((a: any, b: any) => (a?.order || 0) - (b?.order || 0));
      for (let i = 0; i < sortedTimeline.length - 1; i++) {
        if ((sortedTimeline[i]?.act || 0) > (sortedTimeline[i + 1]?.act || 0)) {
          issues.push({
            level: "error",
            message: "Timeline acts must be strictly non-decreasing",
            path: "crime.timeline",
          });
          break;
        }
      }
    }
  }

  // Clues
  if (!Array.isArray(data.clues)) {
    issues.push({ level: "error", message: "Missing clues array", path: "clues" });
  }

  return issues;
}

export interface HandlerOptions {
  supabase?: any;
  anthropic?: any;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `You are a master mystery writer who designs highly engaging, coherent, and consistent Murder Mystery party game scenarios.
You will be provided with four setting axes (Era, Location, Milieu, Tension) and a player_count.
Your task is to generate a complete murder mystery scenario including the setting, characters, crime, red herrings, clues, and timeline.
Your response MUST be a valid JSON object adhering strictly to scenario schema requirements.`;

export async function handleGenerateSeedRequest(
  req: Request,
  options: HandlerOptions = {}
): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const getEnv = (key: string): string => {
      if (typeof Deno !== "undefined" && Deno.env) {
        return Deno.env.get(key) || "";
      }
      return process.env[key] || "";
    };

    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = options.supabase || createClient(supabaseUrl, supabaseServiceKey);

    const anthropicKey = getEnv("ANTHROPIC_API_KEY"); // allow-secret
    let anthropic = options.anthropic;

    if (!anthropic && anthropicKey) {
      try {
        const AnthropicSdk = (await import("@anthropic-ai/sdk")).default;
        anthropic = new AnthropicSdk({ apiKey: anthropicKey });
      } catch {
        // Anthropic SDK optional in fallback/test environment
      }
    }

    const fetchFn = options.fetchFn || globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 10000;

    const body = await req.json();
    const { era, location, milieu, tension, session_id, player_count = 8 } = body || {};

    if (!era || !location || !session_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Rate Limit 1: Max 10 per session
    const { count, error: countError } = await supabase
      .from("seed_generation_log")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session_id);

    if (countError) throw countError;
    if (count !== null && count >= 10) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded for this session (max 10)." }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Rate Limit 2: 5s Cooldown
    const { data: latestLogs, error: latestError } = await supabase
      .from("seed_generation_log")
      .select("created_at")
      .eq("session_id", session_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (latestError) throw latestError;
    if (latestLogs && latestLogs.length > 0) {
      const lastCreatedAt = new Date(latestLogs[0].created_at).getTime();
      const now = Date.now();
      if (now - lastCreatedAt < 5000) {
        return new Response(
          JSON.stringify({ error: "Cooldown active. Please wait 5 seconds between generation requests." }),
          { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    const userPrompt = `Generate a murder mystery with the following parameters:
Era: ${era}
Location: ${location}
Milieu: ${milieu || "Any"}
Tension: ${tension || "Any"}
Player Count: ${player_count}`;

    let generatedScenario: any = null;
    let lastError: string | null = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let parsed: any = null;

        if (anthropic && typeof anthropic.messages?.create === "function") {
          const message = await anthropic.messages.create(
            {
              model: "claude-3-5-sonnet-20241022",
              max_tokens: 4000,
              temperature: 0.7,
              system: SYSTEM_PROMPT,
              messages: [{ role: "user", content: userPrompt }],
            },
            { signal: controller.signal }
          );
          clearTimeout(timer);

          const content = message.content[0]?.type === "text" ? message.content[0].text : "";
          const jsonStart = content.indexOf("{");
          const jsonEnd = content.lastIndexOf("}") + 1;
          if (jsonStart !== -1 && jsonEnd > jsonStart) {
            parsed = JSON.parse(content.substring(jsonStart, jsonEnd));
          } else {
            throw new Error("No JSON object found in Anthropic response");
          }
        } else {
          // Fetch fallback if anthropic client mock function passed or fetch mock
          const openAiResponse = await fetchFn("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${getEnv("OPENAI_API_KEY")}`, // allow-secret
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.7,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!openAiResponse.ok) {
            throw new Error(`API Error: ${openAiResponse.statusText}`);
          }
          const data = await openAiResponse.json();
          const content = data.choices?.[0]?.message?.content || "";
          parsed = JSON.parse(content);
        }

        const issues = validateScenarioResponse(parsed);
        const errorIssues = issues.filter((i) => i.level === "error");
        if (errorIssues.length > 0) {
          throw new Error(`Scenario validation failed: ${errorIssues.map((e) => e.message).join("; ")}`);
        }

        generatedScenario = parsed;
        retryCount = attempt - 1;
        break;
      } catch (err: any) {
        lastError = err.name === "AbortError" ? "API request timed out" : err.message;
        retryCount = attempt;
      }
    }

    if (!generatedScenario) {
      await supabase.from("seed_generation_log").insert({
        session_id,
        prompt_params: { era, location, milieu, tension, player_count },
        input_axes: { era, location, milieu, tension },
        response_status: "failed",
        status: "failed",
        retry_count: retryCount,
        error_message: lastError,
      });

      return new Response(
        JSON.stringify({ error: "Failed to generate valid scenario via AI API", details: lastError }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Log successful generation
    await supabase.from("seed_generation_log").insert({
      session_id,
      prompt_params: { era, location, milieu, tension, player_count },
      input_axes: { era, location, milieu, tension },
      generated_seed: generatedScenario,
      validated_response: generatedScenario,
      response_status: "success",
      status: "success",
      retry_count: retryCount,
    });

    return new Response(JSON.stringify({ scenario: generatedScenario }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
