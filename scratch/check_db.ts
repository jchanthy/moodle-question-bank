import { createClient } from '@supabase/supabase-js'
import { environment } from './src/environments/environment'

const supabase = createClient(environment.supabaseUrl, environment.supabaseKey)

async function test() {
  const { data, error } = await supabase.from('user_roles').select('*').limit(5)
  console.log('user_roles:', data, error)
}
test()
