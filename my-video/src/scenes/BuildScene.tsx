import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type InteractivitySchema,
} from "remotion";
import minigolf from "../../capture/minigolf.json";
import { dmMono, dmSans, editor } from "../brand";

type BuildProps = {
  readonly query: string;
  readonly result: string;
};

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.64, 0, 0.78, 0);
const POP = Easing.bezier(0.34, 1.56, 0.64, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const GREEN = "#4ade80";

type Entity = (typeof minigolf.entities)[number];

/** A few words for what an entity is made of, read off its components. */
function tags(e: Entity): string[] {
  const c = e.components as Record<string, Record<string, unknown> | undefined>;
  const out: string[] = [];
  if (c.Mesh?.shape) out.push(String(c.Mesh.shape));
  if (c.Light?.type) out.push(`${String(c.Light.type)} light`);
  if (c.RigidBody) out.push("physics");
  if (c.Collider?.trigger) out.push("trigger");
  if (c.Script) out.push("script");
  if (!out.length) out.push("group");
  return out;
}

// What the agent really does (src/ai/agent.ts): it answers with a list of operations, create,
// update, delete and settings, that the editor validates and applies to the workspace, and can
// undo. These are the mini-golf scene's own entities (capture/minigolf.json) as the create calls
// that built it, shown as calls rather than raw JSON.
const CALLS = minigolf.entities.map((e) => ({
  name: e.name,
  child: e.parent !== null,
  tags: tags(e),
}));
const PER_COLUMN = Math.ceil(CALLS.length / 2);

// Timing, in frames.
const PANEL_IN = 4;
const FIRST_CALL = 20;
const CALL_EVERY = 4;
const APPLY_DELAY = 6;
const callAt = (i: number) => FIRST_CALL + i * CALL_EVERY;
const DONE = callAt(CALLS.length - 1) + APPLY_DELAY + 6;

const ROW_H = 56;

// lucide Check
const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// The agent at work, shown as what it actually does: the request goes in, function calls come
// out one by one, and each ticks as the editor applies it to the scene.
const BuildInner: React.FC<BuildProps> = ({ query, result }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const applied = CALLS.filter((_, i) => frame >= callAt(i) + APPLY_DELAY).length;
  const done = frame >= DONE;
  const exit = durationInFrames - 10;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: editor.page,
        fontFamily: dmSans,
        opacity: interpolate(frame, [exit, durationInFrames], [1, 0], { ...clamp, easing: EASE_IN }),
        filter: `blur(${interpolate(frame, [exit, durationInFrames], [0, 10], { ...clamp, easing: EASE_IN })}px)`,
      }}
    >
      {/* The request, as the composer sent it. */}
      <Interactive.Div
        name="Prompt"
        style={{
          position: "absolute",
          left: "50%",
          top: 110,
          padding: "16px 24px",
          borderRadius: 12,
          backgroundColor: editor.field,
          boxShadow: `0 0 0 1px ${editor.fieldBorder}`,
          color: editor.text,
          fontSize: 28,
          fontWeight: 500,
          whiteSpace: "nowrap",
          opacity: interpolate(frame, [0, 10], [0, 1], clamp),
          translate: interpolate(frame, [0, 14], ["-50% 20px", "-50% 0px"], { ...clamp, easing: EASE_OUT }),
        }}
      >
        {query}
      </Interactive.Div>

      <Interactive.Div
        name="Calls"
        style={{
          position: "absolute",
          left: 300,
          top: 214,
          width: 1320,
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: editor.window,
          boxShadow: "0 0 0 1px #ffffff1a, 0 40px 120px #000000aa",
          opacity: interpolate(frame, [PANEL_IN, PANEL_IN + 10], [0, 1], clamp),
          translate: interpolate(frame, [PANEL_IN, PANEL_IN + 18], ["0px 50px", "0px 0px"], {
            ...clamp,
            easing: EASE_OUT,
          }),
        }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            borderBottom: `1px solid ${editor.line}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 24,
              fontWeight: 600,
              color: editor.text,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: done ? GREEN : editor.progress,
                opacity: done ? 1 : 0.55 + 0.45 * Math.sin(frame / 3),
              }}
            />
            Agent
          </div>
          <div style={{ fontFamily: dmMono, fontSize: 20, color: done ? GREEN : editor.progress }}>
            {done ? `${CALLS.length} changes applied` : `applying ${applied}/${CALLS.length}`}
          </div>
        </div>

        <div style={{ display: "flex", padding: "14px 14px 18px" }}>
          {[0, 1].map((col) => (
            <div key={col} style={{ flex: 1, padding: "0 14px" }}>
              {CALLS.slice(col * PER_COLUMN, (col + 1) * PER_COLUMN).map((call, j) => {
                const i = col * PER_COLUMN + j;
                const at = callAt(i);
                const appliedAt = at + APPLY_DELAY;
                return (
                  <div
                    key={call.name}
                    style={{
                      height: ROW_H,
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "0 14px",
                      borderRadius: 10,
                      opacity: interpolate(frame, [at, at + 6], [0, 1], clamp),
                      translate: interpolate(frame, [at, at + 10], ["0px 14px", "0px 0px"], {
                        ...clamp,
                        easing: EASE_OUT,
                      }),
                      // A short glow as the editor applies the call.
                      backgroundColor: `rgba(124, 108, 240, ${interpolate(frame, [appliedAt, appliedAt + 3, appliedAt + 16], [0, 0.2, 0], clamp)})`,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: dmMono,
                        fontSize: 15,
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                        color: editor.accent,
                        backgroundColor: `${editor.accentFill}26`,
                        boxShadow: `0 0 0 1px ${editor.accentFill}55`,
                        borderRadius: 6,
                        padding: "4px 9px",
                      }}
                    >
                      CREATE
                    </span>
                    <span
                      style={{
                        fontSize: 25,
                        fontWeight: 500,
                        color: editor.text,
                        paddingLeft: call.child ? 18 : 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {call.child ? <span style={{ color: editor.muted, marginRight: 8 }}>↳</span> : null}
                      {call.name}
                    </span>
                    <span style={{ flex: 1, fontSize: 19, color: editor.muted, whiteSpace: "nowrap" }}>
                      {call.tags.join(" · ")}
                    </span>
                    <span
                      style={{
                        display: "flex",
                        opacity: interpolate(frame, [appliedAt, appliedAt + 4], [0, 1], clamp),
                        scale: `${interpolate(frame, [appliedAt, appliedAt + 7], [0.4, 1], { ...clamp, easing: POP })}`,
                      }}
                    >
                      <Check size={22} color={GREEN} />
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Interactive.Div>

      {/* The editor's own result line, with its undo. */}
      <Interactive.Div
        name="Result"
        style={{
          position: "absolute",
          left: "50%",
          top: 820,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 24px",
          borderRadius: 999,
          backgroundColor: editor.field,
          boxShadow: `0 0 0 1px ${editor.fieldBorder}`,
          color: editor.text,
          fontSize: 28,
          fontWeight: 500,
          whiteSpace: "nowrap",
          opacity: interpolate(frame, [DONE, DONE + 8], [0, 1], clamp),
          translate: interpolate(frame, [DONE, DONE + 16], ["-50% 24px", "-50% 0px"], { ...clamp, easing: EASE_OUT }),
        }}
      >
        <Check size={24} color={GREEN} />
        <span>
          {result.split(" · ")[0]}
          {result.includes(" · ") ? (
            <span style={{ color: editor.accent }}> · {result.split(" · ").slice(1).join(" · ")}</span>
          ) : null}
        </span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const buildSchema = {
  query: {
    type: "string",
    default: "Build a small mini-golf hole I can play, with a windmill that spins forever",
    description: "The request, as sent from the composer",
  },
  result: {
    type: "string",
    default: "Built a playable mini-golf hole · Undo this change",
    description: "Result line; the part after · is the undo action",
  },
} as const satisfies InteractivitySchema;

export const BuildScene = Interactive.withSchema({
  Component: BuildInner,
  componentName: "BuildScene",
  schema: buildSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
