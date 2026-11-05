export type VehicleType = 'van' | 'pickup' | 'car' | 'tipper' | 'plant_other';
export type VehicleFuelType = 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'other';
export type VehicleStatus = 'active' | 'off_road' | 'sold';
export type ExpiryState = 'ok' | 'due_soon' | 'overdue' | 'unset';

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  van: 'Van',
  pickup: 'Pickup',
  car: 'Car',
  tipper: 'Tipper',
  plant_other: 'Plant / other',
};

export const VEHICLE_FUEL_LABELS: Record<VehicleFuelType, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  electric: 'Electric',
  hybrid: 'Hybrid',
  other: 'Other',
};

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'Active',
  off_road: 'Off road',
  sold: 'Sold',
};

export interface BlockReason {
  code:
    | 'mot_expired'
    | 'road_tax_expired'
    | 'insurance_expired'
    | 'status_not_active'
    | 'open_defect'
    | 'check_missing'
    | 'check_failed';
  message: string;
}

export interface ExpiryItem {
  key: 'mot' | 'road_tax' | 'insurance' | 'service_date' | 'service_mileage';
  label: string;
  state: ExpiryState;
  due_date?: string;
  days_until?: number;
  message?: string;
}

export interface VehicleAllocation {
  id: string;
  vehicle_id: string;
  user_id: string;
  user_name?: string;
  project_id?: string;
  project_name?: string;
  start_date: string;
  end_date?: string;
  until_further_notice: boolean;
  assigned_by_user_id: string;
  assigned_by_name?: string;
  assigned_at: string;
  ended_at?: string;
  ended_by_user_id?: string;
  active: boolean;
}

export interface VehicleCheck {
  id: string;
  vehicle_id: string;
  user_id: string;
  user_name?: string;
  mileage: number;
  has_defects: boolean;
  unsafe: boolean;
  result: 'pass' | 'fail';
  notes?: string;
  checked_on: string;
  created_at: string;
}

export interface VehicleDefect {
  id: string;
  vehicle_id: string;
  check_id: string;
  notes: string;
  status: 'open' | 'resolved';
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  resolved_at?: string;
  resolution_notes?: string;
  created_at: string;
}

export interface Vehicle {
  id: string;
  company_id: string;
  registration: string;
  registration_display: string;
  make: string;
  model: string;
  type: VehicleType;
  colour: string;
  fuel_type: VehicleFuelType;
  vin?: string;
  mot_due?: string;
  road_tax_due?: string;
  insurance_expiry?: string;
  service_due_date?: string;
  service_due_mileage?: number;
  current_mileage?: number;
  notes?: string;
  status: VehicleStatus;
  photo_url?: string;
  project_id?: string;
  project_name?: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
  compliance: {
    items: ExpiryItem[];
    has_warning: boolean;
    worst: ExpiryState;
  };
  block_reasons: BlockReason[];
  allocate_block_reasons: BlockReason[];
  usable_today: boolean;
  allocatable: boolean;
  current_allocation?: VehicleAllocation;
  today_check?: VehicleCheck;
  open_defects?: VehicleDefect[];
  allocations?: VehicleAllocation[];
  checks?: VehicleCheck[];
  defects?: VehicleDefect[];
}

export interface VehicleWrite {
  registration: string;
  make: string;
  model: string;
  type: VehicleType;
  colour: string;
  fuel_type: VehicleFuelType;
  vin?: string | null;
  mot_due?: string | null;
  road_tax_due?: string | null;
  insurance_expiry?: string | null;
  service_due_date?: string | null;
  service_due_mileage?: number | null;
  current_mileage?: number | null;
  notes?: string | null;
  status: VehicleStatus;
  photo_url?: string | null;
  project_id?: string | null;
}

export interface VehicleAllocateInput {
  user_id: string;
  start_date: string;
  end_date?: string | null;
  until_further_notice?: boolean;
  project_id?: string | null;
}

export interface VehicleCheckInput {
  mileage: number;
  has_defects: boolean;
  unsafe?: boolean;
  notes?: string;
}
