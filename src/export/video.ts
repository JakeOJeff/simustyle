export interface VideoResolution {
  width: number;
  height: number;
}

export interface VideoExportConfig {
  duration: number;
  fps: number;
  resolution: VideoResolution;
}

export interface VideoExportProgress {
  elapsed: number;
  duration: number;
  fraction: number;
}

export interface VideoExportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: VideoExportProgress) => void;
}

export const DEFAULT_VIDEO_EXPORT_CONFIG: VideoExportConfig = {
  duration: 10,
  fps: 30,
  resolution: { width: 1920, height: 1080 }
};

const MIME_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function validateVideoExportConfig(config: VideoExportConfig): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(config.duration) || config.duration <= 0 || config.duration > 600) {
    errors.push("Duration must be greater than 0 and no more than 600 seconds.");
  }
  if (!Number.isInteger(config.fps) || config.fps < 1 || config.fps > 60) {
    errors.push("Frame rate must be a whole number from 1 to 60 fps.");
  }
  for (const [dimension, value] of Object.entries(config.resolution)) {
    if (!Number.isInteger(value) || value < 64 || value > 3840) {
      errors.push(`Resolution ${dimension} must be a whole number from 64 to 3840 pixels.`);
    }
  }
  return errors;
}

function abortError(): DOMException {
  return new DOMException("Video export was cancelled.", "AbortError");
}

/** Records the live contents of a canvas into a WebM Blob. */
export function exportCanvasVideo(
  source: HTMLCanvasElement,
  config: VideoExportConfig,
  options: VideoExportOptions = {}
): Promise<Blob> {
  const errors = validateVideoExportConfig(config);
  if (errors.length) return Promise.reject(new Error(errors.join(" ")));
  if (options.signal?.aborted) return Promise.reject(abortError());
  if (typeof MediaRecorder === "undefined") {
    return Promise.reject(new Error("WebM video export is unavailable because this browser does not support MediaRecorder."));
  }
  if (typeof source.captureStream !== "function") {
    return Promise.reject(new Error("WebM video export is unavailable because this browser cannot capture a canvas stream."));
  }

  const target = document.createElement("canvas");
  target.width = config.resolution.width;
  target.height = config.resolution.height;
  const context = target.getContext("2d");
  if (!context) return Promise.reject(new Error("Could not create a 2D canvas context for video export."));

  return new Promise<Blob>((resolve, reject) => {
    let recorder: MediaRecorder;
    let stream: MediaStream | undefined;
    let animationFrame = 0;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    let durationTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const chunks: BlobPart[] = [];
    const startedAt = performance.now();

    const cleanup = () => {
      cancelAnimationFrame(animationFrame);
      if (progressTimer !== undefined) clearInterval(progressTimer);
      if (durationTimer !== undefined) clearTimeout(durationTimer);
      options.signal?.removeEventListener("abort", cancel);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const settle = (error?: Error, blob?: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(blob ?? new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
    const reportProgress = (elapsed: number) => {
      try {
        options.onProgress?.({ elapsed, duration: config.duration, fraction: elapsed / config.duration });
      } catch {
        // Progress observers must not interrupt an active recording.
      }
    };
    const cancel = () => {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      settle(abortError());
    };

    try {
      const supportedType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      stream = target.captureStream(config.fps);
      recorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => settle(new Error("The browser encountered an error while encoding the WebM video."));
      recorder.onstop = () => {
        if (!settled) reportProgress(config.duration);
        settle(undefined, new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      };

      const draw = () => {
        if (settled) return;
        try {
          context.drawImage(source, 0, 0, target.width, target.height);
        } catch {
          settle(new Error("Could not copy the live scene canvas into the video export."));
          if (recorder.state !== "inactive") recorder.stop();
          return;
        }
        animationFrame = requestAnimationFrame(draw);
      };
      draw();
      recorder.start(1000);
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) {
        cancel();
        return;
      }
      reportProgress(0);
      progressTimer = setInterval(() => {
        const elapsed = Math.min((performance.now() - startedAt) / 1000, config.duration);
        reportProgress(elapsed);
      }, 100);
      durationTimer = setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, config.duration * 1000);
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      settle(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
