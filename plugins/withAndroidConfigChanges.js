const { AndroidConfig, withAndroidManifest, withMainActivity } = require('expo/config-plugins');

// Let React Native update text metrics without recreating the navigation host.
module.exports = function withAndroidConfigChanges(config) {
  config = withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const changes = new Set((activity.$['android:configChanges'] ?? '').split('|').filter(Boolean));
    changes.add('fontScale');
    activity.$['android:configChanges'] = [...changes].join('|');
    return config;
  });
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') throw new Error('Expected a Kotlin MainActivity');
    const marker = '// Easel live font scale';
    const contents = config.modResults.contents.replace(/  \/\/ Easel live font scale[\s\S]*?\n  }\n/, '');
    config.modResults.contents = contents.replace(
        'class MainActivity : ReactActivity() {',
        `class MainActivity : ReactActivity() {
  ${marker}
  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    // RN refreshes Dimensions on resume, but a foreground font change has no resume.
    (reactHost?.currentReactContext?.getNativeModule("DeviceInfo")
      as? com.facebook.react.bridge.LifecycleEventListener)?.onHostResume()
  }
`,
      );
    if (!config.modResults.contents.includes(marker)) throw new Error('MainActivity declaration not found');
    return config;
  });
};
