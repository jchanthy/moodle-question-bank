import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;
  
  // State management with Signals
  currentUser = signal<User | null>(null);
  currentUserRole = signal<'teacher' | 'admin' | null>(null);

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
    
    // Initialize auth state
    this.supabase.auth.getSession().then(({ data: { session } }) => {
      this.currentUser.set(session?.user ?? null);
      if (session?.user) {
        this.fetchUserRole(session.user.id);
      }
    });

    // Listen for auth changes
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.currentUser.set(session?.user ?? null);
      if (session?.user) {
        this.fetchUserRole(session.user.id);
      } else {
        this.currentUserRole.set(null);
      }
    });
  }

  private async fetchUserRole(userId: string) {
    const { data, error } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
      
    if (data && !error) {
      this.currentUserRole.set(data.role);
    }
  }

  get auth() {
    return this.supabase.auth;
  }

  get db() {
    return this.supabase;
  }
}
