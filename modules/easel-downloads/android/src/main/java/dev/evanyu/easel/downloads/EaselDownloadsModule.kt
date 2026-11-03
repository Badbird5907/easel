package dev.evanyu.easel.downloads

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.annotation.RequiresApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

// FragmentActivity only accepts request codes in the lower 16 bits.
private const val SAVE_AS_REQUEST = 0x5EA5
private const val GENERIC_TYPE = "application/octet-stream"

private class SaveFailedException(cause: Throwable?) :
  CodedException("ERR_SAVE", "Couldn't save the file.", cause)

private class SaveDialogException(message: String, cause: Throwable? = null) :
  CodedException("ERR_SAVE_DIALOG", message, cause)

/**
 * Saving a downloaded file where the student can find it (FILE-5).
 * - save: straight into the public Downloads folder through MediaStore (Android 10+),
 *   which needs no permission and names duplicates itself ("Syllabus (1).pdf").
 * - saveAs: the system Save dialog (ACTION_CREATE_DOCUMENT), then a copy into the
 *   document it created. Unlike the folder picker, it can save into Downloads itself.
 * Both read only files inside Easel's own storage and check that every byte arrived.
 */
class EaselDownloadsModule : Module() {
  private class PendingSave(val source: File, val promise: Promise)

  private var pending: PendingSave? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("EaselDownloads")

    Function("canSave") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    AsyncFunction("save") Coroutine { source: String, name: String, mimeType: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw SaveFailedException(null)
      val file = localFile(source)
      val uri = withContext(Dispatchers.IO) {
        try {
          saveToDownloads(file, name, mimeType)
        } catch (e: Throwable) {
          throw SaveFailedException(e)
        }
      }
      mapOf("uri" to uri.toString())
    }

    AsyncFunction("saveAs") { source: String, name: String, mimeType: String, promise: Promise ->
      if (pending != null) throw SaveDialogException("The Save dialog is already open.")
      val file = localFile(source)
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(typeFor(name, mimeType))
        .putExtra(Intent.EXTRA_TITLE, name)
      try {
        appContext.throwingActivity.startActivityForResult(intent, SAVE_AS_REQUEST)
      } catch (e: Throwable) {
        throw SaveDialogException("Couldn't open the Save dialog.", e)
      }
      pending = PendingSave(file, promise)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != SAVE_AS_REQUEST) return@OnActivityResult
      val save = pending ?: return@OnActivityResult
      pending = null
      val target = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || target == null) {
        save.promise.resolve(null)
        return@OnActivityResult
      }
      appContext.backgroundCoroutineScope.launch {
        try {
          copy(save.source, target)
          save.promise.resolve(mapOf("uri" to target.toString()))
        } catch (e: Throwable) {
          // Don't leave an empty document behind.
          runCatching { DocumentsContract.deleteDocument(context.contentResolver, target) }
          save.promise.reject(SaveFailedException(e))
        }
      }
    }
  }

  /** A file:// URI inside Easel's own storage (expo-file-system's cache or documents). */
  private fun localFile(source: String): File {
    val uri = Uri.parse(source)
    val path = uri.path
    if (uri.scheme != "file" || path == null) throw SaveFailedException(null)
    val file = File(path).canonicalFile
    val root = context.filesDir.parentFile?.canonicalFile ?: throw SaveFailedException(null)
    if (!file.path.startsWith(root.path + File.separator) || !file.isFile) {
      throw SaveFailedException(null)
    }
    return file
  }

  /** Canvas sometimes reports a generic type; the extension is a better guess then. */
  private fun typeFor(name: String, mimeType: String): String {
    if (mimeType.isNotBlank() && mimeType != GENERIC_TYPE) return mimeType
    val extension = name.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: GENERIC_TYPE
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun saveToDownloads(source: File, name: String, mimeType: String): Uri {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, typeFor(name, mimeType))
      put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val item = resolver.insert(collection, values) ?: throw IOException("MediaStore refused the file.")
    try {
      copy(source, item)
      val published = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
      if (resolver.update(item, published, null, null) != 1) throw IOException("Couldn't publish the file.")
    } catch (e: Throwable) {
      resolver.delete(item, null, null)
      throw e
    }
    return item
  }

  /** Copies into a new, empty document and checks that every byte arrived. */
  private fun copy(source: File, target: Uri) {
    val expected = source.length()
    val output = context.contentResolver.openOutputStream(target, "w")
      ?: throw IOException("Couldn't open $target for writing.")
    val written = output.use { stream -> source.inputStream().use { it.copyTo(stream) } }
    if (written != expected) throw IOException("Copied $written of $expected bytes.")
  }
}
