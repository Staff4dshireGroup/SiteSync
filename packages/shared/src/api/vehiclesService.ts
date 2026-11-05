import axiosInstance from './axiosInstance';
import type { Vehicle, VehicleAllocateInput, VehicleCheckInput, VehicleStatus, VehicleWrite } from '../models/vehicle';

export const vehiclesService = {
  async list(params?: {
    q?: string;
    status?: VehicleStatus;
    allocated_to?: string;
    archived?: boolean;
    include_archived?: boolean;
  }): Promise<Vehicle[]> {
    const { data } = await axiosInstance.get<Vehicle[]>('/vehicles', {
      params: {
        ...params,
        archived: params?.archived ? 'true' : undefined,
        include_archived: params?.include_archived ? 'true' : undefined,
      },
    });
    return data;
  },

  async mine(): Promise<Vehicle[]> {
    const { data } = await axiosInstance.get<Vehicle[]>('/vehicles/mine');
    return data;
  },

  async getById(id: string): Promise<Vehicle> {
    const { data } = await axiosInstance.get<Vehicle>(`/vehicles/${id}`);
    return data;
  },

  async create(vehicle: VehicleWrite): Promise<Vehicle> {
    const { data } = await axiosInstance.post<Vehicle>('/vehicles', vehicle);
    return data;
  },

  async update(id: string, vehicle: Partial<VehicleWrite>): Promise<Vehicle> {
    const { data } = await axiosInstance.put<Vehicle>(`/vehicles/${id}`, vehicle);
    return data;
  },

  async archive(id: string, archived = true): Promise<Vehicle> {
    const { data } = await axiosInstance.post<Vehicle>(`/vehicles/${id}/archive`, { archived });
    return data;
  },

  async allocate(id: string, input: VehicleAllocateInput): Promise<Vehicle> {
    const { data } = await axiosInstance.post<Vehicle>(`/vehicles/${id}/allocate`, input);
    return data;
  },

  async unallocate(id: string): Promise<Vehicle> {
    const { data } = await axiosInstance.post<Vehicle>(`/vehicles/${id}/unallocate`);
    return data;
  },

  async addCheck(id: string, input: VehicleCheckInput): Promise<Vehicle> {
    const { data } = await axiosInstance.post<Vehicle>(`/vehicles/${id}/checks`, input);
    return data;
  },

  async resolveDefect(vehicleId: string, defectId: string, resolutionNotes: string): Promise<Vehicle> {
    const { data } = await axiosInstance.post<Vehicle>(`/vehicles/${vehicleId}/defects/${defectId}/resolve`, {
      resolution_notes: resolutionNotes,
    });
    return data;
  },

  async useToday(id: string): Promise<{ ok: boolean; used_on: string; vehicle: Vehicle }> {
    const { data } = await axiosInstance.post<{ ok: boolean; used_on: string; vehicle: Vehicle }>(`/vehicles/${id}/use`);
    return data;
  },
};
