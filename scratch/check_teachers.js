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
  
  console.log('Fetching teachers table...');
  const { data: ts, error: tError } = await supabase.from('teachers').select('*');
  if (tError) {
    console.error('Error fetching teachers:', tError.message);
  } else {
    console.log('--- TEACHERS ---');
    console.log(JSON.stringify(ts, null, 2));
  }

  await supabase.auth.signOut();
}
check();
