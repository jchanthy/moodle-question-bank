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

  // Find a question in pending_teacher_review
  const { data: qs, error: qError } = await supabase
    .from('questions')
    .select('*')
    .eq('status', 'pending_teacher_review')
    .limit(1);

  if (qError) {
    console.error('Error fetching questions:', qError.message);
    return;
  }

  if (!qs || qs.length === 0) {
    console.log('No questions in pending_teacher_review found.');
    return;
  }

  const q = qs[0];
  console.log(`Found question: "${q.name}" (ID: ${q.id}, Author: ${q.created_by}, Status: ${q.status})`);

  console.log('Attempting update with created_by set to current user ID...');
  const { data: res, error: err } = await supabase
    .from('questions')
    .update({ 
      status: 'pending_review', 
      created_by: user.id,
      metadata: { ...q.metadata, reviewed_by: 'teacher', reviewed_at: new Date().toISOString() } 
    })
    .eq('id', q.id)
    .select();

  if (err) {
    console.error('Update failed:', err.message);
  } else {
    console.log('Update succeeded! Result rows:', res.length);
    if (res.length > 0) {
      console.log('Successfully updated to status:', res[0].status);
      
      // Let's revert it back to pending_teacher_review to avoid messing up the test data
      console.log('Reverting back to pending_teacher_review...');
      const { data: revertRes } = await supabase
        .from('questions')
        .update({ 
          status: 'pending_teacher_review',
          created_by: user.id
        })
        .eq('id', q.id)
        .select();
      console.log('Revert result rows:', revertRes ? revertRes.length : 0);
    }
  }

  await supabase.auth.signOut();
}

check();
