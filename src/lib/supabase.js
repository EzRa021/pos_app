// src/lib/supabase.js
// Supabase client for realtime subscriptions only.
// The anon key is safe for frontend use — it only grants read access to
// realtime channels. All writes go through the Rust backend.
//
// The client is lazy — initialised on first call to getSupabaseClient().
// Returns null if Supabase hasn't been configured yet.

import { createClient } from "@supabase/supabase-js";
import { rpc } from "@/lib/apiClient";

let _client = null;
let _initPromise = null;

/**
 * Initialise the Supabase client by fetching config from the Rust backend.
 * Idempotent — safe to call multiple times; only initialises once.
 * Returns the client or null if Supabase isn't configured.
 */
export async function initSupabaseClient() {
  if (_client) return _client;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const config = await rpc("get_supabase_config");
      if (!config || !config.url || !config.anon_key || !config.is_configured) {
        return null;
      }
      _client = createClient(config.url, config.anon_key, {
        realtime: {
          params: { eventsPerSecond: 10 },
        },
        auth: {
          persistSession: false, // We manage auth ourselves
          autoRefreshToken: false,
        },
      });
      return _client;
    } catch {
      return null;
    } finally {
      _initPromise = null;
    }
  })();

  return _initPromise;
}

/** Get the current client synchronously — null if not yet initialised. */
export function getSupabaseClient() {
  return _client;
}

/** Reset the client (called on logout or when config changes). */
export function resetSupabaseClient() {
  if (_client) {
    _client.removeAllChannels();
    _client = null;
  }
  _initPromise = null;
}
