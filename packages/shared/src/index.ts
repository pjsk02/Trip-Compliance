// Shared types consumed by both backend and frontend

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Trip {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  ownerId: string;
  members: User[];
  createdAt: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}
