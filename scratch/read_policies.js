const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.rpc('get_policies'); // If RPC exists, but probably not
  if (error) {
    // Let's try raw query or query pg_catalog if we have access via RPC or another way
    console.log('RPC get_policies failed, checking pg_policies via standard query if allowed...');
  }
  
  // Usually standard users cannot query pg_policies through Supabase client directly since it's restricted to public schemas.
  // But let's check what tables are in the public schema and their access.
  const { data: tbls, error: tblError } = await supabase.from('questions').select('id').limit(1);
  console.log('Can select questions:', !tblError);
}
check();
