const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Logging in as teacher...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teacher@mail.com',
    password: 'teacher123'
  });
  if (authError) {
    console.error('Teacher login failed:', authError.message);
    return;
  }
  
  const user = authData.user;
  console.log('Logged in! User ID:', user.id);

  // Find a question where created_by !== teacher's ID
  const { data: qs, error: qError } = await supabase
    .from('questions')
    .select('*')
    .neq('created_by', user.id)
    .is('deleted_at', null)
    .limit(1);

  if (qError) {
    console.error('Error fetching questions:', qError.message);
    return;
  }

  if (!qs || qs.length === 0) {
    console.log('No questions found created by others.');
    return;
  }

  const q = qs[0];
  console.log(`Found question: "${q.name}" (ID: ${q.id}, Author: ${q.created_by}, Status: ${q.status})`);

  console.log('Attempting soft-delete (updating deleted_at to now)...');
  const { data: res, error: err } = await supabase
    .from('questions')
    .update({ 
      deleted_at: new Date().toISOString()
    })
    .eq('id', q.id)
    .select();

  if (err) {
    console.error('Soft-delete failed with error:', err.message);
  } else {
    console.log('Soft-delete result rows:', res ? res.length : 0);
  }

  await supabase.auth.signOut();
}

run();
