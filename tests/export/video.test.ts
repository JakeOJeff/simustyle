import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_EXPORT_CONFIG,
  exportCanvasVideo,
  validateVideoExportConfig
} from "../../src/export/video";

describe("video export configuration", () => {
  it("accepts the default duration, frame rate, and resolution", () => {
    expect(validateVideoExportConfig(DEFAULT_VIDEO_EXPORT_CONFIG)).toEqual([]);
  });

  it("reports invalid duration, fps, and dimensions", () => {
    expect(validateVideoExportConfig({
      duration: 0,
      fps: 61,
      resolution: { width: 63, height: 4000 }
    })).toHaveLength(4);
  });

  it("rejects clearly when MediaRecorder is unavailable", async () => {
    await expect(exportCanvasVideo({} as HTMLCanvasElement, DEFAULT_VIDEO_EXPORT_CONFIG))
      .rejects.toThrow("does not support MediaRecorder");
  });
});
