const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

// Simulated currentUserRole helper matching our supabase.service.ts fallback
function getRoleFallback(email) {
  if (email === 'teacher2@mail.com') {
    return 'assistant_teacher';
  } else if (email === 'teacher@mail.com' || email === 'user1@mail.com') {
    return 'teacher';
  } else if (email === 'admin@mail.com') {
    return 'admin';
  }
  return 'teacher';
}

async function testAsTeacher() {
  console.log('\n--- SIMULATING TEACHER LOGIN (teacher@mail.com) ---');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'teacher@mail.com',
    password: 'teacher123'
  });
  if (authError) {
    console.error('Teacher login failed:', authError.message);
    return;
  }
  
  const user = authData.user;
  const role = getRoleFallback(user.email);
  console.log(`Successfully authenticated! User ID: ${user.id}, Resolved Role: ${role}`);

  if (role !== 'teacher') {
    console.error('Role check failed! Expected "teacher", got:', role);
    return;
  }

  console.log('Querying assistant peer-review submissions (status = "pending_teacher_review")...');
  const { data: submissions, error: queryError } = await supabase
    .from('questions')
    .select('id, name, status, created_by, metadata')
    .eq('status', 'pending_teacher_review')
    .is('deleted_at', null);

  if (queryError) {
    console.error('Error fetching submissions:', queryError.message);
  } else {
    console.log(`Query succeeded! Found ${submissions.length} submissions for teacher review:`);
    submissions.forEach(sub => {
      console.log(`  - [${sub.status}] Name: "${sub.name}", Author: ${sub.metadata?.author_email || 'unknown'}`);
    });
  }

  await supabase.auth.signOut();
}

async function testAsAdmin() {
  console.log('\n--- SIMULATING ADMIN LOGIN (admin@mail.com) ---');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@mail.com',
    password: 'admin123'
  });
  if (authError) {
    console.error('Admin login failed:', authError.message);
    return;
  }

  const user = authData.user;
  const role = getRoleFallback(user.email);
  console.log(`Successfully authenticated! User ID: ${user.id}, Resolved Role: ${role}`);

  if (role !== 'admin') {
    console.error('Role check failed! Expected "admin", got:', role);
    return;
  }

  // Simulate loadTeachers() role fallback in admin-dashboard.ts
  console.log('Simulating loadTeachers() with email fallback on Profiles...');
  const { data: profiles, error: pError } = await supabase.from('profiles').select('id, full_name, email');
  if (pError) {
    console.error('Error loading profiles:', pError.message);
    return;
  }

  const profileMap = new Map();
  profiles.forEach(p => {
    // Simulated fallback check matching loadTeachers
    let resolvedRole = (p.email === 'teacher@mail.com' || p.email === 'user1@mail.com') ? 'teacher' 
                     : (p.email === 'admin@mail.com') ? 'admin' 
                     : (p.email === 'teacher2@mail.com') ? 'assistant_teacher' 
                     : 'teacher';

    profileMap.set(p.id, {
      id: p.id,
      name: p.full_name,
      email: p.email,
      isExplicitTeacher: resolvedRole === 'teacher'
    });
  });

  console.log('Resulting profile mappings inside Admin Dashboard:');
  profileMap.forEach((prof, id) => {
    console.log(`  - User: ${prof.name} (${prof.email}) | isExplicitTeacher: ${prof.isExplicitTeacher}`);
  });

  await supabase.auth.signOut();
}

async function run() {
  await testAsTeacher();
  await testAsAdmin();
}

run();
