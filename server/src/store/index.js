import { SupabaseStore } from "./supabaseStore.js";
import { supabaseAdmin, supabaseConfigured } from "../services/supabaseClient.js";

export async function createStore() {
  if (!supabaseConfigured()) {
    throw new Error("Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
  }

  // Cheapest possible round trip that proves the service-role key and URL
  // are both valid before handing the store to the rest of the app.
  const { error } = await supabaseAdmin().from("companies").select("id", { head: true, count: "exact" }).limit(1);
  if (error) throw new Error(`Supabase connection failed: ${error.message}`);

  console.log("Connected to Supabase");
  return new SupabaseStore();
}
