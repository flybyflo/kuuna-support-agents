import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';

import piTerminalImage from '../images/pi-terminal.png';
import piTerminalOwnExtensionImage from '../images/pi-terminal-own-extension.png';
import piTerminalOwnExtensionContextRedImage from '../images/pi-terminal-own-extension-context red.png';

const DEMO_VIDEO = staticFile('kuuna-demo.mp4');
const WHATSAPP_WORKED_IMG = staticFile('whatsapp-worked.png');
const WHATSAPP_TOOLS_IMG = staticFile('whatsapp-tools-works.png');

export type IntroVideoProps = {
  projectName: string;
  city: string;
  teamName: string;
};

// --- Design tokens -----------------------------------------------------------

const palette = {
  bg0: '#04050f',
  bg1: '#0a0f25',
  bg2: '#131a3a',
  text: '#f6f7fb',
  subtext: '#aab4d8',
  muted: '#6c78a8',
  accent: '#7dd3fc',    // cyan
  accent2: '#c4b5fd',   // violet
  accent3: '#f0abfc',   // magenta
  green: '#86efac',
  amber: '#fcd34d',
  red: '#fb7185',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
};

const font = {
  display:
    '"Inter", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono:
    '"JetBrains Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
};

// --- Easing helpers ----------------------------------------------------------

const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

