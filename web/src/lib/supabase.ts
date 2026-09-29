import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// One client, reused everywhere we need to read from Supabase.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
