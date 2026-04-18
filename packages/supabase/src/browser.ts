import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export function createBrowserClient(url: string, anonKey: string): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
