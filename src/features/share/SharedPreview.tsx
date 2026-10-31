import { Link2, TextQuote } from 'lucide-react-native';
import { View } from 'react-native';

import { Card, IconTile, ListGroup, ListItem, Text } from '@/design';
import { FileThumbnail } from '@/features/files/FileThumbnail';
import { describeFile, formatSize } from '@/features/files/kinds';
import { useTranslation } from '@/i18n';

import type { SharedContent, SharedFile } from './content';

function fileDetail(file: SharedFile, locale: string) {
  const type = describeFile({ name: file.name, contentType: file.mimeType ?? undefined }, locale).label;
  return [type, formatSize(file.size, locale)].filter(Boolean).join(' · ');
}

/** Shared files, with the picture itself for images. */
export function SharedFiles({ files }: { files: SharedFile[] }) {
  const { t, locale } = useTranslation();
  return (
    <ListGroup>
      {files.map((file, index) => {
        const detail = fileDetail(file, locale);
        return (
          <ListItem
            key={`${file.uri}-${index}`}
            title={file.name}
            subtitle={detail}
            subtitleLines={1}
            accessibilityLabel={t('sharePreview.fileLabel', { name: file.name, detail })}
            leading={
              <FileThumbnail
                size="lg"
                file={{
                  name: file.name,
                  filename: file.name,
                  contentType: file.mimeType ?? '',
                  thumbnailUrl: file.isImage ? file.uri : null,
                }}
              />
            }
          />
        );
      })}
    </ListGroup>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function SharedLink({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <Card
      className="flex-row items-center gap-3"
      accessible
      accessibilityLabel={t('sharePreview.linkLabel', { host: hostOf(url), url })}
    >
      <IconTile icon={Link2} size="lg" />
      <View className="flex-1 gap-0.5">
        <Text variant="headline" numberOfLines={1}>
          {hostOf(url)}
        </Text>
        <Text variant="footnote" tone="muted" numberOfLines={3} selectable>
          {url}
        </Text>
      </View>
    </Card>
  );
}

export function SharedText({ text }: { text: string }) {
  return (
    <Card className="flex-row gap-3">
      <IconTile icon={TextQuote} size="lg" tone="neutral" />
      <Text variant="body" numberOfLines={10} className="flex-1" selectable>
        {text}
      </Text>
    </Card>
  );
}

/** Everything that was shared, in the order a student would look for it. */
export function SharedPreview({ content }: { content: SharedContent }) {
  return (
    <View className="gap-3">
      {content.files.length ? <SharedFiles files={content.files} /> : null}
      {content.url && !content.files.length ? <SharedLink url={content.url} /> : null}
      {content.text && !content.files.length ? <SharedText text={content.text} /> : null}
    </View>
  );
}
