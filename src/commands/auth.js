// commands/auth.js — Authentication
import { rpc } from "@/lib/apiClient";

export const login = (username, password) =>
  rpc("login", { username, password });

export const logout = () =>
  rpc("logout");

export const refreshToken = (refreshToken) =>
  rpc("refresh_token", { refresh_token: refreshToken });

export const changePassword = (currentPassword, newPassword) =>
  rpc("change_password", { current_password: currentPassword, new_password: newPassword });
