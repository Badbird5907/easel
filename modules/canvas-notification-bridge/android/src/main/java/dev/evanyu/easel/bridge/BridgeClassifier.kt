package dev.evanyu.easel.bridge

import java.util.Locale

/** Visible text only. Canvas keeps its destination URL inside an opaque PendingIntent. */
object BridgeClassifier {
  fun category(text: String): String {
    val value = text.lowercase(Locale.ROOT)
    return when {
      Regex("announcement|annonce|إعلان").containsMatchIn(value) -> "announcements"
      Regex("submission comment|comment.*submission|feedback|commentaire|تعليق").containsMatchIn(value) -> "comments"
      Regex("grade|graded|score|note publiée|درجة").containsMatchIn(value) -> "grades"
      Regex("conversation|inbox|message|رسالة").containsMatchIn(value) -> "messages"
      Regex("discussion|mention|مناقشة").containsMatchIn(value) -> "discussions"
      Regex("calendar|event|calendrier|تقويم").containsMatchIn(value) -> "calendar"
      Regex("assignment|due date|due |échéance|devoir|واجب").containsMatchIn(value) -> "assignments"
      else -> "other"
    }
  }
  fun path(category: String, course: String?): String = when {
    category == "messages" -> "/inbox"
    category == "calendar" -> "/calendar"
    course != null && category in listOf("announcements", "grades", "discussions", "assignments") -> "/course/$course/$category"
    else -> "/activity"
  }
  fun quiet(minutes: Int, start: Int, end: Int): Boolean =
    start != end && if (start < end) minutes >= start && minutes < end else minutes >= start || minutes < end
}
