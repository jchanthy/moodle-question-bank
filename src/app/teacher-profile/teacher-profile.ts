import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MultiSelectModule } from 'primeng/multiselect';
import { DialogModule } from 'primeng/dialog';
import { SliderModule } from 'primeng/slider';

@Component({
  selector: 'app-teacher-profile',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    RouterModule, 
    ButtonModule, 
    InputTextModule, 
    TextareaModule, 
    ToastModule,
    ToggleSwitchModule,
    MultiSelectModule,
    DialogModule,
    SliderModule
  ],
  providers: [MessageService],
  templateUrl: './teacher-profile.html',
  styleUrl: './teacher-profile.css'
})
export class TeacherProfileComponent implements OnInit {
  loading = signal(true);
  saving = signal(false);

  // Profile Data
  profile = {
    full_name: '',
    bio: '',
    department: '',
    specialization: [] as string[],
    phone: '',
    is_public: true,
    avatar_url: '',
    avatar_scale: 1,
    avatar_pos_x: 50,
    avatar_pos_y: 50
  };

  isAdjusting = signal(false);

  specializationOptions: { label: string; value: string }[] = [];

  constructor(
    public supabase: SupabaseService,
    private messageService: MessageService,
    private router: Router
  ) {}

  async ngOnInit() {
    this.loading.set(true);
    try {
      await Promise.all([
        this.loadRootCategories(),
        this.loadProfile()
      ]);
    } catch (e: any) {
      console.error('Error initializing profile settings:', e);
    } finally {
      this.loading.set(false);
    }
  }

  async loadRootCategories() {
    try {
      const { data, error } = await this.supabase.db
        .from('question_categories')
        .select('id, name')
        .is('parent_id', null)
        .order('name', { ascending: true });

      if (error) throw error;
      if (data) {
        this.specializationOptions = data.map(c => ({
          label: c.name,
          value: c.id
        }));
      }
    } catch (error: any) {
      console.error('Error loading subjects/categories:', error.message);
    }
  }

  async loadProfile() {
    const user = this.supabase.currentUser();
    if (!user) {
      this.router.navigate(['/auth']);
      return;
    }

    try {
      const { data, error } = await this.supabase.db
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        this.profile = {
          ...this.profile,
          ...data,
          full_name: data.full_name || '',
          bio: data.bio || '',
          department: data.department || '',
          specialization: data.specialization || [],
          phone: data.phone || '',
          is_public: data.is_public ?? true,
          avatar_url: data.avatar_url || '',
          avatar_scale: Number(data.avatar_scale) || 1,
          avatar_pos_x: Number(data.avatar_pos_x ?? 50),
          avatar_pos_y: Number(data.avatar_pos_y ?? 50)
        };
      }
    } catch (error: any) {
      this.showToast('Error loading profile', error.message, 'error');
    }
  }

  async saveProfile() {
    const user = this.supabase.currentUser();
    if (!user) return;

    this.saving.set(true);
    try {
      // 1. Update Profile in DB
      const { error: dbError } = await this.supabase.db
        .from('profiles')
        .upsert({
          id: user.id,
          ...this.profile,
          updated_at: new Date().toISOString()
        });

      if (dbError) throw dbError;

      // Ensure numbers for metadata
      const metaScale = Number(this.profile.avatar_scale) || 1;
      const posX = Number(this.profile.avatar_pos_x ?? 50);
      const posY = Number(this.profile.avatar_pos_y ?? 50);

      // 2. Sync with Supabase Auth Metadata
      const { error: authError } = await this.supabase.auth.updateUser({
        data: { 
          full_name: this.profile.full_name,
          avatar_url: this.profile.avatar_url,
          avatar_scale: metaScale,
          avatar_pos_x: posX,
          avatar_pos_y: posY
        }
      });

      if (authError) throw authError;

      this.showToast('Success', 'Profile updated successfully!', 'success');
    } catch (error: any) {
      this.showToast('Save failed', error.message, 'error');
    } finally {
      this.saving.set(false);
    }
  }

  private showToast(summary: string, detail: string, severity: 'success' | 'error' | 'info') {
    this.messageService.add({ severity, summary, detail, life: 3000 });
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      await this.uploadAvatar(file);
    }
  }

  async uploadAvatar(file: File) {
    const user = this.supabase.currentUser();
    if (!user) return;

    this.saving.set(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${Math.random()}.${fileExt}`;

      // 1. Upload to Supabase Storage
      const { error: uploadError } = await this.supabase.db.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // 2. Get Public URL
      const { data: { publicUrl } } = this.supabase.db.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // 3. Update local state
      this.profile.avatar_url = publicUrl;

      // 4. Save to DB and Auth immediately
      await this.saveProfile();
    } catch (error: any) {
      this.showToast('Upload failed', error.message, 'error');
    } finally {
      this.saving.set(false);
    }
  }

  async signOut() {
    await this.supabase.auth.signOut();
    this.router.navigate(['/auth']);
  }
}