const sceneOpacity = (frame: number, duration: number, fade = 6) => {
  const a = interpolate(frame, [0, fade], [0, 1], {
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
  const b = interpolate(frame, [duration - fade, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    easing: easeInOut,
  });
  return Math.min(a, b);
};

const sceneEnter = (frame: number, duration: number) => {
  // Pair of 0..1 easings for entry + 1..0 for exit
  const enter = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
  const exit = interpolate(frame, [duration - 14, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    easing: easeInOut,
  });
  return {enter, exit};
};

// Stagger helper: returns an opacity/translation pair per index
const staggered = (frame: number, index: number, step = 6, dur = 20) => {
  const local = frame - index * step;
  const o = interpolate(local, [0, dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
  const y = interpolate(local, [0, dur], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
  return {opacity: o, translateY: y};
};

// --- Shared styles -----------------------------------------------------------

const sceneFrame: React.CSSProperties = {
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  padding: '96px 128px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
};

const kickerStyle: React.CSSProperties = {
  fontFamily: font.mono,
  fontSize: 22,
  letterSpacing: 4,
  textTransform: 'uppercase',
  color: palette.subtext,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 14,
};

const displayLine: React.CSSProperties = {
  fontFamily: font.display,
  fontSize: 84,
  fontWeight: 700,
  letterSpacing: -2.4,
  lineHeight: 1.02,
};

const subLine: React.CSSProperties = {
  fontFamily: font.display,
  fontSize: 30,
  color: palette.subtext,
  lineHeight: 1.4,
  maxWidth: 1200,
};

// --- Small building blocks ---------------------------------------------------

const Kicker: React.FC<{label: string; color?: string}> = ({
  label,
  color = palette.accent,
}) => (
  <div style={{...kickerStyle, color}}>
    <span
      style={{
        display: 'inline-block',
        width: 28,
        height: 2,
        background: color,
        opacity: 0.9,
      }}
    />
    {label}
  </div>
);

const Chip: React.FC<{
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
  outline?: boolean;
}> = ({label, tone = 'neutral', outline = false}) => {
  const color =
    tone === 'good'
      ? palette.green
      : tone === 'warn'
        ? palette.amber
        : tone === 'bad'
          ? palette.red
          : tone === 'accent'
            ? palette.accent2
            : palette.accent;

  return (
    <div
      style={{
        border: `1px solid ${color}${outline ? 'CC' : '55'}`,
        color,
        backgroundColor: outline ? 'transparent' : `${color}1A`,
        borderRadius: 999,
        padding: '10px 20px',
        fontFamily: font.display,
        fontSize: 24,
        fontWeight: 600,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  );
};

const Arrow: React.FC<{progress?: number; color?: string}> = ({
  progress = 1,
  color = palette.muted,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: 0.3 + progress * 0.7,
    }}
  >
    <div
      style={{
        width: 60 * progress,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${color})`,
      }}
    />
    <div
      style={{
        width: 0,
        height: 0,
        borderTop: '7px solid transparent',
        borderBottom: '7px solid transparent',
        borderLeft: `10px solid ${color}`,
        marginLeft: 2,
      }}
    />
  </div>
);

const TerminalWindow: React.FC<{
  title: string;
  children: React.ReactNode;
  scale?: number;
}> = ({title, children, scale = 1}) => (
  <div
    style={{
      borderRadius: 14,
      border: `1px solid ${palette.lineStrong}`,
      backgroundColor: 'rgba(3, 6, 18, 0.88)',
      overflow: 'hidden',
      boxShadow:
        '0 40px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 1px 0 rgba(255,255,255,0.08) inset',
      transform: `scale(${scale})`,
      transformOrigin: 'top center',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 18px',
        borderBottom: `1px solid ${palette.line}`,
        backgroundColor: 'rgba(255,255,255,0.02)',
      }}
    >
      <span style={{width: 12, height: 12, borderRadius: 999, background: '#ff5f57'}} />
      <span style={{width: 12, height: 12, borderRadius: 999, background: '#febc2e'}} />
      <span style={{width: 12, height: 12, borderRadius: 999, background: '#28c840'}} />
      <div
        style={{
          flex: 1,
          textAlign: 'center',
          fontFamily: font.mono,
          fontSize: 18,
          color: palette.muted,
          letterSpacing: 1,
        }}
      >
        {title}
      </div>
      <div style={{width: 54}} />
    </div>
    <div>{children}</div>
  </div>
);

const TypewriterLine: React.FC<{
  text: string;
  frame: number;
  speed?: number;
  color?: string;
  fontSize?: number;
  showCursor?: boolean;
}> = ({
  text,
  frame,
  speed = 1.3,
  color = palette.text,
  fontSize = 36,
  showCursor = true,
}) => {
  const visibleChars = Math.max(0, Math.min(text.length, Math.floor(frame / speed)));
  const shown = text.slice(0, visibleChars);
  const cursor = frame % 20 < 10 ? 1 : 0;

  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize,
        color,
        letterSpacing: -0.4,
        lineHeight: 1.35,
      }}
    >
      {shown}
      {showCursor && visibleChars <= text.length ? (
        <span style={{opacity: cursor, color: palette.accent, marginLeft: 2}}>▍</span>
      ) : null}
    </div>
  );
};

// --- Background --------------------------------------------------------------

const STAR_SEED = [
  [0.12, 0.18, 1.2],
  [0.87, 0.14, 0.8],
  [0.22, 0.78, 1.0],
  [0.66, 0.62, 0.6],
  [0.44, 0.3, 0.9],
  [0.08, 0.52, 0.7],
  [0.94, 0.44, 1.1],
  [0.35, 0.88, 0.8],
  [0.58, 0.12, 0.6],
  [0.77, 0.82, 1.0],
  [0.5, 0.55, 0.7],
  [0.18, 0.4, 0.5],
  [0.82, 0.68, 0.9],
  [0.05, 0.9, 0.6],
  [0.97, 0.88, 0.8],
  [0.3, 0.06, 0.7],
  [0.72, 0.28, 0.5],
  [0.4, 0.72, 0.9],
  [0.63, 0.95, 0.6],
  [0.13, 0.64, 0.8],
] as const;

const GlobalBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const driftY = Math.sin(frame / 90) * 20;
  const driftX = Math.cos(frame / 110) * 28;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at ${50 + driftX / 8}% ${40 + driftY / 10}%, #1b2554 0%, ${palette.bg1} 38%, ${palette.bg0} 85%)`,
      }}
    >
      {/* Aurora orbs */}
      <div
        style={{
          position: 'absolute',
          top: -280 + driftY,
          right: -220 + driftX,
          width: 820,
          height: 820,
          borderRadius: 999,
          background:
            'radial-gradient(circle, rgba(125,211,252,0.22), rgba(125,211,252,0) 65%)',
          filter: 'blur(14px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -360 - driftY,
          left: -260 - driftX,
          width: 900,
          height: 900,
          borderRadius: 999,
          background:
            'radial-gradient(circle, rgba(196,181,253,0.22), rgba(196,181,253,0) 65%)',
          filter: 'blur(16px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '35%',
          left: '40%',
          width: 520,
          height: 520,
          borderRadius: 999,
          background:
            'radial-gradient(circle, rgba(240,171,252,0.12), rgba(240,171,252,0) 60%)',
          filter: 'blur(20px)',
        }}
      />

      {/* Stars */}
      {STAR_SEED.map(([x, y, s], i) => {
        const twinkle = 0.35 + (Math.sin(frame / 18 + i * 1.4) + 1) / 2 * 0.65;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: 3 * s,
              height: 3 * s,
              borderRadius: 999,
              background: '#ffffff',
              opacity: 0.35 * twinkle,
              boxShadow: `0 0 ${12 * s}px rgba(255,255,255,${0.4 * twinkle})`,
            }}
          />
        );
      })}

      {/* Subtle grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          maskImage:
            'radial-gradient(ellipse at center, black 40%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at center, black 40%, transparent 85%)',
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

// --- Chapter progress bar ----------------------------------------------------

const ChapterBar: React.FC<{
  chapters: {label: string; start: number; end: number}[];
}> = ({chapters}) => {
  const frame = useCurrentFrame();
  const total = chapters[chapters.length - 1].end;
  const overallProgress = Math.min(1, frame / total);
  const active = chapters.findIndex((c) => frame >= c.start && frame < c.end);

  return (
    <div
      style={{
        position: 'absolute',
        left: 128,
        right: 128,
        bottom: 56,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: font.mono,
          fontSize: 18,
          color: palette.muted,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        <div style={{color: palette.subtext}}>
          {active >= 0
            ? `${String(active + 1).padStart(2, '0')} · ${chapters[active].label}`
            : ''}
        </div>
        <div>KUUNA · JUDGE COUNCIL INTRO</div>
      </div>
      <div
        style={{
          position: 'relative',
          height: 3,
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${overallProgress * 100}%`,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.accent3})`,
            boxShadow: `0 0 18px ${palette.accent}80`,
          }}
        />
      </div>
    </div>
  );
};

// --- Scenes ------------------------------------------------------------------

const SceneColdOpen: React.FC<{duration: number; city: string}> = ({
  duration,
  city,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);
  const heroSpring = spring({fps, frame, config: {damping: 200, mass: 0.8, stiffness: 120}});

  const lines = [
    'To the honorable',
    'Council of Judges.',
  ];

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div
          style={{
            transform: `translateY(${(1 - heroSpring) * 24}px)`,
            opacity: interpolate(frame, [0, 14], [0, 1], {
              extrapolateRight: 'clamp',
              easing: easeOut,
            }),
          }}
        >
          <Kicker label={`${city} Hackathon · Boot Sequence`} color={palette.accent} />
        </div>

        <div style={{marginTop: 40, display: 'grid', gap: 6}}>
          {lines.map((line, i) => {
            const s = staggered(frame, i, 8, 24);
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  background:
                    i === 1
                      ? `linear-gradient(90deg, ${palette.accent}, ${palette.accent2})`
                      : 'transparent',
                  WebkitBackgroundClip: i === 1 ? 'text' : undefined,
                  WebkitTextFillColor: i === 1 ? 'transparent' : undefined,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 42,
            maxWidth: 900,
            ...(() => {
              const s = staggered(frame, 2, 8, 24);
              return {opacity: s.opacity, transform: `translateY(${s.translateY}px)`};
            })(),
          }}
        >
          <TerminalWindow title="~/kuuna · demo-intro">
            <div style={{padding: '28px 32px', display: 'grid', gap: 14}}>
              <TypewriterLine
                text={'$ kuuna init demo-intro --mode charming'}
                frame={frame - 20}
                color={palette.accent}
                fontSize={32}
              />
              <TypewriterLine
                text={'> listening_for_judges = true'}
                frame={frame - 70}
                color={palette.subtext}
                fontSize={30}
              />
              <TypewriterLine
                text={'> tone := frame-perfect · slightly overdramatic · nerdy'}
                frame={frame - 110}
                color={palette.muted}
                fontSize={28}
                showCursor
              />
            </div>
          </TerminalWindow>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneFlaskRing: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);
  const ringIn = spring({
    fps,
    frame,
    config: {damping: 200, mass: 0.7, stiffness: 100},
  });
  const rotate = interpolate(frame, [0, duration], [-8, 12], {easing: easeInOut});
  const pulse = 1 + Math.sin(frame / 14) * 0.03;

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{...sceneFrame, display: 'grid', gridTemplateColumns: '560px 1fr', gap: 80, alignItems: 'center'}}>
        {/* Ring + flask */}
        <div style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 440}}>
          {/* Outer glow */}
          <div
            style={{
              position: 'absolute',
              width: 440,
              height: 440,
              borderRadius: 999,
              background: `radial-gradient(circle, ${palette.amber}33, transparent 65%)`,
              filter: 'blur(20px)',
              opacity: ringIn,
            }}
          />
          {/* The ring */}
          <div
            style={{
              width: 360 * pulse,
              height: 360 * pulse,
              borderRadius: 999,
              border: `12px solid ${palette.amber}`,
              boxShadow: `0 0 80px ${palette.amber}66, 0 0 0 8px ${palette.amber}22`,
              transform: `rotate(${rotate}deg) scale(${0.9 + ringIn * 0.1})`,
              position: 'relative',
            }}
          >
            {/* Inscription hint */}
            <div
              style={{
                position: 'absolute',
                inset: 14,
                borderRadius: 999,
                border: `1px dashed ${palette.amber}88`,
                opacity: 0.5,
              }}
            />
          </div>
          {/* Flask, centered */}
          <div
            style={{
              position: 'absolute',
              transform: `translateY(${6 - ringIn * 6}px) scale(${0.9 + ringIn * 0.1})`,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: 140,
                height: 180,
                borderRadius: '34px 34px 50px 50px',
                border: `3px solid ${palette.accent}`,
                background: `linear-gradient(180deg, ${palette.accent}33, ${palette.accent}0D)`,
                overflow: 'hidden',
              }}
            >
              {/* Liquid sheen */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 95,
                  background: `linear-gradient(180deg, ${palette.accent}66, ${palette.accent2}88)`,
                  borderRadius: '0 0 46px 46px',
                }}
              />
              {/* Bubbles */}
              {[0, 1, 2].map((i) => {
                const t = (frame + i * 18) % 70;
                const bubbleY = 95 - t * 1.2;
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: 30 + i * 22,
                      bottom: bubbleY,
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: '#ffffffcc',
                      opacity: interpolate(t, [0, 10, 60, 70], [0, 1, 1, 0], {
                        extrapolateLeft: 'clamp',
                        extrapolateRight: 'clamp',
                      }),
                    }}
                  />
                );
              })}
            </div>
            {/* Neck */}
            <div
              style={{
                position: 'absolute',
                top: -36,
                left: 37,
                width: 66,
                height: 36,
                border: `3px solid ${palette.accent}`,
                borderBottom: 'none',
                borderRadius: '18px 18px 0 0',
              }}
            />
          </div>
        </div>

        {/* Copy */}
        <div>
          <Kicker label="Easter Egg · 01 / 04" color={palette.amber} />
          <div style={{marginTop: 24}}>
            {['A star in the dark.', 'A flask on the table.', 'One ring to bind all bugs.'].map((line, i) => {
              const s = staggered(frame, i + 1, 10, 22);
              const highlight = i === 2;
              return (
                <div
                  key={line}
                  style={{
                    ...displayLine,
                    fontSize: 68,
                    letterSpacing: -1.6,
                    marginTop: i === 0 ? 0 : 4,
                    opacity: s.opacity,
                    transform: `translateY(${s.translateY}px)`,
                    color: highlight ? palette.amber : palette.text,
                    fontStyle: highlight ? 'italic' : 'normal',
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>
          <div
            style={{
              ...subLine,
              marginTop: 28,
              opacity: interpolate(frame, [55, 75], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
            }}
          >
            If you caught the reference, this intro was successfully polite and nerdy.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneTerminalOracle: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);
  const kenBurns = interpolate(frame, [0, duration], [1.06, 1.16], {easing: easeInOut});
  const kbX = interpolate(frame, [0, duration], [0, -12], {easing: easeInOut});

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Easter Egg · 02 / 04" color={palette.accent} />
        </div>

        <div
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: '1fr 1.35fr',
            gap: 70,
            alignItems: 'center',
          }}
        >
          <div>
            {['Before building any feature,', 'we consulted the wise', 'Terminal Oracle.'].map((line, i) => {
              const s = staggered(frame, i, 8, 22);
              const highlight = i === 2;
              return (
                <div
                  key={line}
                  style={{
                    ...displayLine,
                    fontSize: 68,
                    letterSpacing: -1.8,
                    opacity: s.opacity,
                    transform: `translateY(${s.translateY}px)`,
                    background: highlight
                      ? `linear-gradient(90deg, ${palette.accent}, ${palette.accent3})`
                      : 'transparent',
                    WebkitBackgroundClip: highlight ? 'text' : undefined,
                    WebkitTextFillColor: highlight ? 'transparent' : undefined,
                  }}
                >
                  {line}
                </div>
              );
            })}
            <div
              style={{
                ...subLine,
                marginTop: 24,
                opacity: interpolate(frame, [40, 60], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                }),
              }}
            >
              No mockup: an actual terminal screenshot from our setup.
            </div>
          </div>

          <div
            style={{
              transform: `translateY(${(1 - sceneEnter(frame, duration).enter) * 30}px)`,
              opacity: sceneEnter(frame, duration).enter,
            }}
          >
            <TerminalWindow title="pi · terminal oracle">
              <div
                style={{
                  padding: '16px 22px',
                  fontFamily: font.mono,
                  fontSize: 22,
                  color: palette.accent,
                  borderBottom: `1px solid ${palette.line}`,
                }}
              >
                <span style={{color: palette.muted}}>$</span>{' '}
                <span>pi "how do we add sentry first?"</span>
              </div>
              <div style={{position: 'relative', overflow: 'hidden', height: 340}}>
                <Img
                  src={piTerminalImage}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center 18%',
                    display: 'block',
                    transform: `scale(${kenBurns}) translateX(${kbX}px)`,
                    transformOrigin: 'center',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(180deg, transparent 60%, rgba(3,6,18,0.75))',
                  }}
                />
              </div>
            </TerminalWindow>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneSentryFirst: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);

  const capture = interpolate(frame, [fps * 0.8, fps * 2.3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOut,
  });
  const errorShake =
    frame < fps * 0.8 ? Math.sin(frame / 2.5) * (fps * 0.8 - frame) * 0.15 : 0;

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Easter Egg · 03 / 04" color={palette.green} />
        </div>

        <div style={{marginTop: 24}}>
          {['First feature we shipped:', 'Sentry. No discussion.'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            const highlight = i === 1;
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 74,
                  letterSpacing: -2,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  color: highlight ? palette.green : palette.text,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 48,
            display: 'grid',
            gridTemplateColumns: '1fr 120px 1fr',
            alignItems: 'center',
            gap: 20,
            opacity: interpolate(frame, [20, 40], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {/* Error */}
          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${palette.red}66`,
              backgroundColor: `${palette.red}14`,
              padding: '22px 26px',
              fontFamily: font.mono,
              fontSize: 28,
              color: '#ffd0da',
              boxShadow: `0 20px 50px ${palette.red}22`,
              transform: `translateX(${errorShake}px)`,
            }}
          >
            <div style={{fontSize: 18, color: palette.red, letterSpacing: 2, marginBottom: 8}}>
              ERROR · runtime
            </div>
            glitch at <span style={{color: palette.amber}}>/agent/reply</span>
          </div>

          {/* Arrow */}
          <Arrow progress={capture} color={palette.green} />

          {/* Captured */}
          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${palette.green}66`,
              backgroundColor: `${palette.green}14`,
              padding: '22px 26px',
              fontFamily: font.mono,
              fontSize: 28,
              color: '#d5ffe5',
              boxShadow: `0 20px 50px ${palette.green}22`,
              opacity: capture,
              transform: `translateY(${(1 - capture) * 12}px)`,
            }}
          >
            <div style={{fontSize: 18, color: palette.green, letterSpacing: 2, marginBottom: 8}}>
              ISSUE CAPTURED
            </div>
            stack · breadcrumb · context
          </div>
        </div>

        <div
          style={{
            ...subLine,
            marginTop: 36,
            opacity: interpolate(frame, [55, 75], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Observability first. Panic later. That is how a demo stays stable.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneBacklogForge: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);

  const flow = interpolate(frame, [fps * 0.6, fps * 2.6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOut,
  });

  const tokenX = interpolate(frame, [fps * 0.4, fps * 2.6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOut,
  });

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Easter Egg · 04 / 04" color={palette.accent2} />
        </div>

        <div style={{marginTop: 24}}>
          {['From side-project chaos', 'to shippable tasks.'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            const highlight = i === 1;
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 74,
                  letterSpacing: -2,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  background: highlight
                    ? `linear-gradient(90deg, ${palette.accent2}, ${palette.accent3})`
                    : 'transparent',
                  WebkitBackgroundClip: highlight ? 'text' : undefined,
                  WebkitTextFillColor: highlight ? 'transparent' : undefined,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 42,
            opacity: interpolate(frame, [20, 40], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <TerminalWindow title="backlog.md">
            <div
              style={{
                padding: '20px 26px',
                fontFamily: font.mono,
                fontSize: 26,
                color: palette.accent,
              }}
            >
              <span style={{color: palette.muted}}>$</span> backlog.md --from{' '}
              <span style={{color: palette.amber}}>"chaos"</span> --to{' '}
              <span style={{color: palette.green}}>"shippable"</span>
            </div>
          </TerminalWindow>
        </div>

        {/* Flow */}
        <div
          style={{
            marginTop: 40,
            display: 'grid',
            gridTemplateColumns: '1fr 90px 1fr 90px 1fr',
            gap: 14,
            alignItems: 'center',
            position: 'relative',
          }}
        >
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <Chip label="side-project" tone="bad" />
          </div>
          <Arrow progress={Math.min(1, flow * 2)} color={palette.muted} />
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <Chip label="backlog.md" tone="neutral" />
          </div>
          <Arrow progress={Math.max(0, Math.min(1, flow * 2 - 1))} color={palette.muted} />
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <Chip label="ship it" tone="good" outline />
          </div>

          {/* Traveling token */}
          <div
            style={{
              position: 'absolute',
              left: `${6 + tokenX * 88}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              borderRadius: 999,
              background: palette.accent,
              boxShadow: `0 0 24px ${palette.accent}, 0 0 4px #fff`,
              opacity: 0.4 + Math.sin(frame / 4) * 0.4,
            }}
          />
        </div>

        <div
          style={{
            ...subLine,
            marginTop: 28,
            opacity: interpolate(frame, [55, 75], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Codex ambassador vibes. Backend + web. Stage-ready and organized.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneProblem: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, duration);
  const shake = frame < 30 ? Math.sin(frame / 3) * (30 - frame) * 0.2 : 0;

  const chips = ['Text', 'Images', 'Voice notes', 'Videos', 'PDFs'];

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{...sceneFrame, transform: `translateX(${shake}px)`}}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="The Problem" color={palette.red} />
        </div>

        <div style={{marginTop: 24}}>
          {['Our client communication lives', 'inside WhatsApp groups.'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            const highlight = i === 1;
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 74,
                  letterSpacing: -2,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  color: highlight ? palette.red : palette.text,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div style={{marginTop: 36, display: 'flex', gap: 14, flexWrap: 'wrap'}}>
          {chips.map((c, i) => {
            const s = staggered(frame, i + 3, 5, 16);
            return (
              <div
                key={c}
                style={{opacity: s.opacity, transform: `translateY(${s.translateY}px)`}}
              >
                <Chip label={c} tone="neutral" />
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 32,
            borderRadius: 16,
            border: `1px solid ${palette.lineStrong}`,
            overflow: 'hidden',
            opacity: interpolate(frame, [35, 55], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{position: 'relative', height: 150}}>
            <Img
              src={piTerminalOwnExtensionContextRedImage}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transform: `scale(${interpolate(frame, [0, duration], [1.04, 1.1])})`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, transparent, rgba(4,5,15,0.55))',
              }}
            />
          </div>
        </div>

        <div
          style={{
            ...subLine,
            marginTop: 22,
            opacity: interpolate(frame, [55, 75], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Everything arrives unstructured. Lots of context. Little overview. High operational stress.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneWhatWeBuild: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);
  const flow = interpolate(frame, [fps * 0.6, fps * 2.4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOut,
  });

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Our Solution" color={palette.green} />
        </div>

        <div style={{marginTop: 24}}>
          {['In the dashboard, we create:'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 78,
                  letterSpacing: -2.1,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: '1fr 80px 1fr 80px 1fr',
            alignItems: 'center',
            gap: 16,
          }}
        >
          {[
            {label: 'new client', tone: 'neutral' as const, icon: '◎'},
            {label: 'new WhatsApp group', tone: 'accent' as const, icon: '◇'},
            {label: 'template group', tone: 'warn' as const, icon: '✦'},
          ].map((item, i) => {
            const appear = interpolate(frame, [20 + i * 10, 40 + i * 10], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: easeOut,
            });
            const lift = (1 - appear) * 20;
            const color =
              item.tone === 'warn' ? palette.amber : item.tone === 'accent' ? palette.accent2 : palette.accent;
            return (
              <React.Fragment key={item.label}>
                {i > 0 && (
                  <Arrow progress={Math.max(0, Math.min(1, flow * 3 - (i - 1) * 1.1))} color={palette.muted} />
                )}
                <div
                  style={{
                    opacity: appear,
                    transform: `translateY(${lift}px)`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      width: 110,
                      height: 110,
                      borderRadius: 24,
                      border: `1px solid ${color}66`,
                      background: `${color}14`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color,
                      fontSize: 52,
                      boxShadow: `0 20px 40px ${color}22`,
                    }}
                  >
                    {item.icon}
                  </div>
                  <Chip label={item.label} tone={item.tone} />
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 60,
            fontFamily: font.mono,
            fontSize: 30,
            color: palette.subtext,
            borderLeft: `3px solid ${palette.accent}`,
            paddingLeft: 20,
            opacity: interpolate(frame, [60, 80], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Invariant: <span style={{color: palette.accent}}>1 WhatsApp group = 1 active agent.</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneTriggerAndOps: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, duration);

  const triggers = ['template-pinned tools', '@mention', 'reply auf Agent', 'prefix trigger'];

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Agent Behavior" color={palette.amber} />
        </div>

        <div style={{marginTop: 24}}>
          {['The group instantly gets', 'an agent with tools.'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            const highlight = i === 1;
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 72,
                  letterSpacing: -2,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  color: highlight ? palette.accent : palette.text,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 44,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 18,
          }}
        >
          {triggers.map((t, i) => {
            const s = staggered(frame, i + 3, 6, 20);
            return (
              <div
                key={t}
                style={{
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  borderRadius: 16,
                  border: `1px solid ${palette.lineStrong}`,
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                  padding: '22px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 16,
                    letterSpacing: 2,
                    color: palette.muted,
                    textTransform: 'uppercase',
                  }}
                >
                  trigger · {String(i + 1).padStart(2, '0')}
                </div>
                <div
                  style={{
                    fontFamily: font.display,
                    fontSize: 26,
                    fontWeight: 600,
                    color: palette.text,
                  }}
                >
                  {t}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 36,
            borderRadius: 14,
            border: `1px solid ${palette.line}`,
            overflow: 'hidden',
            opacity: interpolate(frame, [35, 55], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <div style={{position: 'relative', height: 100}}>
            <Img
              src={piTerminalOwnExtensionImage}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transform: `scale(${interpolate(frame, [0, duration], [1.02, 1.08])})`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, rgba(4,5,15,0.2), rgba(4,5,15,0.7))',
              }}
            />
          </div>
        </div>

        <div
          style={{
            marginTop: 22,
            fontFamily: font.mono,
            fontSize: 24,
            color: palette.subtext,
            opacity: interpolate(frame, [55, 75], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <span style={{color: palette.red}}>unbound</span> groups → never routed ·{' '}
          <span style={{color: palette.green}}>deterministic · predictable · safe</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneIngestRag: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);

  const reveal = interpolate(frame, [fps * 0.5, fps * 2.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOut,
  });

  const stages = [
    {label: 'chat + media', hint: 'ingest', color: palette.accent},
    {label: 'parse · transcribe', hint: 'normalize', color: palette.accent2},
    {label: 'knowledge base', hint: 'grows', color: palette.amber},
    {label: 'traceable reply', hint: 'respond', color: palette.green},
  ];

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Pipeline · Knowledge Base" color={palette.green} />
        </div>

        <div style={{marginTop: 24}}>
          <div
            style={{
              ...displayLine,
              fontSize: 78,
              letterSpacing: -2.2,
              ...(() => {
                const s = staggered(frame, 1, 8, 22);
                return {opacity: s.opacity, transform: `translateY(${s.translateY}px)`};
              })(),
            }}
          >
            <span style={{color: palette.accent}}>Ingest</span>{' '}
            <span style={{color: palette.muted}}>→</span>{' '}
            <span style={{color: palette.accent2}}>Transcribe</span>{' '}
            <span style={{color: palette.muted}}>→</span>{' '}
            <span style={{color: palette.amber}}>RAG</span>{' '}
            <span style={{color: palette.muted}}>→</span>{' '}
            <span style={{color: palette.green}}>Reply</span>
          </div>
        </div>

        {/* Pipeline cards */}
        <div
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 22,
            position: 'relative',
            opacity: reveal,
          }}
        >
          {stages.map((s, i) => {
            const local = frame - (30 + i * 12);
            const o = interpolate(local, [0, 16], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: easeOut,
            });
            const ty = interpolate(local, [0, 16], [20, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: easeOut,
            });
            return (
              <div
                key={s.label}
                style={{
                  opacity: o,
                  transform: `translateY(${ty}px)`,
                  borderRadius: 18,
                  border: `1px solid ${s.color}44`,
                  background: `linear-gradient(180deg, ${s.color}12, rgba(255,255,255,0.02))`,
                  padding: '26px 22px',
                  boxShadow: `0 20px 40px ${s.color}15`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 15,
                    color: s.color,
                    letterSpacing: 2.5,
                    textTransform: 'uppercase',
                  }}
                >
                  {String(i + 1).padStart(2, '0')} · {s.hint}
                </div>
                <div
                  style={{
                    fontFamily: font.display,
                    fontSize: 28,
                    fontWeight: 700,
                    color: palette.text,
                    letterSpacing: -0.5,
                  }}
                >
                  {s.label}
                </div>
              </div>
            );
          })}

          {/* Flowing particles on the strip below */}
        </div>

        {/* Flow rail */}
        <div
          style={{
            marginTop: 22,
            height: 2,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.amber}, ${palette.green})`,
            borderRadius: 2,
            position: 'relative',
            opacity: 0.6,
          }}
        >
          {[0, 1, 2].map((i) => {
            const t = (frame + i * 28) % 90;
            const x = t / 90;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${x * 100}%`,
                  top: -5,
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: '#fff',
                  boxShadow: '0 0 18px #fff, 0 0 4px #fff',
                  transform: 'translateX(-50%)',
                  opacity: interpolate(x, [0, 0.05, 0.95, 1], [0, 1, 1, 0]),
                }}
              />
            );
          })}
        </div>

        <div
          style={{
            ...subLine,
            marginTop: 30,
            opacity: interpolate(frame, [70, 90], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Group knowledge beats common knowledge. Plus audit trail, structured logs, and Sentry.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneLiveDemo: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration, 10);

  const chromeLift = spring({
    fps,
    frame,
    config: {damping: 180, mass: 0.8, stiffness: 110},
  });
  const captions = [
    'dashboard · create client + group + template',
    'configure model chain + allowed tools',
    'bind WhatsApp group → agent activates',
    'pin templates · define trigger rules',
    'send message → ingest pipeline fires',
    'transcribe · embed · retrieve · respond',
    'audit trail captured. live. end to end.',
  ];
  const subtitleInterval = duration / captions.length;
  const subtitleIdx = Math.min(
    captions.length - 1,
    Math.floor(frame / subtitleInterval),
  );
  const caption = captions[subtitleIdx];

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Live Demo · Kuuna in motion" color={palette.accent3} />
        </div>

        <div style={{marginTop: 20, display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap'}}>
          {['Not a mockup.', 'A real run.'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            const highlight = i === 1;
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 72,
                  letterSpacing: -2,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  background: highlight
                    ? `linear-gradient(90deg, ${palette.accent3}, ${palette.accent})`
                    : 'transparent',
                  WebkitBackgroundClip: highlight ? 'text' : undefined,
                  WebkitTextFillColor: highlight ? 'transparent' : undefined,
                  color: highlight ? undefined : palette.text,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 36,
            borderRadius: 18,
            border: `1px solid ${palette.lineStrong}`,
            overflow: 'hidden',
            boxShadow: '0 60px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
            transform: `translateY(${(1 - chromeLift) * 40}px)`,
            opacity: chromeLift,
          }}
        >
          {/* Browser chrome */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 18px',
              borderBottom: `1px solid ${palette.line}`,
              backgroundColor: 'rgba(255,255,255,0.03)',
            }}
          >
            <span style={{width: 12, height: 12, borderRadius: 999, background: '#ff5f57'}} />
            <span style={{width: 12, height: 12, borderRadius: 999, background: '#febc2e'}} />
            <span style={{width: 12, height: 12, borderRadius: 999, background: '#28c840'}} />
            <div
              style={{
                marginLeft: 18,
                padding: '6px 16px',
                borderRadius: 999,
                border: `1px solid ${palette.line}`,
                background: 'rgba(255,255,255,0.03)',
                fontFamily: font.mono,
                fontSize: 16,
                color: palette.subtext,
                letterSpacing: 0.4,
              }}
            >
              kuuna.local / dashboard
            </div>
            <div style={{flex: 1}} />
            <div style={{
              fontFamily: font.mono,
              fontSize: 14,
              color: palette.accent3,
              letterSpacing: 2,
            }}>
              ● REC
            </div>
          </div>

          {/* Video stage */}
          <div style={{position: 'relative', width: '100%', aspectRatio: '2878 / 1730', background: '#000'}}>
            <OffthreadVideo
              src={DEMO_VIDEO}
              playbackRate={4.5}
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            {/* Subtle scanline / glass sheen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 18%, transparent 80%, rgba(4,5,15,0.35) 100%)',
                pointerEvents: 'none',
              }}
            />
            {/* Caption strip */}
            <div
              style={{
                position: 'absolute',
                left: 24,
                bottom: 20,
                padding: '10px 18px',
                borderRadius: 12,
                backgroundColor: 'rgba(3, 6, 18, 0.78)',
                border: `1px solid ${palette.line}`,
                fontFamily: font.mono,
                fontSize: 22,
                color: palette.text,
                letterSpacing: 0.2,
                backdropFilter: 'blur(6px)',
              }}
            >
              <span style={{color: palette.accent3, marginRight: 10}}>▍</span>
              {caption}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneWhatsAppProof: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration, 10);
  const leftIn = spring({fps, frame: frame - 4, config: {damping: 160, stiffness: 110, mass: 0.8}});
  const rightIn = spring({fps, frame: frame - 16, config: {damping: 160, stiffness: 110, mass: 0.8}});

  const pulse = 0.55 + (Math.sin(frame / 10) + 1) / 2 * 0.45;

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={sceneFrame}>
        <div style={staggered(frame, 0, 6, 18) as any}>
          <Kicker label="Proof · It works in WhatsApp" color={palette.green} />
        </div>

        <div style={{marginTop: 20}}>
          {['Pinged the agent.', 'Eula answered back.'].map((line, i) => {
            const s = staggered(frame, i + 1, 8, 22);
            const highlight = i === 1;
            return (
              <div
                key={line}
                style={{
                  ...displayLine,
                  fontSize: 64,
                  letterSpacing: -1.8,
                  opacity: s.opacity,
                  transform: `translateY(${s.translateY}px)`,
                  color: highlight ? palette.green : palette.text,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 30,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            alignItems: 'stretch',
          }}
        >
          {/* Left panel: initial ping */}
          <div
            style={{
              borderRadius: 16,
              border: `1px solid ${palette.accent}55`,
              overflow: 'hidden',
              background: 'rgba(3, 6, 18, 0.7)',
              boxShadow: `0 30px 60px ${palette.accent}22`,
              transform: `translateY(${(1 - leftIn) * 30}px)`,
              opacity: leftIn,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: `1px solid ${palette.line}`,
                fontFamily: font.mono,
                fontSize: 16,
                color: palette.accent,
                letterSpacing: 1.4,
              }}
            >
              <span>01 · @Eula bist du da?</span>
              <span style={{color: palette.muted}}>16:17 → 16:19</span>
            </div>
            <div style={{position: 'relative', aspectRatio: '16 / 10'}}>
              <Img
                src={WHATSAPP_TOOLS_IMG}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                  display: 'block',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(180deg, transparent 70%, rgba(4,5,15,0.35))',
                }}
              />
            </div>
          </div>

          {/* Right panel: auto-activation + tool use */}
          <div
            style={{
              borderRadius: 16,
              border: `1px solid ${palette.green}55`,
              overflow: 'hidden',
              background: 'rgba(3, 6, 18, 0.7)',
              boxShadow: `0 30px 60px ${palette.green}22`,
              transform: `translateY(${(1 - rightIn) * 30}px)`,
              opacity: rightIn,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: `1px solid ${palette.line}`,
                fontFamily: font.mono,
                fontSize: 16,
                color: palette.green,
                letterSpacing: 1.4,
              }}
            >
              <span>02 · auto-onboarding + tool use</span>
              <span style={{color: palette.muted}}>16:23</span>
            </div>
            <div style={{position: 'relative', aspectRatio: '16 / 10'}}>
              <Img
                src={WHATSAPP_WORKED_IMG}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center top',
                  display: 'block',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(180deg, transparent 70%, rgba(4,5,15,0.35))',
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 26,
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            opacity: interpolate(frame, [40, 60], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <Chip label="gpt-4.1-mini" tone="accent" />
          <Chip label="context: attached" tone="neutral" />
          <Chip label="auto-activated" tone="good" />
          <Chip label="safety boundary held" tone="warn" outline />
        </div>

        <div
          style={{
            position: 'absolute',
            right: 128,
            top: 96,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: palette.green,
            boxShadow: `0 0 ${18 * pulse}px ${palette.green}, 0 0 4px #fff`,
            opacity: pulse,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const SceneOutro: React.FC<{
  duration: number;
  projectName: string;
  teamName: string;
}> = ({duration, projectName, teamName}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = sceneOpacity(frame, duration);

  const lift = spring({fps, frame, config: {damping: 120, stiffness: 120, mass: 0.7}});
  const logoPulse = 1 + Math.sin(frame / 10) * 0.02;

  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          ...sceneFrame,
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 8,
        }}
      >
        {/* Monogram */}
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 38,
            border: `1px solid ${palette.lineStrong}`,
            background: `linear-gradient(135deg, ${palette.accent}22, ${palette.accent2}22, ${palette.accent3}22)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28,
            transform: `translateY(${(1 - lift) * 30}px) scale(${logoPulse})`,
            opacity: lift,
            boxShadow: `0 40px 80px ${palette.accent}22`,
          }}
        >
          <div
            style={{
              fontFamily: font.display,
              fontSize: 72,
              fontWeight: 800,
              background: `linear-gradient(135deg, ${palette.accent}, ${palette.accent2}, ${palette.accent3})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: -4,
            }}
          >
            K
          </div>
        </div>

        <div
          style={{
            ...displayLine,
            fontSize: 62,
            letterSpacing: -1.8,
            ...(() => {
              const s = staggered(frame, 1, 10, 22);
              return {opacity: s.opacity, transform: `translateY(${s.translateY}px)`};
            })(),
          }}
        >
          If we stumble, we do it with a stack trace.
        </div>
        <div
          style={{
            ...displayLine,
            fontSize: 62,
            letterSpacing: -1.8,
            ...(() => {
              const s = staggered(frame, 2, 10, 22);
              return {opacity: s.opacity, transform: `translateY(${s.translateY}px)`};
            })(),
          }}
        >
          When we ship, we ship with style.
        </div>

        <div
          style={{
            ...displayLine,
            fontSize: 84,
            marginTop: 20,
            letterSpacing: -2.8,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.accent3})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            ...(() => {
              const s = staggered(frame, 3, 10, 24);
              return {opacity: s.opacity, transform: `translateY(${s.translateY}px)`};
            })(),
          }}
        >
          {projectName}
        </div>

        <div
          style={{
            marginTop: 26,
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            opacity: interpolate(frame, [40, 60], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <Chip label="✦ observable" tone="warn" />
          <Chip label=">_ deterministic" tone="accent" />
          <Chip label="◔ traceable" tone="good" />
          <Chip label="☑︎ shipbar" tone="neutral" />
        </div>

        <div
          style={{
            marginTop: 28,
            fontFamily: font.display,
            fontSize: 28,
            color: palette.subtext,
            opacity: interpolate(frame, [55, 75], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          Thanks for watching — {teamName}.
        </div>

        <div
          style={{
            marginTop: 10,
            fontFamily: font.mono,
            fontSize: 18,
            color: palette.muted,
            letterSpacing: 1.4,
            opacity: interpolate(frame, [65, 85], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          made with remotion · 5.3-codex said hi · don't judge.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// --- Root composition --------------------------------------------------------

export const IntroVideo: React.FC<IntroVideoProps> = ({projectName, city, teamName}) => {
  const {fps} = useVideoConfig();

  const D = 4 * fps; // default scene duration
  const D_DEMO = 45 * fps; // full demo at 4.5x playback ≈ 202s video
  const D_PROOF = 5 * fps; // proof panel needs time to read two screenshots

  const sceneDurations = {
    coldOpen: D,
    flaskRing: D,
    oracle: D,
    sentry: D,
    backlogForge: D,
    problem: D,
    whatWeBuild: D,
    triggerAndOps: D,
    ingestRag: D,
    liveDemo: D_DEMO,
    whatsappProof: D_PROOF,
    outro: D,
  } as const;

  const order = [
    'coldOpen',
    'flaskRing',
    'oracle',
    'sentry',
    'backlogForge',
    'problem',
    'liveDemo',
    'whatsappProof',
    'whatWeBuild',
    'triggerAndOps',
    'ingestRag',
    'outro',
  ] as const;

  const starts: Record<(typeof order)[number], number> = {} as any;
  order.forEach((name, i) => {
    starts[name] = i === 0 ? 0 : starts[order[i - 1]] + sceneDurations[order[i - 1]];
  });

  const chapters = [
    {label: 'Boot Sequence', start: starts.coldOpen, end: starts.coldOpen + sceneDurations.coldOpen},
    {label: 'Easter Egg · Ring', start: starts.flaskRing, end: starts.flaskRing + sceneDurations.flaskRing},
    {label: 'Terminal Oracle', start: starts.oracle, end: starts.oracle + sceneDurations.oracle},
    {label: 'Sentry First', start: starts.sentry, end: starts.sentry + sceneDurations.sentry},
    {label: 'Backlog Forge', start: starts.backlogForge, end: starts.backlogForge + sceneDurations.backlogForge},
    {label: 'The Problem', start: starts.problem, end: starts.problem + sceneDurations.problem},
    {label: 'Live Demo', start: starts.liveDemo, end: starts.liveDemo + sceneDurations.liveDemo},
    {label: 'WhatsApp Proof', start: starts.whatsappProof, end: starts.whatsappProof + sceneDurations.whatsappProof},
    {label: 'Our Solution', start: starts.whatWeBuild, end: starts.whatWeBuild + sceneDurations.whatWeBuild},
    {label: 'Agent-Trigger', start: starts.triggerAndOps, end: starts.triggerAndOps + sceneDurations.triggerAndOps},
    {label: 'Ingest · RAG', start: starts.ingestRag, end: starts.ingestRag + sceneDurations.ingestRag},
    {label: 'Outro', start: starts.outro, end: starts.outro + sceneDurations.outro},
  ];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.bg0,
        color: palette.text,
        fontFamily: font.display,
      }}
    >
      <GlobalBackground />

      <Sequence from={starts.coldOpen} durationInFrames={sceneDurations.coldOpen} premountFor={fps}>
        <SceneColdOpen duration={sceneDurations.coldOpen} city={city} />
      </Sequence>

      <Sequence from={starts.flaskRing} durationInFrames={sceneDurations.flaskRing} premountFor={fps}>
        <SceneFlaskRing duration={sceneDurations.flaskRing} />
      </Sequence>

      <Sequence from={starts.oracle} durationInFrames={sceneDurations.oracle} premountFor={fps}>
        <SceneTerminalOracle duration={sceneDurations.oracle} />
      </Sequence>

      <Sequence from={starts.sentry} durationInFrames={sceneDurations.sentry} premountFor={fps}>
        <SceneSentryFirst duration={sceneDurations.sentry} />
      </Sequence>

      <Sequence from={starts.backlogForge} durationInFrames={sceneDurations.backlogForge} premountFor={fps}>
        <SceneBacklogForge duration={sceneDurations.backlogForge} />
      </Sequence>

      <Sequence from={starts.problem} durationInFrames={sceneDurations.problem} premountFor={fps}>
        <SceneProblem duration={sceneDurations.problem} />
      </Sequence>

      <Sequence from={starts.whatWeBuild} durationInFrames={sceneDurations.whatWeBuild} premountFor={fps}>
        <SceneWhatWeBuild duration={sceneDurations.whatWeBuild} />
      </Sequence>

      <Sequence from={starts.triggerAndOps} durationInFrames={sceneDurations.triggerAndOps} premountFor={fps}>
        <SceneTriggerAndOps duration={sceneDurations.triggerAndOps} />
      </Sequence>

      <Sequence from={starts.ingestRag} durationInFrames={sceneDurations.ingestRag} premountFor={fps}>
        <SceneIngestRag duration={sceneDurations.ingestRag} />
      </Sequence>

      <Sequence from={starts.liveDemo} durationInFrames={sceneDurations.liveDemo} premountFor={fps * 2}>
        <SceneLiveDemo duration={sceneDurations.liveDemo} />
      </Sequence>

      <Sequence from={starts.whatsappProof} durationInFrames={sceneDurations.whatsappProof} premountFor={fps}>
        <SceneWhatsAppProof duration={sceneDurations.whatsappProof} />
      </Sequence>

      <Sequence from={starts.outro} durationInFrames={sceneDurations.outro} premountFor={fps}>
        <SceneOutro duration={sceneDurations.outro} projectName={projectName} teamName={teamName} />
      </Sequence>

      <ChapterBar chapters={chapters} />
    </AbsoluteFill>
  );
};
