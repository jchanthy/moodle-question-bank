import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: tables, error } = await supabase.rpc('get_tables'); // Won't work without RPC
    console.log('Tables check:', error?.message);

    // Try common names
    const common = ['profiles', 'users', 'user_profiles', 'teachers', 'staff', 'accounts'];
    for (const t of common) {
        const { data, error } = await supabase.from(t).select('*').limit(1);
        if (!error) console.log(`Found table: ${t}. Sample:`, data);
    }
}
check();
