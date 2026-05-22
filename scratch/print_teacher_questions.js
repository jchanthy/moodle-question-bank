const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teacher@mail.com',
    password: 'teacher123'
  });
  if (authError) {
    console.error('Teacher login failed:', authError.message);
    return;
  }
  
  const { data: questions, error } = await supabase
    .from('questions')
    .select('id, name, status, created_by, metadata, parent_id, version')
    .is('deleted_at', null);

  if (error) {
    console.error('Error fetching questions:', error);
  } else {
    console.log('--- ALL QUESTIONS VISIBLE TO TEACHER ---');
    console.log(JSON.stringify(questions, null, 2));
  }

  await supabase.auth.signOut();
}

check();
