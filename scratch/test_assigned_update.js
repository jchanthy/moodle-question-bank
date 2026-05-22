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
  
  const user = authData.user;
  console.log('Logged in! User ID:', user.id);

  // Question ceaa82e0-5529-4f64-b114-7fe97624950f is ASSIGNED to teacher
  const qId = 'ceaa82e0-5529-4f64-b114-7fe97624950f';
  const { data: qs, error: qError } = await supabase
    .from('questions')
    .select('*')
    .eq('id', qId)
    .single();

  if (qError) {
    console.error('Error fetching question:', qError.message);
    return;
  }

  console.log(`Found question: "${qs.name}" (Status: ${qs.status}, Creator: ${qs.created_by})`);

  console.log('Attempting update as assigned reviewer (without created_by)...');
  const { data: res1, error: err1 } = await supabase
    .from('questions')
    .update({ 
      status: 'pending_review', 
      metadata: { ...qs.metadata, test: 'hello' } 
    })
    .eq('id', qId)
    .select();

  if (err1) {
    console.error('Update 1 failed:', err1.message);
  } else {
    console.log('Update 1 result rows:', res1.length);
  }

  console.log('Attempting update as assigned reviewer (with created_by: user.id)...');
  const { data: res2, error: err2 } = await supabase
    .from('questions')
    .update({ 
      status: 'pending_review', 
      created_by: user.id,
      metadata: { ...qs.metadata, test: 'hello2' } 
    })
    .eq('id', qId)
    .select();

  if (err2) {
    console.error('Update 2 failed:', err2.message);
  } else {
    console.log('Update 2 result rows:', res2.length);
  }

  await supabase.auth.signOut();
}

check();
