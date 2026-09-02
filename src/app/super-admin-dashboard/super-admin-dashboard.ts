import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { SupabaseService, CompensationSettings, DEFAULT_COMPENSATION_SETTINGS } from '../services/supabase.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

interface CustomRole {
  name: string;
  description: string;
  permissions: string[];
}

interface UserRecord {
  id: string;
  email: string;
  full_name: string;
  role: string;
  specialization: string[];
  permissions: string[];
  approval_status: 'pending' | 'approved' | 'suspended';
}

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ToastModule],
  providers: [MessageService],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css'
})
export class SuperAdminDashboardComponent implements OnInit {
  private supabaseService = inject(SupabaseService);
  private messageService = inject(MessageService);
  private router = inject(Router);

  // States
  currentView = signal<'users' | 'roles' | 'compensation'>('users');
  loading = signal(false);
  savingCompensation = signal(false);
  
  // Compensation Settings State
  compensationForm: CompensationSettings = {
    ...DEFAULT_COMPENSATION_SETTINGS,
    qtypeRates: { ...DEFAULT_COMPENSATION_SETTINGS.qtypeRates }
  };

  questionTypeKeys: string[] = ['multichoice', 'truefalse', 'shortanswer', 'match', 'gapfill', 'ddmarker', 'essay'];
  questionTypeLabels: Record<string, string> = {
    multichoice: 'Multiple Choice (MCQ)',
    truefalse: 'True / False',
    shortanswer: 'Short Answer / Fill-in',
    match: 'Matching',
    gapfill: 'Cloze / Gapfill',
    ddmarker: 'Drag & Drop Markers',
    essay: 'Essay / Descriptive'
  };

  // Live Simulator State
  simAuthorCount = signal(20);
  simReviewCount = signal(10);
  simQType = signal('multichoice');

  simulatedAuthorEarnings = computed(() => {
    const count = this.simAuthorCount();
    const qtype = this.simQType();
    const qRate = this.compensationForm.qtypeRates?.[qtype];
    const rate = (qRate !== undefined && qRate !== null && !isNaN(Number(qRate)))
      ? Number(qRate)
      : Number(this.compensationForm.creatorBaseRate || 0);
    return Math.round(count * rate * 100) / 100;
  });

  simulatedReviewEarnings = computed(() => {
    const count = this.simReviewCount();
    const rate = Number(this.compensationForm.reviewerBaseRate || 0);
    return Math.round(count * rate * 100) / 100;
  });

  simulatedTotalEarnings = computed(() => {
    return Math.round((this.simulatedAuthorEarnings() + this.simulatedReviewEarnings()) * 100) / 100;
  });
  
  // Dynamic Lists loaded from System config
  allProfiles = signal<any[]>([]);
  registryUsers = signal<{ [key: string]: UserRecord }>({});
  customRoles = signal<CustomRole[]>([]);
  
  // Available permissions pool
  availablePermissions = signal<{ key: string; name: string; description: string }[]>([
    { key: 'manage_users', name: 'User Management', description: 'Enable, disable, and approve user accounts' },
    { key: 'manage_roles', name: 'Role Customization', description: 'Add, edit, and define system roles and permission sets' },
    { key: 'create_question', name: 'Create Questions', description: 'Draft and format new questions' },
    { key: 'edit_question', name: 'Edit Questions', description: 'Edit existing drafted or reviewed questions' },
    { key: 'review_question', name: 'Review & Approve', description: 'Approve, reject, or comment on submitted questions' },
    { key: 'manage_categories', name: 'Manage Categories', description: 'Create and structure question categories' },
    { key: 'manage_tags', name: 'Manage Tags', description: 'Add, organize, and structure system-wide taxonomy tags' },
    { key: 'view_audit_logs', name: 'Audit & Reports', description: 'Access audit logs and general system reporting' }
  ]);

  // Search & Filter
  userSearchKeyword = signal('');
  
  // Modal controllers
  showEditUserModal = signal(false);
  editingUser = signal<any | null>(null);
  
  // Form values
  userForm = {
    email: '',
    fullName: '',
    role: '',
    specialization: [] as string[],
    permissions: [] as string[]
  };

