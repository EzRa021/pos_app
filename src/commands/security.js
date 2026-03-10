// commands/security.js — POS PIN lock & session management
import { rpc } from "@/lib/apiClient";

// SetPinDto: { pin: "XXXX" } (4-digit numeric)
export const setPosPin = (pin) =>
  rpc("set_pos_pin", { pin });

// VerifyPinDto: { user_id, pin }
// Returns: { success, token, expires_at, user_id }
export const verifyPosPin = (userId, pin) =>
  rpc("verify_pos_pin", { user_id: userId, pin });

// Invalidates current session token immediately
export const lockPosScreen = () =>
  rpc("lock_pos_screen", {});

// Returns ActiveSession[] — requires users.read permission
export const getActiveSessions = (storeId = null) =>
  rpc("get_active_sessions", { store_id: storeId });

// Immediately expires a session by id
export const revokeSession = (sessionId) =>
  rpc("revoke_session", { session_id: sessionId });
