import { downloadAndDecryptStream } from './stores/storage/workers'
import Api, { ErrorResponse } from './stores/api'
import { FileMetadata } from './stores/storage/metadata'
import { uploadFile } from './stores/storage/workers/file'

import type {
  DownloadCompletedResponseMessage,
  DownloadFileMessage,
  DownloadProgressResponseMessage,
  ListAppFile,
  UploadAppFile,
  UploadChunkResponseMessage,
  UploadFileMessage,
  WorkerErrorType
} from './types'

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000))

self.canceled = {
  upload: [],
  download: []
}

onmessage = async (message: MessageEvent<any>) => {
  // Creating api maker with the updated credentials received
  // from the main browser thread that has access to JWT and CSRF
  if (message.data?.type === 'auth') {
    console.log('In worker, received authentication data...')
    self.SWApi = new Api(message.data)
  }

  if (message.data?.type === 'cancel') {
    const type = message.data.kind

    if (type === 'upload') {
      self.canceled.upload.push(message.data.id)
    } else if (type === 'download') {
      self.canceled.download.push(message.data.id)
    }
  }

  if (message.data?.type === 'upload-file') {
    while (!self.SWApi) {
      console.warn('Waiting for SWApi to be initialized...')
      await sleep(1)
    }

    handleUploadFile(message.data.message)
  }

  if (message.data?.type === 'download-file') {
    while (!self.SWApi) {
      await sleep(1)
    }

    handleDownloadFile(message.data.message)
  }
}

/**
 * Handle taking the file in, chunking it and sending it to the backend
 */
async function handleUploadFile({ transferableFile, metadataJson }: UploadFileMessage) {
  const file = transferableFile as UploadAppFile
  file.metadata = FileMetadata.fromJson(metadataJson)

  const progress = (
    file: UploadAppFile,
    attempt: number,
    isDone: boolean,
    error?: Error | ErrorResponse<any> | string | undefined
  ) => {
    const transferableFile = { ...file, metadata: undefined }

    postMessage({
      type: 'upload-progress',
      response: {
        transferableFile,
        metadataJson,
        attempt: attempt || 0,
        isDone,
        error: handleError(error)
      } as UploadChunkResponseMessage
    })
  }

  try {
    await uploadFile(self.SWApi, file, progress)
  } catch (error) {
    console.log('In worker error', error)
    progress(file, 0, false, error as ErrorResponse<unknown>)
  }
}

/**
 * Handle received download file message and downloading the file
 *
 * Once the download is generated it transfers the stream back
 * with the postMessage. This happens right away and
 */
async function handleDownloadFile({ transferableFile, metadataJson }: DownloadFileMessage) {
  transferableFile.metadata = FileMetadata.fromJson(metadataJson)

  try {
    const response = await downloadAndDecryptStream(
      self.SWApi,
      transferableFile,
      async (file: ListAppFile, chunkBytes: number): Promise<void> => {
        const transferableFile = { ...file, metadata: undefined }

        postMessage({
          type: 'download-progress',
          response: {
            transferableFile,
            metadataJson,
            chunkBytes
          } as DownloadProgressResponseMessage
        })
      }
    )

    postMessage({
      type: 'download-completed',
      response: {
        transferableFile,
        metadataJson,
        blob: await response.blob()
      } as DownloadCompletedResponseMessage
    })
  } catch (err) {
    const error = err as ErrorResponse<unknown>

    postMessage({
      type: 'download-progress',
      response: {
        transferableFile,
        chunkBytes: 0,
        error: handleError(error)
      } as DownloadProgressResponseMessage
    })
  }
}

/**
 * Convert error into something receivable by the main thread
 */
function handleError(error?: undefined | Error | ErrorResponse<any> | string): WorkerErrorType {
  if (!error) return

  if (typeof error === 'string') {
    return { context: error }
  }

  if (error instanceof Error) {
    return {
      context:
        (error as ErrorResponse<unknown>).validation ||
        (error as ErrorResponse<unknown>).description ||
        error.message,
      stack: error.stack
    }
  }
}