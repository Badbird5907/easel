package dev.evanyu.easel.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/** No JS, jobs, timers, wake locks or network. Work is bounded to one notification callback. */
class CanvasNotificationListener : NotificationListenerService() {
  companion object { @Volatile var connected = false }
  private val seen = linkedMapOf<String, String>()
  private var lastAlert = 0L
  override fun onListenerConnected() { connected = true }
  override fun onListenerDisconnected() { connected = false }
  override fun onDestroy() { connected = false; super.onDestroy() }
  @Suppress("DEPRECATION")
  private fun builder(channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel)
    else Notification.Builder(this).setPriority(if (channel == "quiet") Notification.PRIORITY_LOW else Notification.PRIORITY_DEFAULT)
      .setDefaults(if (channel == "quiet") 0 else Notification.DEFAULT_SOUND)
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName != "com.instructure.candroid" && !(BuildConfig.DEBUG && sbn.packageName == "com.android.shell")) return
    val p = getSharedPreferences("canvas_bridge", Context.MODE_PRIVATE)
    val config = try { JSONObject(p.getString("config", "{}")!!) } catch (_: Exception) { return }
    if (!config.optBoolean("bridgeEnabled")) return
    val n = sbn.notification
    if (n.flags and (Notification.FLAG_GROUP_SUMMARY or Notification.FLAG_ONGOING_EVENT) != 0) return
    val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().take(512)
    val body = (n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty().take(4096)
    val sub = n.extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty().take(512)
    if (body.isBlank()) return
    val fingerprint = "$title|$body|$sub"
    if (seen[sbn.key] == fingerprint) return
    seen[sbn.key] = fingerprint
    if (seen.size > 128) seen.remove(seen.keys.first())
    val visible = "$title $body $sub"
    val category = BridgeClassifier.category(visible)
    val accounts = config.optJSONArray("accounts") ?: JSONArray()
    var account: JSONObject? = null
    for (i in 0 until accounts.length()) {
      val candidate = accounts.getJSONObject(i)
      if (visible.lowercase(Locale.ROOT).contains(candidate.optString("host").lowercase(Locale.ROOT))) {
        if (account != null) { account = null; break }
        account = candidate
      }
    }
    if (account == null) for (i in 0 until accounts.length()) {
      val candidate = accounts.getJSONObject(i)
      if (candidate.optString("id") == config.optString("activeId")) account = candidate
    }
    val accountId = account?.optString("id") ?: return
    var course: String? = null
    var longest = 0
    var ambiguous = false
    val courses = account?.optJSONArray("courses") ?: JSONArray()
    for (i in 0 until courses.length()) {
      val c = courses.getJSONObject(i)
      val names = c.optJSONArray("names") ?: JSONArray()
      for (j in 0 until names.length()) {
        val name = names.optString(j).lowercase(Locale.ROOT)
        if (name.length >= 3 && visible.lowercase(Locale.ROOT).contains(name)) {
          if (name.length > longest) { course = c.optString("id"); longest = name.length; ambiguous = false }
          else if (name.length == longest && course != c.optString("id")) ambiguous = true
        }
      }
    }
    if (ambiguous) course = null
    synchronized(CanvasNotificationListener::class.java) {
      val changes = try { JSONArray(p.getString("changes", "[]")) } catch (_: Exception) { JSONArray() }
      val marker = JSONObject().put("accountId", accountId).put("category", category).put("courseId", course)
      val unique = (0 until changes.length()).any { changes.getJSONObject(it).toString() == marker.toString() }
      if (!unique && changes.length() < 64) changes.put(marker)
      p.edit().putString("changes", changes.toString()).apply()
    }
    val toggle = when(category) { "discussions" -> "discussions"; "calendar" -> "calendar"; "other" -> "other"; else -> category }
    if (!(config.optJSONObject("updates") ?: JSONObject()).optBoolean(toggle, true)) return
    val nm = getSystemService(NotificationManager::class.java)
    if (!nm.areNotificationsEnabled()) return
    val q = config.optJSONObject("quietHours") ?: JSONObject()
    val now = Calendar.getInstance()
    val quiet = q.optBoolean("enabled") && BridgeClassifier.quiet(now.get(Calendar.HOUR_OF_DAY)*60 + now.get(Calendar.MINUTE), q.optInt("start"), q.optInt("end"))
    val burst = System.currentTimeMillis() - lastAlert < 30_000
    val channel = if (quiet || burst) "quiet" else if (category in listOf("discussions", "calendar", "other")) "canvas_updates" else category
    if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(channel, if(channel == "quiet") "Quiet hours" else "Canvas updates", if(channel == "quiet") NotificationManager.IMPORTANCE_LOW else NotificationManager.IMPORTANCE_DEFAULT))
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channel)?.importance == NotificationManager.IMPORTANCE_NONE) return
    val path = BridgeClassifier.path(category, course)
    val uri = Uri.Builder().scheme("easel").authority("notification-bridge")
      .appendQueryParameter("accountId", accountId).appendQueryParameter("path", path).build()
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    intent.action = Intent.ACTION_VIEW; intent.data = uri
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val id = sbn.key.hashCode()
    val pending = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    val group = "canvas_bridge:$accountId"
    val builder = builder(channel).setSmallIcon(if(icon != 0) icon else applicationInfo.icon)
      .setContentTitle(title).setContentText(body).setStyle(Notification.BigTextStyle().bigText(body))
      .setContentIntent(pending).setAutoCancel(true).setGroup(group).setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
    try {
      nm.notify("canvas_bridge", id, builder.build())
      val count = nm.activeNotifications.count { it.tag == "canvas_bridge" && it.notification.group == group && it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 }
      if (count > 1) nm.notify("canvas_bridge", group.hashCode(), builder("quiet")
        .setSmallIcon(if(icon != 0) icon else applicationInfo.icon).setContentTitle("Canvas Student")
        .setContentText("$count updates").setGroup(group).setGroupSummary(true).setOnlyAlertOnce(true)
        .setContentIntent(pending).setAutoCancel(true).build())
      if (!quiet && !burst) lastAlert = System.currentTimeMillis()
      if (config.optBoolean("bridgeHideCopy", true)) cancelNotification(sbn.key)
    } catch (_: SecurityException) { /* Keep the original if posting is denied. */ }
  }
}
