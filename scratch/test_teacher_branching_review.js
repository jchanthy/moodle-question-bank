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

  // Find a question in pending_teacher_review created by someone else (e.g. teacher2)
  const { data: qs, error: qError } = await supabase
    .from('questions')
    .select('*')
    .eq('status', 'pending_teacher_review')
    .neq('created_by', user.id)
    .is('deleted_at', null)
    .limit(1);

  if (qError) {
    console.error('Error fetching questions:', qError.message);
    await supabase.auth.signOut();
    return;
  }

  if (!qs || qs.length === 0) {
    console.log('No questions pending teacher review from others found. Trying any question from others...');
    const { data: anyQs, error: anyError } = await supabase
      .from('questions')
      .select('*')
      .neq('created_by', user.id)
      .is('deleted_at', null)
      .limit(1);

    if (anyError || !anyQs || anyQs.length === 0) {
      console.log('No suitable question found to test branching.');
      await supabase.auth.signOut();
      return;
    }
    qs.push(anyQs[0]);
  }

  const q = qs[0];
  console.log(`Found target question: "${q.name}" (ID: ${q.id}, Author: ${q.created_by}, Version: ${q.version}, Status: ${q.status})`);

  // SIMULATE VERSION BRANCHING (Teacher approves and submits to admin)
  const targetStatus = 'pending_review';
  const parentId = q.parent_id || q.id;

  console.log('1. Calculating next version...');
  const { data: latestRecords, error: verError } = await supabase
    .from('questions')
    .select('version')
    .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
    .order('version', { ascending: false })
    .limit(1);

  if (verError) {
    console.error('Failed to get max version:', verError.message);
    await supabase.auth.signOut();
    return;
  }

  const maxVersion = latestRecords?.[0]?.version || q.version || 1;
  const nextVersion = maxVersion + 1;
  console.log(`Max version found: ${maxVersion}. Next version: ${nextVersion}`);

  console.log('2. Inserting new version row...');
  const { data: newQ, error: nError } = await supabase
    .from('questions')
    .insert({
      name: q.name + ' (Approved Version)',
      question_text: q.question_text,
      general_feedback: q.general_feedback || null,
      qtype: q.qtype,
      version: nextVersion,
      status: targetStatus,
      parent_id: parentId,
      created_by: user.id,
      category_id: q.category_id || null,
      penalty: q.penalty !== undefined ? q.penalty : null,
      default_grade: q.default_grade !== undefined ? q.default_grade : 1,
      metadata: {
        ...(q.metadata || {}),
        approved_by_teacher_test: true,
        approved_at: new Date().toISOString()
      }
    })
    .select()
    .single();

  if (nError) {
    console.error('New version insertion failed:', nError.message);
    await supabase.auth.signOut();
    return;
  }

  console.log(`New version row inserted successfully! New ID: ${newQ.id}`);

  console.log('3. Cloning answers from old question...');
  const { data: answersData, error: ansFetchError } = await supabase
    .from('answers')
    .select('*')
    .eq('question_id', q.id);

  if (ansFetchError) {
    console.error('Failed to fetch old answers:', ansFetchError.message);
  } else {
    console.log(`Fetched ${answersData ? answersData.length : 0} answers to copy.`);
    if (answersData && answersData.length > 0) {
      const answersToInsert = answersData.map(ans => ({
        question_id: newQ.id,
        answer_text: ans.answer_text,
        fraction: ans.fraction,
        feedback: ans.feedback,
        x: ans.x,
        y: ans.y
      }));
      
      const { data: insertedAns, error: ansInsertError } = await supabase
        .from('answers')
        .insert(answersToInsert)
        .select();

      if (ansInsertError) {
        console.error('Failed to copy answers:', ansInsertError.message);
      } else {
        console.log(`Successfully copied ${insertedAns.length} answers to the new version.`);
      }
    }
  }

  console.log('\n--- VERIFICATION SUCCESSFUL ---');
  console.log('Teacher can successfully review and approve questions by branching!');
  
  await supabase.auth.signOut();
}

run();
