const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUser(email, password) {
  console.log(`\n========================================`);
  console.log(`LOGGING IN AS: ${email}`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (authError) {
    console.error(`Login failed for ${email}:`, authError.message);
    return;
  }

  const { data: questions, error } = await supabase.from('questions').select('id, name, status, created_by, metadata, deleted_at');
  if (error) {
    console.error('Error fetching questions:', error.message);
  } else {
    console.log(`Total questions visible: ${questions.length}`);
    questions.forEach(q => {
      console.log(`  - [${q.status}] ID: ${q.id}, Name: "${q.name}", Created By: ${q.created_by}, Author Email in Metadata: ${q.metadata?.author_email}`);
    });
  }

  await supabase.auth.signOut();
}

async function run() {
  await checkUser('teacher2@mail.com', 'teacher123');
  await checkUser('teacher@mail.com', 'teacher123');
}

run();
