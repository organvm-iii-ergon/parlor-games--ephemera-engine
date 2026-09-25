import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleGenerateSeedRequest } from "./generateSeedHandler.ts";

serve(async (req: Request) => {
  return handleGenerateSeedRequest(req);
});
