import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Construction } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, EmptyState, Screen } from '@/design';

/**
 * Canvas links route into Easel screens as they're built (src/features/content/links.ts).
 * Until a screen exists, this offers the original page instead of a dead end.
 */
export default function NotFoundScreen() {
  const { canvasUrl } = useLocalSearchParams<{ canvasUrl?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Not in Easel yet', headerShown: true }} />
      <Screen>
        <EmptyState
          icon={Construction}
          title="This isn’t in Easel yet"
          description={
            canvasUrl ? 'You can open it in Canvas on the web instead.' : 'This screen doesn’t exist.'
          }
        />
        <View className="gap-3">
          {canvasUrl ? (
            <Button onPress={() => WebBrowser.openBrowserAsync(canvasUrl)}>Open in browser</Button>
          ) : null}
          <Button
            variant="secondary"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          >
            Go back
          </Button>
        </View>
      </Screen>
    </>
  );
}
