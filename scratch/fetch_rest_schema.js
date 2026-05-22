const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';

async function run() {
  console.log('Fetching REST schema description from PostgREST...');
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${response.status} ${response.statusText}`);
    }
    
    const schema = await response.json();
    console.log('--- PATHS EXPOSED ---');
    const paths = Object.keys(schema.paths || {});
    console.log('Available endpoints:', paths);
    
    console.log('--- FUNCTIONS / RPCs ---');
    const rpcPaths = paths.filter(p => p.startsWith('/rpc/'));
    console.log('RPC paths:', rpcPaths);

    if (schema.definitions) {
      console.log('--- TABLES/VIEWS DEFINITIONS ---');
      console.log(Object.keys(schema.definitions));
    }
  } catch (err) {
    console.error('Error fetching schema:', err);
  }
}
run();
