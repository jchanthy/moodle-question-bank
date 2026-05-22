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

  console.log('Attempt 1: Update status and metadata only...');
  const { data: res1, error: err1 } = await supabase
    .from('questions')
    .update({ status: 'pending_review', metadata: { ...q.metadata, test: 'hello' } })
    .eq('id', q.id)
    .select();

  if (err1) {
    console.error('Attempt 1 failed:', err1.message);
  } else {
    console.log('Attempt 1 succeeded! Result rows:', res1.length);
  }

  console.log('Attempt 2: Update all fields (including name, question_text, etc.)...');
  const { data: res2, error: err2 } = await supabase
    .from('questions')
    .update({
      name: q.name,
      question_text: q.question_text,
      status: 'pending_review'
    })
    .eq('id', q.id)
    .select();

  if (err2) {
    console.error('Attempt 2 failed:', err2.message);
  } else {
    console.log('Attempt 2 succeeded! Result rows:', res2.length);
  }

  await supabase.auth.signOut();
}

check();
