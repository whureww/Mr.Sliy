const BASE_URL = '/api';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export async function apiGet<T>(url: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
  const query = params ? new URLSearchParams(params).toString() : '';
  const response = await fetch(`${BASE_URL}${url}${query ? `?${query}` : ''}`);
  return response.json();
}

export async function apiPost<T>(url: string, data?: Record<string, any>): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return response.json();
}

export async function apiPut<T>(url: string, data?: Record<string, any>): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${url}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return response.json();
}

export async function apiDelete<T>(url: string): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${url}`, {
    method: 'DELETE',
  });
  return response.json();
}

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  language: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  type: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  column: number;
  code: string;
  suggestion: string;
  status: string;
  created_at: string;
}

export interface UpdateRecord {
  id: string;
  update_type: string;
  target_version: string;
  current_version: string;
  update_source: string;
  update_content: string;
  status: string;
  user_confirmed: boolean;
  confirmed_at: string;
  applied_at: string;
  rollback_version: string;
  rollback_at: string;
  created_at: string;
}

export interface RepairRecord {
  id: string;
  error_type: string;
  error_message: string;
  error_stack: string;
  affected_component: string;
  repair_strategy: string;
  repair_content: string;
  status: string;
  user_confirmed: boolean;
  confirmed_at: string;
  applied_at: string;
  rollback_at: string;
  created_at: string;
}

export const projectApi = {
  list: () => apiGet<Project[]>('/projects'),
  get: (id: string) => apiGet<Project>(`/projects/${id}`),
  create: (data: Partial<Project>) => apiPost<Project>('/projects', data),
  update: (id: string, data: Partial<Project>) => apiPut<Project>(`/projects/${id}`, data),
  delete: (id: string) => apiDelete(`/projects/${id}`),
};

export const scanApi = {
  scan: (projectId: string) => apiPost(`/scan/${projectId}`),
  status: (projectId: string) => apiGet(`/scan/${projectId}/status`),
  results: (projectId: string) => apiGet(`/scan/${projectId}/results`),
};

export const issueApi = {
  list: (params?: { projectId?: string; status?: string; severity?: string }) => 
    apiGet<Issue[]>('/issues', params),
  get: (id: string) => apiGet<Issue>(`/issues/${id}`),
  update: (id: string, data: Partial<Issue>) => apiPut(`/issues/${id}`, data),
};

export const aiApi = {
  optimize: (data: { projectId: string; issueIds?: string[] }) => 
    apiPost('/ai/optimize', data),
  analyze: (data: { code: string; language?: string }) => 
    apiPost('/ai/analyze', data),
};

export const updateApi = {
  list: (params?: { limit?: number; status?: string }) => 
    apiGet<UpdateRecord[]>('/updates', params),
  get: (id: string) => apiGet<UpdateRecord>(`/updates/${id}`),
  create: (data: { updateType: string; content: string; autoConfirm?: boolean }) => 
    apiPost('/updates', data),
  execute: (id: string, data?: { autoConfirm?: boolean }) => 
    apiPost(`/updates/${id}/execute`, data),
  rollback: (id: string) => apiPost(`/updates/${id}/rollback`),
  rollbackByVersion: (version: string) => apiPost(`/updates/rollback/version/${version}`),
  check: () => apiPost('/check-update'),
};

export const repairApi = {
  list: (params?: { limit?: number; status?: string }) => 
    apiGet<RepairRecord[]>('/repairs', params),
  get: (id: string) => apiGet<RepairRecord>(`/repairs/${id}`),
  execute: (id: string, data?: { autoConfirm?: boolean }) => 
    apiPost(`/repairs/${id}/execute`, data),
  rollback: (id: string) => apiPost(`/repairs/${id}/rollback`),
  run: (data?: { autoFix?: boolean }) => apiPost('/run-repair', data),
};

export const configApi = {
  get: () => apiGet('/config'),
  update: (data: Record<string, any>) => apiPut('/config', data),
};

export const healthApi = {
  check: () => fetch('/health').then(res => res.json()),
};