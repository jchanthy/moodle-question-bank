import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  PreTestService,
  TestRoomPublicInfo,
  TestRoomAdminItem,
  RoomParticipantResult
} from '../services/pre-test.service';

@Component({
  selector: 'app-room-presenter',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './room-presenter.html'
})
export class RoomPresenterComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private preTestService = inject(PreTestService);

  roomCode = signal<string>('');
  publicInfo = signal<TestRoomPublicInfo | null>(null);
  adminRoom = signal<TestRoomAdminItem | null>(null);
  participants = signal<RoomParticipantResult[]>([]);
  loading = signal<boolean>(true);
  errorMessage = signal<string | null>(null);

  copiedCode = signal<boolean>(false);
  copiedLink = signal<boolean>(false);
  isFullscreen = signal<boolean>(false);
  showParticipantsPanel = signal<boolean>(false);

  private refreshTimer: any = null;

  displayTitle = computed(() => this.adminRoom()?.title || this.publicInfo()?.title || 'Pre-Test Room');
  displaySubject = computed(() => this.adminRoom()?.subject_name || this.publicInfo()?.subject_name || '');
  isLive = computed(() => {
    const admin = this.adminRoom();
    if (admin) return admin.is_active;
    return this.publicInfo()?.status === 'open';
  });
  questionCount = computed(() => this.publicInfo()?.question_count ?? 0);
  timeLimit = computed(() => this.adminRoom()?.time_limit_minutes ?? this.publicInfo()?.time_limit_minutes ?? null);
  attemptsCount = computed(() => {
    if (this.participants().length > 0) return this.participants().length;
    return this.adminRoom()?.attempts ?? 0;
  });
  avgPercentage = computed(() => this.adminRoom()?.avg_percentage ?? null);

  async ngOnInit() {
    this.route.paramMap.subscribe(async params => {
      const code = (params.get('code') || '').trim().toUpperCase();
      this.roomCode.set(code);
      if (code) {
        await this.loadRoomData(code, true);
        this.startLivePolling(code);
      } else {
        this.errorMessage.set('Invalid room code.');
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy() {
    this.stopLivePolling();
  }

  private startLivePolling(code: string) {
    this.stopLivePolling();
    this.refreshTimer = setInterval(() => {
      this.loadRoomData(code, false);
    }, 5000);
  }

  private stopLivePolling() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async loadRoomData(code: string, showLoader = false) {
    if (showLoader) {
      this.loading.set(true);
      this.errorMessage.set(null);
    }

    try {
      const pub = await this.preTestService.getRoomPublicInfo(code);
      if (pub) {
        this.publicInfo.set(pub);
      }

      // Also fetch admin room stats & participant submissions if logged in as admin
      try {
        const rooms = await this.preTestService.listRooms();
        const found = rooms.find(r => r.room_code.toUpperCase() === code);
        if (found) {
          this.adminRoom.set(found);
          const results = await this.preTestService.getRoomResults(found.id);
          this.participants.set(results);
        }
      } catch {
        // Ignore if viewing on an unauthenticated projector screen
      }

      if (!pub && !this.adminRoom()) {
        this.errorMessage.set(`Room "#${code}" was not found.`);
      }
    } catch (err: any) {
      if (showLoader) {
        this.errorMessage.set(err.message || 'Could not load room details.');
      }
    } finally {
      if (showLoader) {
        this.loading.set(false);
      }
    }
  }

  getBaseTestUrl(): string {
    return `${window.location.origin}/test`;
  }

  getRoomUrl(): string {
    return `${window.location.origin}/test?room=${this.roomCode()}`;
  }

  getRoomQrUrl(): string {
    const url = this.getRoomUrl();
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=12&data=${encodeURIComponent(url)}`;
  }

  async copyCode() {
    try {
      await navigator.clipboard.writeText(this.roomCode());
      this.copiedCode.set(true);
      setTimeout(() => this.copiedCode.set(false), 2000);
    } catch {}
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.getRoomUrl());
      this.copiedLink.set(true);
      setTimeout(() => this.copiedLink.set(false), 2000);
    } catch {}
  }

  async toggleRoomStatus() {
    const room = this.adminRoom();
    if (!room) return;
    const next = !room.is_active;
    try {
      await this.preTestService.setRoomActive(room.id, next);
      this.adminRoom.set({ ...room, is_active: next });
      await this.loadRoomData(this.roomCode(), false);
    } catch {}
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => {
        this.isFullscreen.set(true);
      }).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => {
        this.isFullscreen.set(false);
      }).catch(() => {});
    }
  }

  goBackToAdmin() {
    this.router.navigate(['/admin']);
  }
}
