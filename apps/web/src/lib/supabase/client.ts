'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@teddy/supabase/types';

export function getBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
