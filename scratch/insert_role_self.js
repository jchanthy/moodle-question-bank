const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

const passwords = ['123456', 'teacher123', 'password', 'teacher', 'admin123'];

async function run() {
  let session = null;
  let loggedInUser = null;
  for (const password of passwords) {
    console.log(`Trying login for teacher2@mail.com with password: ${password}`);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'teacher2@mail.com',
      password: password
    });
    if (!error && data?.session) {
      session = data.session;
      loggedInUser = data.user;
      console.log('Login successful!');
      break;
    } else {
      console.log('Login failed:', error?.message || error);
    }
  }

  if (!session) {
    console.error('Could not authenticate as teacher2.');
    return;
  }

  console.log('Attempting to upsert role for self:', loggedInUser.id);
  const { data: updateData, error: updateError } = await supabase.from('user_roles').upsert({
    user_id: loggedInUser.id,
    role: 'assistant_teacher'
  }, { onConflict: 'user_id' }).select();

  console.log('Update Result:', updateData, updateError);
}
run();
