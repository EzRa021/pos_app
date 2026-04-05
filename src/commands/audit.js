// commands/audit.js — Audit logs
import { rpc } from "@/lib/apiClient";

export const getAuditLogs = (params = {}) =>
  rpc("get_audit_logs", params);
// params: { store_id?, user_id?, action?, resource?, severity?, date_from?, date_to?,
//            page?, limit? }

export const getAuditLogEntry = (id) =>
  rpc("get_audit_log_entry", { id });
