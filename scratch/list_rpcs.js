const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // Let's try calling some system views or standard RPC functions to see if any are exposed
  console.log('Querying custom RPC functions or postgres catalog...');
  
  // Let's query information_schema or pg_proc if allowed (PostgREST usually doesn't expose it as a table unless configured)
  // But let's check what endpoints/views we can read or try common RPC names like set_user_role or similar.
  const rpcNames = [
    'get_policies',
    'set_user_role',
    'assign_role',
    'create_user_role',
    'update_user_status',
    'get_user_role',
    'sync_user_roles',
    'init_roles'
  ];

  for (const name of rpcNames) {
    try {
      const { data, error } = await supabase.rpc(name);
      console.log(`RPC ${name}:`, { data, error: error?.message || 'none' });
    } catch (e) {
      console.log(`RPC ${name} execution threw:`, e.message);
    }
  }
}
run();
