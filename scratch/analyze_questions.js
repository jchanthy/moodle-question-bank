
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeQuestions() {
  const { data: questions, error } = await supabase
    .from('questions')
    .select('id, name, status, created_by, metadata, deleted_at')
    .is('deleted_at', null);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${questions.length} active questions.`);
  
  const stats = {
    byStatus: {},
    byUser: {},
    assigned: 0
  };

  questions.forEach(q => {
    stats.byStatus[q.status] = (stats.byStatus[q.status] || 0) + 1;
    stats.byUser[q.created_by] = (stats.byUser[q.created_by] || 0) + 1;
    if (q.metadata?.assigned_to_id) stats.assigned++;
  });

  console.log('Stats:', JSON.stringify(stats, null, 2));
}

analyzeQuestions();
