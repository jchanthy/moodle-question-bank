const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: questions, error } = await supabase.from('questions').select('id, name, status, created_by, metadata');
  if (error) {
    console.error('Error fetching questions:', error);
    return;
  }
  console.log('--- QUESTIONS ---');
  console.log(JSON.stringify(questions, null, 2));
}

check();
