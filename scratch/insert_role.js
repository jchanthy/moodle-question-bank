const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('user_roles').upsert({
    user_id: 'ff10039f-bc33-4afe-a85c-baeaa9f4ebd8',
    role: 'assistant_teacher'
  }, { onConflict: 'user_id' }).select();
  console.log('Result:', data, error);
}
run();
