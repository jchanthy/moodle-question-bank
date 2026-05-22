const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: roles, error: rErr } = await supabase.from('user_roles').select('*');
  if (rErr) {
    console.error('Error fetching roles:', rErr);
    return;
  }
  console.log('--- USER ROLES ---');
  console.log(roles);

  const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, email, full_name');
  if (pErr) {
    console.error('Error fetching profiles:', pErr);
    return;
  }
  console.log('--- PROFILES ---');
  console.log(profiles);
}

check();
