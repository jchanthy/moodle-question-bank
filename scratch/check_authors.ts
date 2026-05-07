import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://xtcvzevqbfvczhuwdisz.supabase.co';
const supabaseKey = 'sb_publishable_YIVmJ8WTTcxE4BA_20kzlQ_EWRUou4O';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    // Try to list tables using a raw query if possible (not supported via public client usually)
    // But we can try to see what we have access to.
    
    console.log('Checking questions table to see current authors...');
    const { data: questions } = await supabase.from('questions').select('created_by, metadata').limit(50);
    const authors = new Set();
    questions?.forEach(q => {
        if (q.created_by) authors.add(q.created_by + ' (' + (q.metadata?.author_name || 'No Name') + ')');
    });
    console.log('Current authors in questions:', Array.from(authors));

    console.log('Checking user_roles again...');
    const { data: roles, error: rolesError } = await supabase.from('user_roles').select('*');
    if (rolesError) console.log('Roles error:', rolesError.message);
    else console.log('Roles found:', roles);
}

check();
