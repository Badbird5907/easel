import * as ImagePicker from 'expo-image-picker';

import type { LocalFile } from '@/canvas/uploads';
import {
  PickerPermissionError,
  PickerUnavailableError,
  timestampName,
} from '@/features/files/upload';

/** Canvas shows profile pictures small and square; a cropped JPEG keeps uploads quick. */
const options: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

function toFile(asset: ImagePicker.ImagePickerAsset): LocalFile {
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  return {
    uri: asset.uri,
    name: timestampName('Profile picture', extension),
    size: asset.fileSize ?? null,
    mimeType,
  };
}

/** A square photo for a new profile picture (SET-6), from the camera or the photo library. */
export async function pickAvatar(
  source: 'camera' | 'library',
  isCurrent: () => boolean = () => true,
): Promise<LocalFile | null> {
  if (!isCurrent()) return null;
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!isCurrent()) return null;
    if (!permission.granted)
      throw new PickerPermissionError(
        'Easel can’t use the camera. Turn on camera access for Easel in Settings.',
        { origin: 'camera-permission' },
      );
    try {
      result = await ImagePicker.launchCameraAsync(options);
    } catch (error) {
      if (!isCurrent()) return null;
      if (/simulator|not available|unavailable/i.test(String((error as Error).message)))
        throw new PickerUnavailableError(
          'This device doesn’t have a camera. Choose a photo instead.',
          { origin: 'camera-unavailable' },
        );
      throw error;
    }
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (!isCurrent()) return null;
  if (result.canceled || !result.assets[0]) return null;
  return toFile(result.assets[0]);
}
