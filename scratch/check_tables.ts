import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const tables = ['profiles', 'teachers', 'user_roles', 'users'];
    for (const table of tables) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.log(`Table ${table} error:`, error.message);
        } else {
            console.log(`Table ${table} exists! Columns:`, Object.keys(data[0] || {}));
            const { data: all } = await supabase.from(table).select('*');
            console.log(`Table ${table} has ${all?.length} rows.`);
        }
    }
}

check();
