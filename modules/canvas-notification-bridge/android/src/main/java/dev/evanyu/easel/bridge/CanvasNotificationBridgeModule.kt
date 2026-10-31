package dev.evanyu.easel.bridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.app.NotificationManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CanvasNotificationBridgeModule : Module() {
  private fun context() = requireNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("CanvasNotificationBridge")
    Function("sync") { json: String ->
      context().getSharedPreferences("canvas_bridge", Context.MODE_PRIVATE).edit().putString("config", json).commit()
    }
    Function("status") {
      val c = context()
      val component = ComponentName(c, CanvasNotificationListener::class.java)
      val granted = Settings.Secure.getString(c.contentResolver, "enabled_notification_listeners")
        ?.split(":")?.any { ComponentName.unflattenFromString(it) == component } == true
      val installed = try { c.packageManager.getPackageInfo("com.instructure.candroid", 0); true } catch (_: Exception) { false }
      mapOf("installed" to installed, "granted" to granted, "connected" to CanvasNotificationListener.connected,
        "canPost" to c.getSystemService(NotificationManager::class.java).areNotificationsEnabled())
    }
    Function("drainChanges") {
      val p = context().getSharedPreferences("canvas_bridge", Context.MODE_PRIVATE)
      synchronized(CanvasNotificationListener::class.java) {
        val value = p.getString("changes", "[]") ?: "[]"
        p.edit().remove("changes").commit()
        value
      }
    }
    Function("openSettings") {
      val c = context()
      val component = ComponentName(c, CanvasNotificationListener::class.java)
      val detail = Intent("android.settings.NOTIFICATION_LISTENER_DETAIL_SETTINGS")
        .putExtra("android.provider.extra.NOTIFICATION_LISTENER_COMPONENT_NAME", component.flattenToString())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      try { c.startActivity(detail) } catch (_: Exception) {
        c.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
      }
    }
  }
}
