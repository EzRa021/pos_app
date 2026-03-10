// commands/audit.js — Audit logs
import { rpc } from "@/lib/apiClient";

export const getAuditLogs = (params = {}) =>
  rpc("get_audit_logs", params);
// params: { store_id?, user_id?, action?, entity_type?, date_from?, date_to?,
//            page?, page_size? }