  // Role Form values
  showAddRoleModal = signal(false);
  roleForm = {
    name: '',
    description: '',
    permissions: [] as string[]
  };

  // Categories for specializations
  categories = signal<any[]>([]);
  rootCategories = computed(() => {
    return this.categories().filter(c => !c.parent_id);
  });

  // Filtered profiles for rendering
  filteredProfiles = computed(() => {
    const search = this.userSearchKeyword().toLowerCase().trim();
    const profiles = this.allProfiles();
    
    return profiles.filter(p => {
      const emailMatch = p.email?.toLowerCase().includes(search);
      const nameMatch = p.full_name?.toLowerCase().includes(search);
      return !search || emailMatch || nameMatch;
    }).map(p => {
      const reg = this.registryUsers()[p.id];
      const isSuspended = p.bio === 'suspended' || reg?.approval_status === 'suspended';
      const isPending = p.bio === 'pending' || reg?.approval_status === 'pending';
      
      return {
        ...p,
        role: reg?.role || p.department || 'teacher',
        permissions: reg?.permissions || [],
        isSuspended,
        isPending,
        status: isSuspended ? 'suspended' : (isPending ? 'pending' : 'approved')
      };
    });
  });

  ngOnInit() {
    this.loadInitialData();
  }

  async loadInitialData() {
    this.loading.set(true);
    try {
      await Promise.all([
        this.loadUsersAndConfig(),
        this.loadCategories(),
        this.loadCompensationSettings()
      ]);
    } catch (err: any) {
      this.showToast('Failed to load system data: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async loadCompensationSettings() {
    try {
      const settings = await this.supabaseService.getCompensationSettings();
      this.compensationForm = {
        ...settings,
        qtypeRates: {
          ...DEFAULT_COMPENSATION_SETTINGS.qtypeRates,
          ...(settings.qtypeRates || {})
        }
      };
    } catch (e) {
      console.warn('Failed to load compensation settings in super-admin:', e);
    }
  }

  async saveCompensationSettings() {
    this.savingCompensation.set(true);
    try {
      // Auto-update currency symbol based on chosen currency code
      if (this.compensationForm.currency === 'USD') {
        this.compensationForm.currencySymbol = '$';
      } else if (this.compensationForm.currency === 'KHR') {
        this.compensationForm.currencySymbol = '៛';
      }

      const success = await this.supabaseService.saveCompensationSettings(this.compensationForm);
      if (success) {
        this.showToast('Compensation & Cost rates updated successfully!', 'success');
      } else {
        throw new Error('Database save returned failure.');
      }
    } catch (err: any) {
      this.showToast('Failed to save compensation rates: ' + err.message, 'error');
    } finally {
      this.savingCompensation.set(false);
    }
  }

  onCurrencyChange(newCurrency: string) {
    this.compensationForm.currency = newCurrency;
    if (newCurrency === 'USD') {
      this.compensationForm.currencySymbol = '$';
      if (this.compensationForm.creatorBaseRate > 100) this.compensationForm.creatorBaseRate = 0.50;
      if (this.compensationForm.reviewerBaseRate > 100) this.compensationForm.reviewerBaseRate = 0.25;
      if (this.compensationForm.approverBaseRate > 100) this.compensationForm.approverBaseRate = 0.10;
    } else if (newCurrency === 'KHR') {
      this.compensationForm.currencySymbol = '៛';
      if (this.compensationForm.creatorBaseRate < 10) this.compensationForm.creatorBaseRate = 2000;
      if (this.compensationForm.reviewerBaseRate < 10) this.compensationForm.reviewerBaseRate = 1000;
      if (this.compensationForm.approverBaseRate < 10) this.compensationForm.approverBaseRate = 500;
    }
  }

  async loadCategories() {
    try {
      const { data, error } = await this.supabaseService.db
        .from('question_categories')
        .select('*')
        .order('name', { ascending: true });
      if (!error && data) {
        this.categories.set(data);
      }
    } catch (e) {
      console.warn('Failed to load categories', e);
    }
  }

  async loadUsersAndConfig() {
    // 1. Fetch DB Profiles
    const { data: dbProfiles, error: pErr } = await this.supabaseService.db
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true });
    if (pErr) throw pErr;

    // 2. Fetch system configuration metadata row
    const metadata = await this.supabaseService.getSystemMetadata();
    
    // Parse roles and user registry
    const usersRegistry = metadata.users || {};
    const rolesList = metadata.customRoles || this.getDefaultRoles();
    
    this.registryUsers.set(usersRegistry);
    this.customRoles.set(rolesList);
    this.allProfiles.set(dbProfiles || []);
  }

