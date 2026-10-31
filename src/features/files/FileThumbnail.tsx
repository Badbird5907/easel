import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import type { FileItem } from '@/canvas/api/files';
import { IconTile, type IconTileProps } from '@/design';

import { describeFile, type FileKind } from './kinds';

/** Familiar colors by type: PDFs red, documents blue, spreadsheets green, slides orange. */
export const kindTone: Record<FileKind, IconTileProps['tone']> = {
  pdf: 'danger',
  document: 'info',
  spreadsheet: 'success',
  csv: 'success',
  presentation: 'warning',
  image: 'accent',
  video: 'accent',
  audio: 'accent',
  html: 'info',
  markdown: 'neutral',
  text: 'neutral',
  code: 'neutral',
  archive: 'neutral',
  other: 'neutral',
};

const boxSize = { sm: 28, md: 36, lg: 44 } as const;

/** A file's leading visual: the image itself for pictures with thumbnails, otherwise a type icon. */
export function FileThumbnail({
  file,
  size = 'md',
}: {
  file: Pick<FileItem, 'name' | 'filename' | 'contentType' | 'thumbnailUrl'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const description = describeFile(file);
  if (file.thumbnailUrl && description.kind === 'image' && !failed) {
    const box = boxSize[size];
    return (
      <View
        className="overflow-hidden rounded-lg bg-surface-sunken"
        style={{ width: box, height: box, borderCurve: 'continuous' }}
      >
        <Image
          source={{ uri: file.thumbnailUrl }}
          style={{ width: box, height: box }}
          contentFit="cover"
          recyclingKey={file.thumbnailUrl}
          onError={() => setFailed(true)}
          accessible={false}
        />
      </View>
    );
  }
  return <IconTile icon={description.icon} size={size} tone={kindTone[description.kind]} />;
}
