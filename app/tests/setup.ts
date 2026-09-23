import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env variables
dotenv.config({ path: resolve(__dirname, '../.env') });

// Provide safe defaults if environment variables are not set (e.g. in CI environment)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'mock-key';

export const testClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

// Utility to verify if the configured Supabase instance is currently reachable.
// This allows our test suites to gracefully skip RLS/Backend tests if the DB is offline (e.g., Docker is quit)
export const checkSupabaseReachability = async (): Promise<boolean> => {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) return false;
  try {
    // Ping the health endpoint
    const response = await fetch(`${supabaseUrl}/rest/v1/`, { method: 'HEAD' });
    return response.ok || response.status === 401; // 401 means it's up but requires auth, which is fine
  } catch (e) {
    return false;
  }
};
