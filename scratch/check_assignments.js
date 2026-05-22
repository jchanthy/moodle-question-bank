const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('Logging in as teacher...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teacher@mail.com',
    password: 'teacher123'
  });
  if (authError) {
    console.error('Teacher login failed:', authError.message);
    return;
  }
  
  console.log('Fetching assignments...');
  const { data: ass, error: aError } = await supabase.from('assignments').select('*');
  if (aError) {
    console.error('Error fetching assignments:', aError.message);
  } else {
    console.log('--- ASSIGNMENTS ---');
    console.log(JSON.stringify(ass, null, 2));
  }

  await supabase.auth.signOut();
}
check();
