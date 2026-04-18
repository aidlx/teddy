'use client';

import { useEffect } from 'react';

// Fires a background sync on page load. The route only syncs subscriptions
// whose last_synced_at is null or older than 10 minutes, so this is cheap
// to call on every navigation. Silent on 401 (logged out) and on any error.
export function CalendarAutoSync() {
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/calendar/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  return null;
}
