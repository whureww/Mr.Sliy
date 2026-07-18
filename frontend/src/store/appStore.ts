import { create } from 'zustand';
import { Project, Issue, UpdateRecord, RepairRecord } from '@/lib/api';

interface AppState {
  projects: Project[];
  issues: Issue[];
  updates: UpdateRecord[];
  repairs: RepairRecord[];
  selectedProject: Project | null;
  currentPage: string;
  isLoading: boolean;
  loadingMessage: string;
  error: string | null;

  setProjects: (projects: Project[]) => void;
  setIssues: (issues: Issue[]) => void;
  setUpdates: (updates: UpdateRecord[]) => void;
  setRepairs: (repairs: RepairRecord[]) => void;
  setSelectedProject: (project: Project | null) => void;
  setCurrentPage: (page: string) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  issues: [],
  updates: [],
  repairs: [],
  selectedProject: null,
  currentPage: 'dashboard',
  isLoading: false,
  loadingMessage: '',
  error: null,

  setProjects: (projects) => set({ projects }),
  setIssues: (issues) => set({ issues }),
  setUpdates: (updates) => set({ updates }),
  setRepairs: (repairs) => set({ repairs }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));