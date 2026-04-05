// commands/onboarding.js
// Thin rpc() wrappers for onboarding and business-profile commands.

import { rpc } from "@/lib/apiClient";

export const checkOnboardingStatus = () =>
  rpc("check_onboarding_status");

export const createBusiness = (payload) =>
  rpc("create_business", payload);

/** Check whether a business UUID exists in the Supabase cloud database. */
export const checkBusinessExists = (businessId) =>
  rpc("check_business_exists", { business_id: businessId });

/**
 * Pull all master data for the given business from Supabase and restore it
 * into the local PostgreSQL database. Blocks until the restore completes.
 * Returns { business_id, name, tables: [{ table, rows }] }.
 */
export const restoreBusinessFromCloud = (businessId) =>
  rpc("restore_business_from_cloud", { business_id: businessId });

export const getBusinessInfo = () =>
  rpc("get_business_info");

export const updateBusinessInfo = (payload) =>
  rpc("update_business_info", payload);
