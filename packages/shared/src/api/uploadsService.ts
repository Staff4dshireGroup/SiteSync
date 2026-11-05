import { Platform } from 'react-native';
import { config } from '../config/apiConfig';
import axiosInstance from './axiosInstance';

/**
 * Build multipart `file` part. On native RN, `{ uri, name, type }` is correct.
 * On web, that shape does not become a real file part — fetch the blob URL and append a Blob.
 */
async function appendUploadFile(
  formData: FormData,
  file: { uri: string; name: string; type: string }
): Promise<void> {
  const name = file.name?.trim() || 'upload.bin';
  const type = file.type?.trim() || 'application/octet-stream';

  if (Platform.OS === 'web') {
    const res = await fetch(file.uri);
    const blob = await res.blob();
    // Web FormData requires a Blob/File part; RN typings omit the filename overload.
    (formData as unknown as { append(k: string, v: Blob, filename?: string): void }).append(
      'file',
      blob,
      name
    );
    return;
  }

  formData.append('file', {
    uri: file.uri,
    name,
    type,
  } as unknown as Blob);
}

async function postMultipart(path: string, file: { uri: string; name: string; type: string }): Promise<string> {
  const formData = new FormData();
  await appendUploadFile(formData, file);
  const { data } = await axiosInstance.post<{ url: string }>(path, formData, {
    headers: {
      // Let the runtime set multipart boundaries.
      'Content-Type': 'multipart/form-data',
    },
  });
  return data.url;
}

export const uploadsService = {
  /**
   * Upload a file from React Native (uri + name + mime) and return the public file URL.
   * Uses fetch so multipart boundaries are not overridden by axios JSON defaults.
   */
  async uploadChatAttachment(file: { uri: string; name: string; type: string }): Promise<string> {
    return postMultipart('/uploads/chat', file);
  },

  async uploadProfilePhoto(file: { uri: string; name: string; type: string }): Promise<string> {
    return postMultipart('/uploads/profile', file);
  },

  async uploadVehiclePhoto(file: { uri: string; name: string; type: string }): Promise<string> {
    return postMultipart('/uploads/vehicle', file);
  },
};
