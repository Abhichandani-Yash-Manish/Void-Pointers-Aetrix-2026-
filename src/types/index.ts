export type UserRole = 'pharmacist' | 'manager' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Drug {
  id: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  currentStock: number;
}

export interface Batch {
  id: string;
  drugId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string; // ISO date string
  receivedDate: string;
  costPerUnit: number;
}

export interface DispenseLog {
  id: string;
  drugId: string;
  drugName: string;
  batchId: string;
  batchNumber: string;
  quantity: number;
  dispensedBy: string;
  timestamp: string;
}

export interface Alert {
  id: string;
  type: 'low_stock' | 'near_expiry' | 'expired';
  drugId: string;
  drugName: string;
  message: string;
  severity: 'warning' | 'critical';
  read: boolean;
  createdAt: string;
}
