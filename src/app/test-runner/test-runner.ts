import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import {
  PreTestService,
  TestingSubject,
  CandidateQuestion,
  TestSubmitResponse,
  TestRoomPublicInfo
} from '../services/pre-test.service';

@Component({
  selector: 'app-test-runner',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './test-runner.html',
  styleUrls: ['./test-runner.css']
})
export class TestRunnerComponent implements OnInit, OnDestroy {
  preTestService = inject(PreTestService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Mode: free practice OR room code/URL test
  mode = signal<'practice' | 'room'>('practice');

  // Room State
  roomCodeInput = signal<string>('');
  roomInfo = signal<TestRoomPublicInfo | null>(null);
  roomPasscode = signal<string>('');
  participantName = signal<string>('');
  participantRole = signal<'student' | 'teacher'>('student');
  verifyingRoom = signal(false);

  // States
  stage = signal<'select_subject' | 'taking_test' | 'submitted'>('select_subject');
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  // Subject Selection State (Practice Mode)
  activeSubjects = signal<TestingSubject[]>([]);
  selectedSubjectId = signal<string>('');

  // Active Exam State
  sessionId = signal<string | null>(null);
  questions = signal<CandidateQuestion[]>([]);
  currentIndex = signal<number>(0);
  selectedAnswers = signal<Record<string, string | null>>({});
  flaggedQuestionIds = signal<Set<string>>(new Set());

  // Timer State
  timeLimitMinutes = signal<number | null>(null);
  elapsedSeconds = signal<number>(0);
  private timerInterval: any = null;

  // Submission Result State
  submitResult = signal<TestSubmitResponse | null>(null);
  showConfirmSubmitModal = signal(false);

  // Computed Properties
  currentQuestion = computed(() => {
    const list = this.questions();
    const idx = this.currentIndex();
    return list[idx] || null;
  });

  answeredCount = computed(() => {
    const answers = this.selectedAnswers();
    return Object.values(answers).filter(val => val !== null && val !== undefined).length;
  });

  unansweredCount = computed(() => {
    return this.questions().length - this.answeredCount();
  });

  progressPercentage = computed(() => {
    const total = this.questions().length;
    if (total === 0) return 0;
    return Math.round((this.answeredCount() / total) * 100);
  });

  formattedTime = computed(() => {
    const limit = this.timeLimitMinutes();
    if (limit && limit > 0) {
      const remaining = Math.max(0, limit * 60 - this.elapsedSeconds());
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    const totalSecs = this.elapsedSeconds();
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  });

  isTimeUrgent = computed(() => {
    const limit = this.timeLimitMinutes();
    if (!limit || limit <= 0) return false;
    const remaining = limit * 60 - this.elapsedSeconds();
    return remaining <= 120; // 2 minutes or less
  });

  selectedSubject = computed(() => {
    const subId = this.selectedSubjectId();
    return this.activeSubjects().find(s => s.id === subId) || null;
  });

  async ngOnInit() {
    // Check if URL has ?room=...
    const urlRoom = this.route.snapshot.queryParamMap.get('room');
    if (urlRoom && urlRoom.trim()) {
      this.mode.set('room');
      this.roomCodeInput.set(urlRoom.trim().toUpperCase());
      await this.lookupRoom(urlRoom.trim().toUpperCase());
    } else {
      await this.loadSubjects();
    }
  }

  ngOnDestroy() {
    this.stopTimer();
  }

  switchToPractice() {
    this.mode.set('practice');
    this.errorMessage.set(null);
    this.roomInfo.set(null);
    this.router.navigate([], { queryParams: { room: null }, queryParamsHandling: 'merge' });
    if (this.activeSubjects().length === 0) {
      this.loadSubjects();
    }
  }

  switchToRoom() {
    this.mode.set('room');
    this.errorMessage.set(null);
  }

  async lookupRoom(code?: string) {
    const targetCode = (code || this.roomCodeInput()).trim().toUpperCase();
    if (!targetCode) {
      this.errorMessage.set('Please enter a room code.');
      return;
    }

    this.verifyingRoom.set(true);
    this.errorMessage.set(null);

    try {
      const info = await this.preTestService.getRoomPublicInfo(targetCode);
      if (!info) {
        this.roomInfo.set(null);
        this.errorMessage.set(`Room "${targetCode}" was not found. Please check the code and try again.`);
      } else {
        this.roomInfo.set(info);
        this.roomCodeInput.set(info.room_code);
        if (info.audience !== 'any') {
          this.participantRole.set(info.audience);
        }
      }
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to verify room code.');
    } finally {
      this.verifyingRoom.set(false);
    }
  }

  async startRoomExam() {
    const info = this.roomInfo();
    if (!info) {
      this.errorMessage.set('Please look up a valid room first.');
      return;
    }

    if (info.status !== 'open') {
      this.errorMessage.set(`This test room is currently ${info.status}.`);
      return;
    }

    const name = this.participantName().trim();
    if (!name || name.length < 2) {
      this.errorMessage.set('Please enter your full name (at least 2 characters).');
      return;
    }

    if (info.requires_passcode && !this.roomPasscode().trim()) {
      this.errorMessage.set('This room requires a passcode. Please enter it.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.preTestService.startRoomTest(
        info.room_code,
        info.requires_passcode ? this.roomPasscode() : null,
        name,
        this.participantRole()
      );

      if (!res.ok || !res.session) {
        this.errorMessage.set(res.error || 'Failed to enter test room.');
        return;
      }

      const session = res.session;
      this.sessionId.set(session.session_id);
      this.questions.set(session.questions);
      this.timeLimitMinutes.set(session.time_limit_minutes || null);
      this.currentIndex.set(0);

      const initialAnswers: Record<string, string | null> = {};
      session.questions.forEach(q => {
        initialAnswers[q.id] = null;
      });
      this.selectedAnswers.set(initialAnswers);
      this.flaggedQuestionIds.set(new Set());

      this.elapsedSeconds.set(0);
      this.startTimer();
      this.stage.set('taking_test');
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Unable to join test room.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadSubjects() {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const subjects = await this.preTestService.getActiveSubjects();
      this.activeSubjects.set(subjects);
      if (subjects.length > 0 && !this.selectedSubjectId()) {
        this.selectedSubjectId.set(subjects[0].id);
      }
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to load test subjects');
    } finally {
      this.loading.set(false);
    }
  }

  async startExam() {
    const subjectId = this.selectedSubjectId();
    if (!subjectId) {
      this.errorMessage.set('Please select a subject to begin.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.preTestService.startExam(subjectId);
      if (!res.questions || res.questions.length === 0) {
        throw new Error('No questions available in the testing pool for this subject.');
      }

      this.sessionId.set(res.session_id);
      this.questions.set(res.questions);
      this.timeLimitMinutes.set(null);
      this.currentIndex.set(0);

      const initialAnswers: Record<string, string | null> = {};
      res.questions.forEach(q => {
        initialAnswers[q.id] = null;
      });
      this.selectedAnswers.set(initialAnswers);
      this.flaggedQuestionIds.set(new Set());

      this.elapsedSeconds.set(0);
      this.startTimer();

      this.stage.set('taking_test');
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Unable to start test session');
    } finally {
      this.loading.set(false);
    }
  }

  selectOption(questionId: string, optionId: string) {
    const current = { ...this.selectedAnswers() };
    current[questionId] = optionId;
    this.selectedAnswers.set(current);
  }

  clearSelection(questionId: string) {
    const current = { ...this.selectedAnswers() };
    current[questionId] = null;
    this.selectedAnswers.set(current);
  }

  toggleFlag(questionId: string) {
    const set = new Set(this.flaggedQuestionIds());
    if (set.has(questionId)) {
      set.delete(questionId);
    } else {
      set.add(questionId);
    }
    this.flaggedQuestionIds.set(set);
  }

  isFlagged(questionId: string): boolean {
    return this.flaggedQuestionIds().has(questionId);
  }

  goToQuestion(index: number) {
    if (index >= 0 && index < this.questions().length) {
      this.currentIndex.set(index);
    }
  }

  nextQuestion() {
    if (this.currentIndex() < this.questions().length - 1) {
      this.currentIndex.update(i => i + 1);
    }
  }

  prevQuestion() {
    if (this.currentIndex() > 0) {
      this.currentIndex.update(i => i - 1);
    }
  }

  promptSubmit() {
    this.showConfirmSubmitModal.set(true);
  }

  cancelSubmit() {
    this.showConfirmSubmitModal.set(false);
  }

  async confirmSubmit() {
    const sessId = this.sessionId();
    if (!sessId) return;

    this.showConfirmSubmitModal.set(false);
    this.loading.set(true);
    this.errorMessage.set(null);
    this.stopTimer();

    try {
      const answersList = Object.entries(this.selectedAnswers()).map(([question_id, selected_option_id]) => ({
        question_id,
        selected_option_id
      }));

      const result = await this.preTestService.submitExam(sessId, answersList);
      this.submitResult.set(result);
      this.stage.set('submitted');
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to submit test');
      this.startTimer();
    } finally {
      this.loading.set(false);
    }
  }

  retakeCurrentExam() {
    this.submitResult.set(null);
    if (this.mode() === 'room' && this.roomInfo()) {
      this.startRoomExam();
    } else {
      this.startExam();
    }
  }

  chooseAnotherSubject() {
    this.stopTimer();
    this.submitResult.set(null);
    this.sessionId.set(null);
    this.questions.set([]);
    this.stage.set('select_subject');
    if (this.mode() === 'practice') {
      this.loadSubjects();
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds.update(s => s + 1);
      const limit = this.timeLimitMinutes();
      if (limit && limit > 0 && this.elapsedSeconds() >= limit * 60) {
        // Auto-submit when time expires
        this.confirmSubmit();
      }
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  getResultItem(questionId: string) {
    const res = this.submitResult();
    if (!res || !res.breakdown) return null;
    return res.breakdown.find(b => b.question_id === questionId) || null;
  }

  getOptionText(question: CandidateQuestion, optionId: string | null): string {
    if (!optionId) return '<span class="italic text-slate-400">No answer selected</span>';
    const opt = question.options.find(o => o.id === optionId);
    return opt ? opt.answer_text : '<span class="italic text-slate-400">Option not found</span>';
  }
}
