const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUser(email, password) {
  console.log(`\nLogging in as ${email}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (authError) {
    console.error(`Login failed for ${email}:`, authError.message);
    return;
  }
  console.log(`Login successful! User ID: ${authData.user.id}`);

  const { data: questions, error } = await supabase.from('questions').select('id, name, status, created_by, metadata');
  if (error) {
    console.error('Error fetching questions:', error.message);
    return;
  }
  console.log(`Found ${questions.length} questions:`);
  console.log(JSON.stringify(questions, null, 2));

  // Log out to clear session
  await supabase.auth.signOut();
}

async function run() {
  await checkUser('teacher2@mail.com', 'teacher123');
  await checkUser('teacher@mail.com', 'teacher123');
}

run();
