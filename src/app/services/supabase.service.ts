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

  get currentUserName(): string {
    const user = this.currentUser();
    if (!user) return 'Guest';
    return user.user_metadata?.['full_name'] || user.email?.split('@')[0] || 'Teacher';
  }

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
      const user = session?.user ?? null;
      
      // Update core state immediately (Synchronous)
      this.currentUser.set(user);
      
      if (user) {
        // Run background tasks without blocking
        this.fetchUserRole(user.id);
        this.syncProfile(user);
      } else {
        this.currentUserRole.set(null);
      }
    });
  }

  private async syncProfile(user: any) {
    try {
      // Try to update/insert the profile with the latest email from Auth
      // We don't want this to block the UI or Auth flow
      await this.supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email.split('@')[0],
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (err) {
      console.error('Profile sync failed silently:', err);
    }
  }

  private async fetchUserRole(userId: string) {
    try {
      const { data, error } = await this.supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
        
      if (data && !error) {
        this.currentUserRole.set(data.role);
      }
    } catch (err) {
      console.error('Role fetch failed:', err);
    }
  }

  get auth() {
    return this.supabase.auth;
  }

  get db() {
    return this.supabase;
  }
}