  getDefaultRoles(): CustomRole[] {
    return [
      { name: 'super_admin', description: 'Full system privileges, user administration, and role customization.', permissions: ['manage_users', 'manage_roles', 'create_question', 'edit_question', 'review_question', 'manage_categories', 'manage_tags', 'view_audit_logs'] },
      { name: 'admin', description: 'System administration, question reviewing, category auditing, and logs view.', permissions: ['review_question', 'manage_categories', 'manage_tags', 'view_audit_logs'] },
      { name: 'teacher', description: 'Senior educator role, drafting questions and managing category banks.', permissions: ['create_question', 'edit_question', 'review_question'] },
      { name: 'assistant_teacher', description: 'Junior educator role, draft-only access to question banks.', permissions: ['create_question'] }
    ];
  }

  // Toggles active/suspended access status of a user
  async toggleUserStatus(profile: any) {
    this.loading.set(true);
    const newStatus = profile.isSuspended ? 'approved' : 'suspended';
    
    try {
      // 1. Update profiles table
      const { error: dbErr } = await this.supabaseService.db
        .from('profiles')
        .update({ bio: newStatus })
        .eq('id', profile.id);
      if (dbErr) throw dbErr;

      // 2. Update registry metadata row
      const metadata = await this.supabaseService.getSystemMetadata();
      if (!metadata.users) metadata.users = {};
      
      if (!metadata.users[profile.id]) {
        metadata.users[profile.id] = {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name || 'Anonymous',
          role: profile.role,
          specialization: profile.specialization || [],
          permissions: [],
          approval_status: newStatus
        };
      } else {
        metadata.users[profile.id].approval_status = newStatus;
      }
      
      await this.supabaseService.saveSystemMetadata(metadata);
      this.showToast(`User account status updated to: ${newStatus === 'suspended' ? 'Disabled' : 'Enabled'}`, 'success');
      await this.loadUsersAndConfig();
    } catch (err: any) {
      this.showToast('Failed to toggle status: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  // Open user edit modal
  editUser(profile: any) {
    this.editingUser.set(profile);
    const reg = this.registryUsers()[profile.id];
    
    this.userForm = {
      email: profile.email || '',
      fullName: profile.full_name || '',
      role: profile.role || 'teacher',
      specialization: profile.specialization || [],
      permissions: reg?.permissions || []
    };
    
    this.showEditUserModal.set(true);
  }

  toggleSpecialization(catId: string) {
    const idx = this.userForm.specialization.indexOf(catId);
    if (idx > -1) {
      this.userForm.specialization.splice(idx, 1);
    } else {
      this.userForm.specialization.push(catId);
    }
  }

  togglePermission(permKey: string) {
    const idx = this.userForm.permissions.indexOf(permKey);
    if (idx > -1) {
      this.userForm.permissions.splice(idx, 1);
    } else {
      this.userForm.permissions.push(permKey);
    }
  }

  // Updates user profile, role, specializations, and direct permissions override
  async saveUserChanges() {
    const target = this.editingUser();
    if (!target) return;

    this.loading.set(true);
    const f = this.userForm;
    
    try {
      // 1. Sync relationally in database (Clean role for check constraint: admin/teacher/assistant_teacher)
      let cleanRole = f.role;
      if (cleanRole !== 'admin' && cleanRole !== 'teacher' && cleanRole !== 'assistant_teacher') {
        cleanRole = 'teacher'; // Bypasses check constraint but remains correct in metadata
      }
      
      const { error: roleErr } = await this.supabaseService.db
        .from('user_roles')
        .upsert({ user_id: target.id, role: cleanRole }, { onConflict: 'user_id' });
      if (roleErr) throw roleErr;

      const { error: profErr } = await this.supabaseService.db
        .from('profiles')
        .upsert({
          id: target.id,
          full_name: f.fullName,
          specialization: f.specialization,
          department: f.role, // Safe custom role label in department!
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      if (profErr) throw profErr;

      // 2. Sync to central system metadata row
      const metadata = await this.supabaseService.getSystemMetadata();
      if (!metadata.users) metadata.users = {};
      
      metadata.users[target.id] = {
        id: target.id,
        email: target.email,
        full_name: f.fullName,
        role: f.role,
        specialization: f.specialization,
        permissions: f.permissions,
        approval_status: target.isSuspended ? 'suspended' : (target.isPending ? 'pending' : 'approved')
      };
      
      await this.supabaseService.saveSystemMetadata(metadata);
      
      this.showToast(`User settings for ${f.fullName} saved successfully`, 'success');
      this.showEditUserModal.set(false);
      this.editingUser.set(null);
      await this.loadUsersAndConfig();
    } catch (err: any) {
      this.showToast('Failed to save changes: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  // Dynamic Roles management
  async registerNewRole() {
    if (!this.roleForm.name) {
      this.showToast('Role name is required.', 'error');
      return;
    }
    
    this.loading.set(true);
    const rName = this.roleForm.name.toLowerCase().replace(/\s+/g, '_');
    
    try {
      const metadata = await this.supabaseService.getSystemMetadata();
      if (!metadata.customRoles) metadata.customRoles = this.getDefaultRoles();
      
      // Check duplicate
      if (metadata.customRoles.some((r: any) => r.name === rName)) {
        throw new Error('A role with this name already exists.');
      }
      
      metadata.customRoles.push({
        name: rName,
        description: this.roleForm.description || 'Custom defined role.',
        permissions: this.roleForm.permissions
      });
      
      await this.supabaseService.saveSystemMetadata(metadata);
      this.showToast(`Custom role "${rName}" created successfully!`, 'success');
      this.showAddRoleModal.set(false);
      
      // Reset form
      this.roleForm = { name: '', description: '', permissions: [] };
      await this.loadUsersAndConfig();
    } catch (err: any) {
      this.showToast(err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async deleteRole(roleName: string) {
    if (['super_admin', 'admin', 'teacher', 'assistant_teacher'].includes(roleName)) {
      this.showToast('Cannot delete default system roles.', 'error');
      return;
    }

    this.loading.set(true);
    try {
      const metadata = await this.supabaseService.getSystemMetadata();
      if (!metadata.customRoles) metadata.customRoles = this.getDefaultRoles();
      
      metadata.customRoles = metadata.customRoles.filter((r: any) => r.name !== roleName);
      
      // Downgrade any users holding this custom role to default teacher
      if (metadata.users) {
        for (const uid of Object.keys(metadata.users)) {
          if (metadata.users[uid].role === roleName) {
            metadata.users[uid].role = 'teacher';
          }
        }
      }
      
      await this.supabaseService.saveSystemMetadata(metadata);
      this.showToast(`Role "${roleName}" has been successfully removed.`, 'success');
      await this.loadUsersAndConfig();
    } catch (err: any) {
      this.showToast('Failed to delete role: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  toggleFormRolePermission(permKey: string) {
    const idx = this.roleForm.permissions.indexOf(permKey);
    if (idx > -1) {
      this.roleForm.permissions.splice(idx, 1);
    } else {
      this.roleForm.permissions.push(permKey);
    }
  }

  // General helpers
  getSpecializationNames(specIds: string[]): string {
    if (!specIds || specIds.length === 0) return 'None (All Categories)';
    return specIds
      .map(id => this.categories().find(c => c.id === id)?.name || id)
      .join(', ');
  }

  showToast(detail: string, severity: 'success' | 'error' | 'info' = 'success', summary = 'Super Admin Panel') {
    this.messageService.add({ severity, summary, detail });
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }
}
