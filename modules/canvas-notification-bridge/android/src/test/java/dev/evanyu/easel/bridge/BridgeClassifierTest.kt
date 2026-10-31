package dev.evanyu.easel.bridge
import org.junit.Assert.*
import org.junit.Test

class BridgeClassifierTest {
  @Test fun classificationsAndDestinations() {
    val examples = mapOf(
      "Canvas Notification New announcement: BIO 201 Lab moved to Friday" to "announcements",
      "Your BIO 201 assignment has been graded: 8/10" to "grades",
      "A submission comment was added in BIO 201" to "comments",
      "You have a new conversation message" to "messages",
      "You were mentioned in a discussion" to "discussions",
      "The due date for BIO 201 assignment changed" to "assignments",
      "New calendar event in BIO 201" to "calendar",
      "Something changed" to "other"
    )
    examples.forEach { (text, expected) -> assertEquals(expected, BridgeClassifier.category(text)) }
    assertEquals("/course/42/grades", BridgeClassifier.path("grades", "42"))
    assertEquals("/inbox", BridgeClassifier.path("messages", "42"))
    assertEquals("/activity", BridgeClassifier.path("comments", "42"))
    assertEquals("/activity", BridgeClassifier.path("announcements", null))
  }
  @Test fun overnightQuietHours() {
    assertTrue(BridgeClassifier.quiet(1380, 1320, 420))
    assertTrue(BridgeClassifier.quiet(60, 1320, 420))
    assertFalse(BridgeClassifier.quiet(720, 1320, 420))
    assertFalse(BridgeClassifier.quiet(420, 1320, 420))
    assertFalse(BridgeClassifier.quiet(60, 60, 60))
  }
}
